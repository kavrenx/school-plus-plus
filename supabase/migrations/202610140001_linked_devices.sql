begin;

create table public.diary_device_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  member_id uuid not null references auth.users(id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (owner_id <> member_id)
);
create unique index diary_device_one_active_owner on public.diary_device_links(member_id) where revoked_at is null;
create index diary_device_owner_idx on public.diary_device_links(owner_id);

create table public.diary_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash bytea not null unique,
  expires_at timestamptz not null default now() + interval '5 minutes',
  status text not null default 'waiting' check (status in ('waiting','pending','approved','rejected','cancelled')),
  requester_id uuid references auth.users(id) on delete cascade,
  requester_label text,
  verification_code text,
  device_id uuid references public.diary_device_links(id),
  created_at timestamptz not null default now()
);
create index diary_pairing_owner_idx on public.diary_pairing_requests(owner_id,created_at desc);

create table public.diary_pairing_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  window_started_at timestamptz not null,
  attempts integer not null default 1,
  primary key(user_id,action)
);

create table public.diary_shared_changes (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  events jsonb not null default '[]' check (jsonb_typeof(events) = 'array' and jsonb_array_length(events) <= 150 and octet_length(events::text) <= 400000),
  updated_at timestamptz not null default now()
);

alter table public.diary_device_links enable row level security;
alter table public.diary_pairing_requests enable row level security;
alter table public.diary_pairing_limits enable row level security;
alter table public.diary_shared_changes enable row level security;
revoke all on public.diary_device_links, public.diary_pairing_requests, public.diary_pairing_limits, public.diary_shared_changes from public, anon, authenticated;

-- RPCs expose only the caller's requests and explicitly approved diary. Direct table access stays closed.
create function public.diary_pairing_allow(p_action text, p_max integer, p_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if auth.uid() is null then return false; end if;
  insert into public.diary_pairing_limits(user_id,action,window_started_at,attempts)
  values(auth.uid(),p_action,now(),1)
  on conflict(user_id,action) do update set
    attempts = case when diary_pairing_limits.window_started_at < now() - make_interval(secs => p_seconds) then 1 else diary_pairing_limits.attempts + 1 end,
    window_started_at = case when diary_pairing_limits.window_started_at < now() - make_interval(secs => p_seconds) then now() else diary_pairing_limits.window_started_at end
  returning attempts into v_count;
  return v_count <= p_max;
end;
$$;
revoke all on function public.diary_pairing_allow(text,integer,integer) from public, anon, authenticated;

create function public.get_my_diary_access()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_link public.diary_device_links;
begin
  if auth.uid() is null then return jsonb_build_object('role','unpaired'); end if;
  select * into v_link from public.diary_device_links where member_id = auth.uid() and revoked_at is null;
  if found then
    update public.diary_device_links set last_seen_at = now() where id = v_link.id and last_seen_at < now() - interval '1 minute';
    return jsonb_build_object('role','linked','ownerId',v_link.owner_id,'deviceId',v_link.id,'label',v_link.label);
  end if;
  if exists(select 1 from public.diary_snapshots where owner_id = auth.uid()) then
    return jsonb_build_object('role','owner','ownerId',auth.uid());
  end if;
  return jsonb_build_object('role','unpaired');
end;
$$;

create function public.create_diary_pairing()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_bytes bytea; v_code text; v_pair public.diary_pairing_requests;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  if not public.diary_pairing_allow('create',5,300) then return jsonb_build_object('ok',false,'error','pair_rate_limited'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  if not exists(select 1 from public.diary_snapshots where owner_id = auth.uid()) or exists(select 1 from public.diary_device_links where member_id = auth.uid() and revoked_at is null) then
    return jsonb_build_object('ok',false,'error','pair_owner_required');
  end if;
  if (select count(*) from public.diary_device_links where owner_id = auth.uid() and revoked_at is null) >= 5 then return jsonb_build_object('ok',false,'error','pair_device_limit'); end if;
  delete from public.diary_pairing_requests where expires_at < now() - interval '1 day';
  update public.diary_pairing_requests set status = 'cancelled' where owner_id = auth.uid() and status in ('waiting','pending');
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_code := lpad(((get_byte(v_bytes,0)::bigint * 16777216 + get_byte(v_bytes,1)::bigint * 65536 + get_byte(v_bytes,2)::bigint * 256 + get_byte(v_bytes,3)::bigint) % 100000000)::text,8,'0');
    exit when not exists(select 1 from public.diary_pairing_requests where code_hash = extensions.digest(v_code,'sha256'));
  end loop;
  insert into public.diary_pairing_requests(owner_id,code_hash) values(auth.uid(),extensions.digest(v_code,'sha256')) returning * into v_pair;
  return jsonb_build_object('ok',true,'id',v_pair.id,'code',v_code,'status',v_pair.status,'expiresAt',v_pair.expires_at);
end;
$$;

create function public.request_diary_pairing(p_code text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pair public.diary_pairing_requests; v_code text;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  -- Failed attempts return a value instead of raising: the rate-limit update must commit.
  if not public.diary_pairing_allow('claim',5,300) then return jsonb_build_object('ok',false,'error','pair_rate_limited'); end if;
  v_code := regexp_replace(coalesce(p_code,''),'[ -]','','g');
  if v_code !~ '^[0-9]{8}$' then return jsonb_build_object('ok',false,'error','pair_code_invalid'); end if;
  select * into v_pair from public.diary_pairing_requests where code_hash = extensions.digest(v_code,'sha256') for update;
  if not found or v_pair.expires_at <= now() then return jsonb_build_object('ok',false,'error','pair_code_invalid'); end if;
  -- The same phone can recover a response lost in transit, without creating a second grant.
  if v_pair.status = 'pending' and v_pair.requester_id = auth.uid() then
    return jsonb_build_object('ok',true,'id',v_pair.id,'status',v_pair.status,'expiresAt',v_pair.expires_at,'verificationCode',upper(v_pair.verification_code));
  end if;
  if v_pair.status <> 'waiting' then return jsonb_build_object('ok',false,'error','pair_code_invalid'); end if;
  if v_pair.owner_id = auth.uid() then return jsonb_build_object('ok',false,'error','pair_same_device'); end if;
  if exists(select 1 from public.diary_snapshots where owner_id = auth.uid()) or exists(select 1 from public.diary_device_links where member_id = auth.uid() and revoked_at is null) then
    return jsonb_build_object('ok',false,'error','pair_device_has_diary');
  end if;
  update public.diary_pairing_requests set status = 'pending', requester_id = auth.uid(),
    requester_label = left(coalesce(nullif(trim(p_label),''),'Телефон'),80),
    verification_code = substr(encode(extensions.gen_random_bytes(4),'hex'),1,4)
  where id = v_pair.id returning * into v_pair;
  return jsonb_build_object('ok',true,'id',v_pair.id,'status',v_pair.status,'expiresAt',v_pair.expires_at,'verificationCode',upper(v_pair.verification_code));
end;
$$;

create function public.get_diary_pairing(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pair public.diary_pairing_requests;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  select * into v_pair from public.diary_pairing_requests where id = p_id and (owner_id = auth.uid() or requester_id = auth.uid());
  if not found then return jsonb_build_object('ok',false,'error','pair_not_found'); end if;
  if v_pair.status in ('waiting','pending') and v_pair.expires_at <= now() then return jsonb_build_object('ok',true,'id',v_pair.id,'status','expired'); end if;
  if v_pair.status = 'approved' and not exists(select 1 from public.diary_device_links where id = v_pair.device_id and revoked_at is null) then return jsonb_build_object('ok',true,'id',v_pair.id,'status','revoked'); end if;
  return jsonb_build_object('ok',true,'id',v_pair.id,'status',v_pair.status,'expiresAt',v_pair.expires_at,'label',v_pair.requester_label,'verificationCode',upper(v_pair.verification_code));
end;
$$;

create function public.respond_diary_pairing(p_id uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pair public.diary_pairing_requests; v_device uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into v_pair from public.diary_pairing_requests where id = p_id and owner_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok',false,'error','pair_not_found'); end if;
  if v_pair.expires_at <= now() or v_pair.status <> 'pending' then return jsonb_build_object('ok',false,'error','pair_code_invalid'); end if;
  if p_approve is not true then
    update public.diary_pairing_requests set status = 'rejected' where id = p_id;
    return jsonb_build_object('ok',true,'status','rejected');
  end if;
  if not exists(select 1 from public.diary_snapshots where owner_id = auth.uid()) then return jsonb_build_object('ok',false,'error','pair_owner_required'); end if;
  if exists(select 1 from public.diary_snapshots where owner_id = v_pair.requester_id) then return jsonb_build_object('ok',false,'error','pair_device_has_diary'); end if;
  if (select count(*) from public.diary_device_links where owner_id = auth.uid() and revoked_at is null) >= 5 then return jsonb_build_object('ok',false,'error','pair_device_limit'); end if;
  begin
    insert into public.diary_device_links(owner_id,member_id,label) values(auth.uid(),v_pair.requester_id,v_pair.requester_label) returning id into v_device;
  exception when unique_violation then
    return jsonb_build_object('ok',false,'error','pair_device_has_diary');
  end;
  update public.diary_pairing_requests set status = 'approved',device_id = v_device where id = p_id;
  return jsonb_build_object('ok',true,'status','approved');
end;
$$;

create function public.cancel_diary_pairing(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  update public.diary_pairing_requests set status = 'cancelled' where id = p_id and (owner_id = auth.uid() or requester_id = auth.uid()) and status in ('waiting','pending');
  return jsonb_build_object('ok',true);
end;
$$;

create function public.list_diary_devices()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_access jsonb; v_devices jsonb; v_pending jsonb;
begin
  v_access := public.get_my_diary_access();
  if v_access->>'role' = 'owner' then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'createdAt',created_at,'lastSeenAt',last_seen_at) order by created_at),'[]') into v_devices from public.diary_device_links where owner_id = auth.uid() and revoked_at is null;
    select jsonb_build_object('id',id,'status',status,'label',requester_label,'verificationCode',upper(verification_code),'expiresAt',expires_at) into v_pending from public.diary_pairing_requests where owner_id = auth.uid() and status = 'pending' and expires_at > now() order by created_at desc limit 1;
    return jsonb_build_object('access',v_access,'devices',v_devices,'pending',v_pending);
  end if;
  return jsonb_build_object('access',v_access,'devices','[]'::jsonb);
end;
$$;

create function public.rename_diary_device(p_id uuid, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  if length(trim(coalesce(p_label,''))) not between 1 and 80 then return jsonb_build_object('ok',false,'error','device_label_invalid'); end if;
  update public.diary_device_links set label = trim(p_label) where id = p_id and revoked_at is null and (owner_id = auth.uid() or member_id = auth.uid());
  if not found then return jsonb_build_object('ok',false,'error','device_not_found'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

create function public.revoke_diary_device(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  update public.diary_device_links set revoked_at = now() where id = p_id and revoked_at is null and (owner_id = auth.uid() or member_id = auth.uid());
  if not found then return jsonb_build_object('ok',false,'error','device_not_found'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

create function public.get_my_diary_revision()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_access jsonb; v_revision timestamptz; v_changes timestamptz;
begin
  v_access := public.get_my_diary_access();
  if v_access->>'role' = 'unpaired' then return jsonb_build_object('access',v_access); end if;
  select updated_at into v_revision from public.diary_snapshots where owner_id = (v_access->>'ownerId')::uuid and source = 'e-schools.by';
  select updated_at into v_changes from public.diary_shared_changes where owner_id = (v_access->>'ownerId')::uuid;
  return jsonb_build_object('access',v_access,'updatedAt',v_revision,'changesUpdatedAt',v_changes);
end;
$$;

create function public.get_linked_diary_snapshot()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_access jsonb; v_snapshot public.diary_snapshots; v_events jsonb;
begin
  v_access := public.get_my_diary_access();
  if v_access->>'role' <> 'linked' then return jsonb_build_object('ok',false,'error','pair_access_required'); end if;
  select * into v_snapshot from public.diary_snapshots where owner_id = (v_access->>'ownerId')::uuid and source = 'e-schools.by';
  if not found then return jsonb_build_object('ok',false,'error','diary_unavailable'); end if;
  select events into v_events from public.diary_shared_changes where owner_id = v_snapshot.owner_id;
  return jsonb_build_object('ok',true,'payload',v_snapshot.payload,'schema_version',v_snapshot.schema_version,'updated_at',v_snapshot.updated_at,'changes',coalesce(v_events,'[]'::jsonb));
end;
$$;

create function public.save_diary_change_events(p_events jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_existing jsonb; v_next jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok',false,'error','sign_in_required'); end if;
  if not exists(select 1 from public.diary_snapshots where owner_id = auth.uid()) or exists(select 1 from public.diary_device_links where member_id = auth.uid() and revoked_at is null) then return jsonb_build_object('ok',false,'error','pair_owner_required'); end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 150 or octet_length(p_events::text) > 400000 then return jsonb_build_object('ok',false,'error','changes_invalid'); end if;
  if exists(select 1 from jsonb_array_elements(p_events) event where jsonb_typeof(event) <> 'object' or coalesce(event->>'id','') = '' or coalesce(event->>'type','') not in ('grades','homework','materials') or coalesce(event->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') then return jsonb_build_object('ok',false,'error','changes_invalid'); end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select events into v_existing from public.diary_shared_changes where owner_id = auth.uid();
  select coalesce(jsonb_agg(event order by event->>'syncedAt' desc),'[]'::jsonb) into v_next from (
    select distinct on (event->>'id') event from jsonb_array_elements(p_events || coalesce(v_existing,'[]'::jsonb)) event order by event->>'id'
  ) unique_events;
  while jsonb_array_length(v_next) > 150 or octet_length(v_next::text) > 400000 loop v_next := v_next - (jsonb_array_length(v_next) - 1); end loop;
  insert into public.diary_shared_changes(owner_id,events) values(auth.uid(),v_next) on conflict(owner_id) do update set events = excluded.events,updated_at = now();
  return jsonb_build_object('ok',true,'events',v_next);
end;
$$;

create function public.get_my_diary_changes()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_access jsonb; v_events jsonb;
begin
  v_access := public.get_my_diary_access();
  if v_access->>'role' = 'unpaired' then return '[]'::jsonb; end if;
  select events into v_events from public.diary_shared_changes where owner_id = (v_access->>'ownerId')::uuid;
  return coalesce(v_events,'[]'::jsonb);
end;
$$;

-- Every exposed function verifies auth.uid() internally. No caller-supplied owner IDs.
create function public.revoke_deleted_diary_devices()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.diary_device_links set revoked_at = now() where owner_id = old.owner_id and revoked_at is null;
  update public.diary_pairing_requests set status = 'cancelled' where owner_id = old.owner_id and status in ('waiting','pending');
  delete from public.diary_shared_changes where owner_id = old.owner_id;
  return old;
end;
$$;
revoke all on function public.revoke_deleted_diary_devices() from public,anon,authenticated;
create trigger diary_deleted_devices after delete on public.diary_snapshots for each row execute function public.revoke_deleted_diary_devices();

revoke all on function public.get_my_diary_access(), public.create_diary_pairing(), public.request_diary_pairing(text,text), public.get_diary_pairing(uuid), public.respond_diary_pairing(uuid,boolean), public.cancel_diary_pairing(uuid), public.list_diary_devices(), public.rename_diary_device(uuid,text), public.revoke_diary_device(uuid), public.get_my_diary_revision(), public.get_linked_diary_snapshot(), public.save_diary_change_events(jsonb), public.get_my_diary_changes() from public, anon;
grant execute on function public.get_my_diary_access(), public.create_diary_pairing(), public.request_diary_pairing(text,text), public.get_diary_pairing(uuid), public.respond_diary_pairing(uuid,boolean), public.cancel_diary_pairing(uuid), public.list_diary_devices(), public.rename_diary_device(uuid,text), public.revoke_diary_device(uuid), public.get_my_diary_revision(), public.get_linked_diary_snapshot(), public.save_diary_change_events(jsonb), public.get_my_diary_changes() to authenticated;

commit;
