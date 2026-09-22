begin;

create table public.diary_snapshots (
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source = 'e-schools.by'),
  schema_version integer not null default 1 check (schema_version = 1),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2000000
  ),
  updated_at timestamptz not null default now(),
  primary key (owner_id, source)
);

alter table public.diary_snapshots enable row level security;
revoke all on public.diary_snapshots from anon, authenticated;
grant select, insert, update, delete on public.diary_snapshots to authenticated;

create policy own_diary_select on public.diary_snapshots
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy own_diary_insert on public.diary_snapshots
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy own_diary_update on public.diary_snapshots
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy own_diary_delete on public.diary_snapshots
  for delete to authenticated using ((select auth.uid()) = owner_id);

create function public.stamp_diary_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.stamp_diary_snapshot() from public, anon, authenticated;
create trigger diary_snapshot_updated before insert or update on public.diary_snapshots
  for each row execute function public.stamp_diary_snapshot();

commit;
