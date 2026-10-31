-- Apply separately, after the compatible website has been deployed and checked.
-- Old open tabs must reload before they can write again. Reads remain available.
begin;
do $$
begin
  if to_regprocedure('public.save_my_diary_snapshot_v2(jsonb,uuid)') is null
    or to_regprocedure('public.remove_my_diary_snapshot_v2(uuid)') is null
    or to_regprocedure('public.get_my_diary_snapshot_v2(boolean)') is null then
    raise exception 'Install diary write revision RPCs before cutover';
  end if;
end;
$$;
revoke insert, update, delete on public.diary_snapshots from authenticated;
do $$
begin
  if has_table_privilege('authenticated','public.diary_snapshots','insert')
    or has_table_privilege('authenticated','public.diary_snapshots','update')
    or has_table_privilege('authenticated','public.diary_snapshots','delete') then
    raise exception 'Inherited diary write privileges must be reviewed before cutover';
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
