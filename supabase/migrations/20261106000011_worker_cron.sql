-- Vibuzz — background worker for serverless deployments (Supabase Edge Functions)
-- pg_cron calls the API's /v1/internal/tick every minute to process the job queue
-- (memory consolidation, summaries, scene tracking, embeddings, cleanup).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create table if not exists private.settings (
  key text primary key,
  value text not null default ''
);
revoke all on private.settings from public, anon, authenticated;

-- Random token generated in the database; never leaves it except in the cron call.
insert into private.settings (key, value)
values ('cron_token', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Set once the API is deployed, e.g.:
--   update private.settings set value = 'https://<ref>.supabase.co/functions/v1/vibuzz-api' where key = 'api_url';
insert into private.settings (key, value) values ('api_url', '') on conflict (key) do nothing;

create or replace function public.verify_cron_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(length(p_token) > 0 and p_token = (select value from private.settings where key = 'cron_token'), false);
$$;
revoke execute on function public.verify_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_cron_token(text) to service_role;

select cron.unschedule('vibuzz-worker') where exists (select 1 from cron.job where jobname = 'vibuzz-worker');
select cron.schedule(
  'vibuzz-worker',
  '* * * * *',
  $$
  select net.http_post(
    url := (select value from private.settings where key = 'api_url') || '/v1/internal/tick',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-token', (select value from private.settings where key = 'cron_token')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
  where exists (select 1 from private.settings where key = 'api_url' and value <> '');
  $$
);
