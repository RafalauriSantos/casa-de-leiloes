-- Run once per environment (never committed with real values). It reads the app URL and the
-- cron secret from Supabase Vault, so no secret lives in this file or in a migration:
--   select vault.create_secret('https://<your-domain>', 'app_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
select cron.unschedule('close-due') where exists (select 1 from cron.job where jobname = 'close-due');

select cron.schedule(
  'close-due',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || '/api/internal/close-due',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 20000
  );
  $$
);
