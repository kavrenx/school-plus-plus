begin;

-- Additive stage: existing clients retain their table privileges until cutover.
alter table public.diary_snapshots
  add column write_revision uuid not null default pg_catalog.gen_random_uuid();

create or replace function public.stamp_diary_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.write_revision := pg_catalog.gen_random_uuid();
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.stamp_diary_snapshot() from public, anon, authenticated;

create function public.get_my_diary_snapshot_v2(p_include_payload boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot public.diary_snapshots;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok',false,'error','sign_in_required');
  end if;
  select * into v_snapshot from public.diary_snapshots
    where owner_id = auth.uid() and source = 'e-schools.by';
  if not found then return jsonb_build_object('ok',true,'snapshot',null); end if;
  return jsonb_build_object('ok',true,'snapshot',
    jsonb_build_object('schema_version',v_snapshot.schema_version,
      'updated_at',v_snapshot.updated_at,'write_revision',v_snapshot.write_revision)
    || case when p_include_payload then jsonb_build_object('payload',v_snapshot.payload)
      else '{}'::jsonb end);
end;
$$;

create function public.save_my_diary_snapshot_v2(p_payload jsonb, p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_snapshot public.diary_snapshots;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok',false,'error','sign_in_required');
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object'
    or p_payload->>'source' is distinct from 'e-schools.by'
    or octet_length(p_payload::text) > 2000000 then
    return jsonb_build_object('ok',false,'error','snapshot_invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists(select 1 from public.diary_device_links
    where member_id = auth.uid() and revoked_at is null) then
    return jsonb_build_object('ok',false,'error','pair_owner_required');
  end if;
  select * into v_snapshot from public.diary_snapshots
    where owner_id = auth.uid() and source = 'e-schools.by' for update;
  if found then
    -- Lost responses can be retried without changing the revision or timestamp.
    if v_snapshot.payload = p_payload then
      return jsonb_build_object('ok',true,'schema_version',v_snapshot.schema_version,
        'updated_at',v_snapshot.updated_at,'write_revision',v_snapshot.write_revision,
        'unchanged',true);
    end if;
    if v_snapshot.write_revision is distinct from p_expected_revision then
      return jsonb_build_object('ok',false,'error','diary_snapshot_conflict');
    end if;
    update public.diary_snapshots set payload = p_payload
      where owner_id = auth.uid() and source = 'e-schools.by'
      returning * into v_snapshot;
  else
    if p_expected_revision is not null then
      return jsonb_build_object('ok',false,'error','diary_snapshot_conflict');
    end if;
    begin
      insert into public.diary_snapshots(owner_id,source,schema_version,payload)
        values(auth.uid(),'e-schools.by',1,p_payload) returning * into v_snapshot;
    exception when unique_violation then
      -- During rollout an old direct insert may not take our advisory lock.
      select * into v_snapshot from public.diary_snapshots
        where owner_id = auth.uid() and source = 'e-schools.by' for update;
      if not found or v_snapshot.payload is distinct from p_payload then
        return jsonb_build_object('ok',false,'error','diary_snapshot_conflict');
      end if;
    end;
  end if;
  return jsonb_build_object('ok',true,'schema_version',v_snapshot.schema_version,
    'updated_at',v_snapshot.updated_at,'write_revision',v_snapshot.write_revision,
    'unchanged',false);
end;
$$;

create function public.remove_my_diary_snapshot_v2(p_expected_revision uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_revision uuid;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok',false,'error','sign_in_required');
  end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if exists(select 1 from public.diary_device_links
    where member_id = auth.uid() and revoked_at is null) then
    return jsonb_build_object('ok',false,'error','pair_owner_required');
  end if;
  select write_revision into v_revision from public.diary_snapshots
    where owner_id = auth.uid() and source = 'e-schools.by' for update;
  if not found then return jsonb_build_object('ok',true,'removed',false); end if;
  if v_revision is distinct from p_expected_revision then
    return jsonb_build_object('ok',false,'error','diary_snapshot_conflict');
  end if;
  delete from public.diary_snapshots where owner_id = auth.uid() and source = 'e-schools.by';
  return jsonb_build_object('ok',true,'removed',true);
end;
$$;

revoke all on function public.get_my_diary_snapshot_v2(boolean),
  public.save_my_diary_snapshot_v2(jsonb,uuid),
  public.remove_my_diary_snapshot_v2(uuid) from public, anon, authenticated;
grant execute on function public.get_my_diary_snapshot_v2(boolean),
  public.save_my_diary_snapshot_v2(jsonb,uuid),
  public.remove_my_diary_snapshot_v2(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
