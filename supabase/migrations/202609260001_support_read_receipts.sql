begin;

alter table public.support_messages
  add column if not exists read_at timestamptz;

create or replace function public.mark_support_messages_read(
  p_conversation_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.support_conversations conversation
    where conversation.id = p_conversation_id
      and (
        conversation.owner_id = current_user_id
        or public.is_support_agent()
      )
  ) then
    raise exception 'ACCESS_DENIED';
  end if;

  update public.support_messages
  set read_at = coalesce(read_at, now())
  where conversation_id = p_conversation_id
    and sender_id <> current_user_id
    and read_at is null;
end;
$$;

revoke all on function public.mark_support_messages_read(uuid)
  from public, anon;
grant execute on function public.mark_support_messages_read(uuid)
  to authenticated;

commit;
