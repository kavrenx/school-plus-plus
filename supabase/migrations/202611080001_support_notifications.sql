begin;

create schema schoolpp_support;
revoke all on schema schoolpp_support from public, anon, authenticated, service_role;

create table schoolpp_support.notifications (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('conversation', 'request')),
  target_id uuid not null,
  available_at timestamptz not null default now(),
  attempts integer not null default 0,
  lease uuid
);

create index support_notifications_available_idx
  on schoolpp_support.notifications (available_at, id);

alter table schoolpp_support.notifications enable row level security;
revoke all on schoolpp_support.notifications from public, anon, authenticated, service_role;

create function schoolpp_support.enqueue_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'diary_requests' then
    insert into schoolpp_support.notifications (kind, target_id)
      values ('request', new.id);
  elsif exists (
    select 1 from public.support_conversations
    where id = new.conversation_id and owner_id = new.sender_id
  ) and not exists (
    select 1 from public.support_agents where user_id = new.sender_id
  ) then
    insert into schoolpp_support.notifications (kind, target_id)
      values ('conversation', new.conversation_id);
  end if;
  return new;
end;
$$;

revoke all on function schoolpp_support.enqueue_notification()
  from public, anon, authenticated, service_role;

create trigger enqueue_support_message_notification
  after insert on public.support_messages
  for each row execute function schoolpp_support.enqueue_notification();

create trigger enqueue_diary_request_notification
  after insert on public.diary_requests
  for each row execute function schoolpp_support.enqueue_notification();

create function public.claim_support_notifications()
returns table (id text, kind text, target_id uuid, lease uuid)
language sql
security definer
set search_path = ''
as $$
  with due as (
    select n.id from schoolpp_support.notifications as n
    where n.available_at <= now()
    order by n.available_at, n.id
    limit 4
    for update skip locked
  )
  update schoolpp_support.notifications as n
  set lease = gen_random_uuid(),
      available_at = now() + interval '2 minutes',
      attempts = n.attempts + 1
  from due
  where n.id = due.id
  returning n.id::text, n.kind, n.target_id, n.lease;
$$;

create function public.finish_support_notification(
  p_id bigint,
  p_lease uuid,
  p_sent boolean,
  p_retry_after integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_sent is true then
    delete from schoolpp_support.notifications
      where id = p_id and lease = p_lease;
  else
    update schoolpp_support.notifications
    set lease = null,
        available_at = now() + make_interval(secs => greatest(
          least(3600, 30 * (1 << least(attempts, 7))),
          least(86400, coalesce(p_retry_after, 0))
        ))
    where id = p_id and lease = p_lease;
  end if;
  return found;
end;
$$;

revoke all on function public.claim_support_notifications(),
  public.finish_support_notification(bigint, uuid, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_support_notifications(),
  public.finish_support_notification(bigint, uuid, boolean, integer)
  to service_role;

commit;
