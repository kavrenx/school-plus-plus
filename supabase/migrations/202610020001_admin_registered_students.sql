begin;

create or replace function public.get_admin_registered_students()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not public.is_schoolpp_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', registered.name,
        'className', registered.class_name,
        'updatedAt', registered.updated_at
      )
      order by registered.updated_at desc, registered.name
    ),
    '[]'::jsonb
  )
  into result
  from (
    select student.name, student.class_name, max(snapshot.updated_at) as updated_at
    from public.diary_snapshots snapshot
    cross join lateral (
      select
        coalesce(
          nullif(trim(snapshot.payload #>> '{profile,label}'), ''),
          (
            select coalesce(
              nullif(trim(page.value #>> '{studentIdentity,name}'), ''),
              nullif(trim(page.value #>> '{profile,label}'), '')
            )
            from jsonb_each(coalesce(snapshot.payload -> 'pages', '{}'::jsonb)) page
            where coalesce(
              nullif(trim(page.value #>> '{studentIdentity,name}'), ''),
              nullif(trim(page.value #>> '{profile,label}'), '')
            ) is not null
            limit 1
          )
        ) as name,
        (
          select nullif(trim(page.value #>> '{studentIdentity,classTitle}'), '')
          from jsonb_each(coalesce(snapshot.payload -> 'pages', '{}'::jsonb)) page
          where nullif(trim(page.value #>> '{studentIdentity,classTitle}'), '') is not null
          limit 1
        ) as class_name
    ) student
    where snapshot.source = 'e-schools.by'
      and student.name is not null
      and student.class_name is not null
    group by student.name, student.class_name
  ) registered;

  return result;
end;
$$;

revoke all on function public.get_admin_registered_students()
  from public, anon;
grant execute on function public.get_admin_registered_students()
  to authenticated;

commit;
