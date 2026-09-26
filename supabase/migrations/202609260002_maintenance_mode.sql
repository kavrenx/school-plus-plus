begin;

create table if not exists public.site_settings (
  id boolean primary key default true check (id),
  maintenance_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.site_settings (id, maintenance_enabled)
values (true, false)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;

create or replace function public.get_public_site_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'maintenanceEnabled', settings.maintenance_enabled,
    'updatedAt', settings.updated_at
  )
  from public.site_settings settings
  where settings.id = true;
$$;

revoke all on function public.get_public_site_status() from public;
grant execute on function public.get_public_site_status() to anon, authenticated;

create or replace function public.set_maintenance_mode(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_schoolpp_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  update public.site_settings
  set maintenance_enabled = coalesce(p_enabled, false),
      updated_at = now(),
      updated_by = auth.uid()
  where id = true
  returning jsonb_build_object(
    'maintenanceEnabled', maintenance_enabled,
    'updatedAt', updated_at
  ) into result;

  return result;
end;
$$;

revoke all on function public.set_maintenance_mode(boolean) from public, anon;
grant execute on function public.set_maintenance_mode(boolean) to authenticated;

commit;
