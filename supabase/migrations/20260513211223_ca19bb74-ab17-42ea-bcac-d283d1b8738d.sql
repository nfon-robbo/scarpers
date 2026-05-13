-- Update auto-sync cron jobs to authenticate with the service role key
-- (pulled from vault) instead of the anon key, so the function can reject
-- unauthenticated callers.

SELECT cron.unschedule('auto-sync-strava');
SELECT cron.unschedule('auto-sync-intervals');
SELECT cron.unschedule('auto-sync-google-fit');

SELECT cron.schedule(
  'auto-sync-strava',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://datdwxsugeobqigtopnz.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{"type": "strava"}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'auto-sync-intervals',
  '15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://datdwxsugeobqigtopnz.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{"type": "intervals-wellness"}'::jsonb
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'auto-sync-google-fit',
  '30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://datdwxsugeobqigtopnz.supabase.co/functions/v1/auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{"type": "google-fit-sleep"}'::jsonb
  ) AS request_id;
  $$
);