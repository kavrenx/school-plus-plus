begin;

alter table public.support_agents
  add column if not exists can_view_admin boolean not null default false;

update public.support_agents agent
set can_view_admin = true
where exists (
  select 1
  from auth.users account
  where account.id = agent.user_id
    and lower(account.email) = 'support@schoolpp.com'
);

create or replace function public.is_schoolpp_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_agents
    where user_id = auth.uid()
      and can_view_admin
  );
$$;

revoke all on function public.is_schoolpp_admin() from public, anon;
grant execute on function public.is_schoolpp_admin() to authenticated;

create table public.site_activity_daily (
  activity_date date not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  device text not null default 'unknown'
    check (device in ('desktop', 'mobile', 'unknown')),
  browser text not null default 'unknown'
    check (browser in ('chrome', 'firefox', 'brave', 'opera', 'edge', 'other', 'unknown')),
  page_views integer not null default 0 check (page_views >= 0),
  onboarding_completions integer not null default 0 check (onboarding_completions >= 0),
  extension_detections integer not null default 0 check (extension_detections >= 0),
  sync_count integer not null default 0 check (sync_count >= 0),
  support_opens integer not null default 0 check (support_opens >= 0),
  diary_requests integer not null default 0 check (diary_requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (activity_date, user_id)
);

create index site_activity_daily_date_idx
  on public.site_activity_daily (activity_date desc);

alter table public.site_activity_daily enable row level security;
revoke all on public.site_activity_daily from anon, authenticated;

create function public.record_site_activity(
  p_event text,
  p_device text default 'unknown',
  p_browser text default 'unknown'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_day date := (timezone('Europe/Minsk', now()))::date;
  safe_device text := case
    when p_device in ('desktop', 'mobile') then p_device
    else 'unknown'
  end;
  safe_browser text := case
    when p_browser in ('chrome', 'firefox', 'brave', 'opera', 'edge', 'other') then p_browser
    else 'unknown'
  end;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_event not in (
    'page_view',
    'onboarding_completed',
    'extension_detected',
    'sync_received',
    'support_opened',
    'diary_request_sent'
  ) then
    raise exception 'INVALID_ACTIVITY_EVENT' using errcode = '22023';
  end if;

  insert into public.site_activity_daily (
    activity_date,
    user_id,
    device,
    browser,
    page_views,
    onboarding_completions,
    extension_detections,
    sync_count,
    support_opens,
    diary_requests
  )
  values (
    current_day,
    current_user_id,
    safe_device,
    safe_browser,
    case when p_event = 'page_view' then 1 else 0 end,
    case when p_event = 'onboarding_completed' then 1 else 0 end,
    case when p_event = 'extension_detected' then 1 else 0 end,
    case when p_event = 'sync_received' then 1 else 0 end,
    case when p_event = 'support_opened' then 1 else 0 end,
    case when p_event = 'diary_request_sent' then 1 else 0 end
  )
  on conflict (activity_date, user_id) do update
  set device = excluded.device,
      browser = excluded.browser,
      page_views = public.site_activity_daily.page_views + excluded.page_views,
      onboarding_completions = public.site_activity_daily.onboarding_completions + excluded.onboarding_completions,
      extension_detections = public.site_activity_daily.extension_detections + excluded.extension_detections,
      sync_count = public.site_activity_daily.sync_count + excluded.sync_count,
      support_opens = public.site_activity_daily.support_opens + excluded.support_opens,
      diary_requests = public.site_activity_daily.diary_requests + excluded.diary_requests,
      updated_at = now();
end;
$$;

revoke all on function public.record_site_activity(text, text, text) from public, anon;
grant execute on function public.record_site_activity(text, text, text) to authenticated;

create function public.get_admin_dashboard(p_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days_count integer := greatest(7, least(coalesce(p_days, 14), 31));
  current_day date := (timezone('Europe/Minsk', now()))::date;
  result jsonb;
begin
  if not public.is_schoolpp_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generatedAt', now(),
    'summary', jsonb_build_object(
      'viewsToday', coalesce((select sum(page_views) from public.site_activity_daily where activity_date = current_day), 0),
      'visitorsToday', (select count(*) from public.site_activity_daily where activity_date = current_day),
      'visitors7d', (select count(distinct user_id) from public.site_activity_daily where activity_date >= current_day - 6),
      'syncsToday', coalesce((select sum(sync_count) from public.site_activity_daily where activity_date = current_day), 0),
      'totalSnapshots', (select count(*) from public.diary_snapshots),
      'freshSnapshots', (select count(*) from public.diary_snapshots where updated_at >= now() - interval '24 hours'),
      'staleSnapshots', (select count(*) from public.diary_snapshots where updated_at < now() - interval '7 days'),
      'openConversations', (select count(*) from public.support_conversations where status = 'open'),
      'messagesToday', (select count(*) from public.support_messages where created_at >= current_day),
      'newRequests', (select count(*) from public.diary_requests where status = 'new'),
      'requestsInReview', (select count(*) from public.diary_requests where status = 'in_review'),
      'lastSyncAt', (select max(updated_at) from public.diary_snapshots),
      'lastSupportAt', (select max(created_at) from public.support_messages)
    ),
    'funnel', jsonb_build_object(
      'visitors30d', (select count(distinct user_id) from public.site_activity_daily where activity_date >= current_day - 29),
      'onboarded30d', (select count(distinct user_id) from public.site_activity_daily where activity_date >= current_day - 29 and onboarding_completions > 0),
      'extensions30d', (select count(distinct user_id) from public.site_activity_daily where activity_date >= current_day - 29 and extension_detections > 0),
      'synced30d', (select count(distinct user_id) from public.site_activity_daily where activity_date >= current_day - 29 and sync_count > 0),
      'supportOpens30d', coalesce((select sum(support_opens) from public.site_activity_daily where activity_date >= current_day - 29), 0),
      'diaryRequests30d', coalesce((select sum(diary_requests) from public.site_activity_daily where activity_date >= current_day - 29), 0)
    ),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', item.day,
          'views', item.views,
          'visitors', item.visitors,
          'syncs', item.syncs
        ) order by item.day
      )
      from (
        select calendar.day::date as day,
               coalesce(sum(activity.page_views), 0) as views,
               count(activity.user_id) as visitors,
               coalesce(sum(activity.sync_count), 0) as syncs
        from generate_series(
          current_day - (days_count - 1),
          current_day,
          interval '1 day'
        ) as calendar(day)
        left join public.site_activity_daily activity
          on activity.activity_date = calendar.day::date
        group by calendar.day
      ) item
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('name', item.device, 'count', item.visitors) order by item.visitors desc)
      from (
        select device, count(distinct user_id) as visitors
        from public.site_activity_daily
        where activity_date >= current_day - 29
        group by device
      ) item
    ), '[]'::jsonb),
    'browsers', coalesce((
      select jsonb_agg(jsonb_build_object('name', item.browser, 'count', item.visitors) order by item.visitors desc)
      from (
        select browser, count(distinct user_id) as visitors
        from public.site_activity_daily
        where activity_date >= current_day - 29
        group by browser
      ) item
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_admin_dashboard(integer) from public, anon;
grant execute on function public.get_admin_dashboard(integer) to authenticated;

commit;
