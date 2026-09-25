begin;

create table public.diary_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  requester_name text not null
    check (char_length(trim(requester_name)) between 1 and 80),
  diary_url text not null
    check (char_length(trim(diary_url)) between 4 and 300),
  contact text not null
    check (char_length(trim(contact)) between 2 and 200),
  status text not null default 'new'
    check (status in ('new', 'in_review', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index diary_requests_owner_idx
  on public.diary_requests (owner_id, created_at desc);
create index diary_requests_status_idx
  on public.diary_requests (status, created_at desc);

alter table public.diary_requests enable row level security;
revoke all on public.diary_requests from anon, authenticated;
grant select, insert, update on public.diary_requests to authenticated;

create policy diary_request_select on public.diary_requests
  for select to authenticated
  using (
    owner_id = (select auth.uid()) or
    (select public.is_support_agent())
  );

create policy diary_request_insert on public.diary_requests
  for insert to authenticated
  with check (
    owner_id = (select auth.uid()) and
    status = 'new'
  );

create policy diary_request_agent_update on public.diary_requests
  for update to authenticated
  using ((select public.is_support_agent()))
  with check ((select public.is_support_agent()));

create function public.touch_diary_request()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_diary_request() from public, anon, authenticated;
create trigger diary_request_touch_updated_at
  before update on public.diary_requests
  for each row execute function public.touch_diary_request();

alter publication supabase_realtime add table public.diary_requests;

commit;
