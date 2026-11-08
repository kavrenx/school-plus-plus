-- Set schoolpp_support_dispatch_url and schoolpp_support_dispatch_secret in Vault first.
-- Use the same dispatch secret as the Edge Function, separate from the Telegram token.
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'schoolpp-support-telegram',
  '* * * * *',
  $job$
    select net.http_post(
      url := endpoint.decrypted_secret,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Schoolpp-Dispatch', secret.decrypted_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 50000
    )
    from vault.decrypted_secrets as endpoint
    cross join vault.decrypted_secrets as secret
    where endpoint.name = 'schoolpp_support_dispatch_url'
      and secret.name = 'schoolpp_support_dispatch_secret'
      and endpoint.decrypted_secret ~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/support-notifications$'
      and secret.decrypted_secret ~ '^[a-f0-9]{64}$'
      and exists (
        select 1 from schoolpp_support.notifications where available_at <= now()
      );
  $job$
);

commit;
