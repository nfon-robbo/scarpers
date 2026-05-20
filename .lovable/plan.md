## Problem

The `readiness-hourly-snapshot` cron (jobid 10, schedule `45 * * * *`) fires every hour but every call returns `403 Forbidden`. The cron's `Authorization` header is built from `vault.decrypted_secrets` entry `email_queue_service_role_key`, which no longer matches the current `SUPABASE_SERVICE_ROLE_KEY` the edge function validates against. So the hourly snapshot has not actually run for hours — the snapshots you do see (07:00, 08:00, 09:19, 12:58) came from app-side morning/eod triggers.

## Fix

Rewrite the cron job to use the current service role key directly via Supabase secrets, removing the dependency on the stale vault entry.

Use the **supabase insert tool** (not migration, since this embeds the service-role key value) to:

1. `cron.unschedule('readiness-hourly-snapshot')`
2. `cron.schedule('readiness-hourly-snapshot', '45 * * * *', $$ ... $$)` where the body posts to `/functions/v1/readiness-hourly-snapshot` with `Authorization: Bearer <current SUPABASE_SERVICE_ROLE_KEY>`.

Also audit and fix any **other cron jobs** that reference the same stale vault secret (e.g. email queue, auto-sync) so they don't silently 403 too.

## Verification

- Query `cron.job_run_details` after the next :45 tick and confirm `net._http_response` returns `200`.
- Check `readiness_snapshots` to see a new `kind = 'hourly'` (or whatever the cron writes) row appear at the next hour.
- Confirm `supabase--edge_function_logs` for `readiness-hourly-snapshot` shows activity (currently empty — function is never reached).

## Note on automatic syncs

The hourly function already triggers `intervals-wellness` and `google-fit-sleep` via `auto-sync` before computing the score, so once the auth is fixed, data sync + score generation will both resume automatically every hour.
