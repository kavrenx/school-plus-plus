begin;

alter table public.support_attachments
  drop constraint if exists support_attachments_message_id_key;

alter table public.support_attachments
  add column if not exists position smallint not null default 0
  check (position between 0 and 9);

create unique index if not exists support_attachments_message_position_idx
  on public.support_attachments (message_id, position);

create or replace function public.send_support_message_with_attachments(
  p_conversation_id uuid,
  p_body text,
  p_attachments jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_message_id bigint;
  attachment jsonb;
  attachment_position bigint;
  attachment_kind text;
  attachment_name text;
  attachment_content_type text;
  attachment_size bigint;
  attachment_storage_path text;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if jsonb_typeof(p_attachments) <> 'array'
    or jsonb_array_length(p_attachments) not between 1 and 10
  then
    raise exception 'INVALID_ATTACHMENT_COUNT';
  end if;
  if not exists (
    select 1
    from public.support_conversations conversation
    where conversation.id = p_conversation_id
      and conversation.status = 'open'
      and (
        conversation.owner_id = current_user_id
        or public.is_support_agent()
      )
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  for attachment, attachment_position in
    select item.value, item.ordinality - 1
    from jsonb_array_elements(p_attachments) with ordinality
      as item(value, ordinality)
  loop
    attachment_kind := attachment ->> 'kind';
    attachment_name := trim(coalesce(attachment ->> 'file_name', ''));
    attachment_content_type := trim(
      coalesce(attachment ->> 'content_type', '')
    );
    attachment_storage_path := coalesce(attachment ->> 'storage_path', '');
    begin
      attachment_size := (attachment ->> 'size_bytes')::bigint;
    exception when others then
      raise exception 'INVALID_ATTACHMENT_METADATA';
    end;

    if attachment_kind not in ('photo', 'video', 'file') then
      raise exception 'INVALID_ATTACHMENT_KIND';
    end if;
    if char_length(attachment_name) not between 1 and 180
      or char_length(attachment_content_type) not between 1 and 120
    then
      raise exception 'INVALID_ATTACHMENT_METADATA';
    end if;
    if attachment_size < 1
      or (attachment_kind = 'photo' and attachment_size > 10485760)
      or (attachment_kind = 'video' and attachment_size > 52428800)
      or (attachment_kind = 'file' and attachment_size > 20971520)
    then
      raise exception 'ATTACHMENT_TOO_LARGE';
    end if;
    if (attachment_kind = 'photo' and attachment_content_type not like 'image/%')
      or (attachment_kind = 'video' and attachment_content_type not like 'video/%')
    then
      raise exception 'INVALID_ATTACHMENT_TYPE';
    end if;
    if attachment_storage_path not like
      p_conversation_id::text || '/' || current_user_id::text || '/%'
    then
      raise exception 'INVALID_STORAGE_PATH';
    end if;
  end loop;

  insert into public.support_messages (
    conversation_id,
    sender_id,
    body,
    has_attachment
  ) values (
    p_conversation_id,
    current_user_id,
    coalesce(p_body, ''),
    true
  ) returning id into created_message_id;

  for attachment, attachment_position in
    select item.value, item.ordinality - 1
    from jsonb_array_elements(p_attachments) with ordinality
      as item(value, ordinality)
  loop
    insert into public.support_attachments (
      message_id,
      conversation_id,
      uploader_id,
      kind,
      file_name,
      content_type,
      size_bytes,
      storage_path,
      position
    ) values (
      created_message_id,
      p_conversation_id,
      current_user_id,
      attachment ->> 'kind',
      left(attachment ->> 'file_name', 180),
      left(attachment ->> 'content_type', 120),
      (attachment ->> 'size_bytes')::bigint,
      attachment ->> 'storage_path',
      attachment_position
    );
  end loop;

  return created_message_id;
end;
$$;

revoke all on function public.send_support_message_with_attachments(
  uuid, text, jsonb
) from public, anon;
grant execute on function public.send_support_message_with_attachments(
  uuid, text, jsonb
) to authenticated;

commit;
