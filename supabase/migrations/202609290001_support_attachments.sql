begin;

alter table public.support_messages
  add column has_attachment boolean not null default false;

alter table public.support_messages
  drop constraint if exists support_messages_body_check;
alter table public.support_messages
  add constraint support_messages_body_check
  check (
    char_length(body) between 1 and 2000
    or (has_attachment and body = '')
  );

drop policy if exists support_message_insert on public.support_messages;
create policy support_message_insert on public.support_messages
  for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and not has_attachment
    and exists (
      select 1
      from public.support_conversations conversation
      where conversation.id = conversation_id
        and conversation.status = 'open'
        and (
          conversation.owner_id = (select auth.uid())
          or (select public.is_support_agent())
        )
    )
  );

create index if not exists support_messages_sender_rate_idx
  on public.support_messages (sender_id, created_at desc);

create or replace function public.enforce_support_message_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.sender_id := auth.uid();
  new.created_at := now();
  if (
    select count(*)
    from public.support_messages message
    where message.sender_id = new.sender_id
      and message.created_at > now() - interval '1 minute'
  ) >= 6 then
    raise exception 'RATE_LIMITED_MINUTE';
  end if;
  if (
    select count(*)
    from public.support_messages message
    where message.sender_id = new.sender_id
      and message.created_at > now() - interval '1 hour'
  ) >= 40 then
    raise exception 'RATE_LIMITED_HOUR';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_support_message_rate_limit()
  from public, anon, authenticated;
drop trigger if exists support_message_rate_limit on public.support_messages;
create trigger support_message_rate_limit
  before insert on public.support_messages
  for each row execute function public.enforce_support_message_rate_limit();

create or replace function public.enforce_support_conversation_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.owner_id := auth.uid();
  new.created_at := now();
  new.updated_at := now();
  if (
    select count(*)
    from public.support_conversations conversation
    where conversation.owner_id = new.owner_id
      and conversation.created_at > now() - interval '10 minutes'
  ) >= 3 then
    raise exception 'CONVERSATION_RATE_LIMITED';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_support_conversation_rate_limit()
  from public, anon, authenticated;
drop trigger if exists support_conversation_rate_limit
  on public.support_conversations;
create trigger support_conversation_rate_limit
  before insert on public.support_conversations
  for each row execute function public.enforce_support_conversation_rate_limit();

create table public.support_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id bigint not null references public.support_messages(id) on delete cascade,
  conversation_id uuid not null references public.support_conversations(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('photo', 'video', 'file')),
  file_name text not null check (char_length(file_name) between 1 and 180),
  content_type text not null check (char_length(content_type) between 1 and 120),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  storage_path text not null unique check (char_length(storage_path) between 1 and 500),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days'),
  deleted_at timestamptz,
  unique (message_id)
);

create index support_attachments_expiry_idx
  on public.support_attachments (expires_at)
  where deleted_at is null;

alter table public.support_attachments enable row level security;
revoke all on public.support_attachments from anon, authenticated;
grant select on public.support_attachments to authenticated;

create policy support_attachment_select on public.support_attachments
  for select to authenticated
  using (
    exists (
      select 1
      from public.support_conversations conversation
      where conversation.id = conversation_id
        and (
          conversation.owner_id = (select auth.uid())
          or (select public.is_support_agent())
        )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('support-attachments', 'support-attachments', false, 52428800)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit;

create policy support_attachment_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1
      from public.support_conversations conversation
      where conversation.id::text = (storage.foldername(name))[1]
        and conversation.status = 'open'
        and (
          conversation.owner_id = (select auth.uid())
          or (select public.is_support_agent())
        )
    )
  );

create policy support_attachment_object_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'support-attachments'
    and exists (
      select 1
      from public.support_attachments attachment
      join public.support_conversations conversation
        on conversation.id = attachment.conversation_id
      where attachment.storage_path = name
        and attachment.deleted_at is null
        and attachment.expires_at > now()
        and (
          conversation.owner_id = (select auth.uid())
          or (select public.is_support_agent())
        )
    )
  );

create policy support_attachment_object_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'support-attachments'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create or replace function public.send_support_message_with_attachment(
  p_conversation_id uuid,
  p_body text,
  p_kind text,
  p_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_storage_path text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  created_message_id bigint;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'MESSAGE_TOO_LONG';
  end if;
  if p_kind not in ('photo', 'video', 'file') then
    raise exception 'INVALID_ATTACHMENT_KIND';
  end if;
  if char_length(trim(coalesce(p_file_name, ''))) not between 1 and 180
    or char_length(trim(coalesce(p_content_type, ''))) not between 1 and 120
  then
    raise exception 'INVALID_ATTACHMENT_METADATA';
  end if;
  if p_size_bytes < 1
    or (p_kind = 'photo' and p_size_bytes > 10485760)
    or (p_kind = 'video' and p_size_bytes > 52428800)
    or (p_kind = 'file' and p_size_bytes > 20971520)
  then
    raise exception 'ATTACHMENT_TOO_LARGE';
  end if;
  if (p_kind = 'photo' and p_content_type not like 'image/%')
    or (p_kind = 'video' and p_content_type not like 'video/%')
  then
    raise exception 'INVALID_ATTACHMENT_TYPE';
  end if;
  if p_storage_path not like
    p_conversation_id::text || '/' || current_user_id::text || '/%'
  then
    raise exception 'INVALID_STORAGE_PATH';
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

  insert into public.support_messages (
    conversation_id,
    sender_id,
    body,
    has_attachment
  )
  values (
    p_conversation_id,
    current_user_id,
    coalesce(p_body, ''),
    true
  )
  returning id into created_message_id;

  insert into public.support_attachments (
    message_id,
    conversation_id,
    uploader_id,
    kind,
    file_name,
    content_type,
    size_bytes,
    storage_path
  ) values (
    created_message_id,
    p_conversation_id,
    current_user_id,
    p_kind,
    left(p_file_name, 180),
    left(p_content_type, 120),
    p_size_bytes,
    p_storage_path
  );

  return created_message_id;
end;
$$;

revoke all on function public.send_support_message_with_attachment(
  uuid, text, text, text, text, bigint, text
) from public, anon;
grant execute on function public.send_support_message_with_attachment(
  uuid, text, text, text, text, bigint, text
) to authenticated;

alter publication supabase_realtime add table public.support_attachments;

commit;
