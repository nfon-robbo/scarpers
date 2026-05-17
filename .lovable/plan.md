Fix: Sleep total showing 15:56 on 17/05 (and other nights)

&nbsp;

Why it's happening

&nbsp;

The "Sleep — Google Fit & Health Connect" panel reads every row in sleep_stages for the date/source and sums duration_seconds. The database currently contains exact duplicate rows for every Google Fit sleep segment (e.g. 17/05 has 42 rows but only 21 unique segments), so the displayed total is roughly 2× the real value. 15:56 is double the actual ~7:58.

&nbsp;

The SleepCalendar / SleepStagesChart views may also be inflated.

&nbsp;

Root cause

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

supabase/functions/google-fit-sleep/index.ts re-inserts overlapping segments on every sync instead of upserting.

&nbsp;

&nbsp;

&nbsp;

The sleep_stages table has no unique constraint to prevent duplicates.

&nbsp;

Plan

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Clean existing duplicates

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Migration: delete duplicate sleep_stages rows, keeping one per (user_id, source, start_time, end_time, stage).

&nbsp;

&nbsp;

&nbsp;

Prevent future duplicates

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Migration: add a unique index on sleep_stages (user_id, source, start_time, end_time, stage).

&nbsp;

&nbsp;

&nbsp;

Update the Edge Function

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

google-fit-sleep: switch the insert to upsert with onConflict matching the new unique index (idempotent re-syncs).

&nbsp;

&nbsp;

&nbsp;

Verify

&nbsp;

&nbsp;

&nbsp;

&nbsp;

&nbsp;

Re-query 17/05 totals; expect ~7:58.

&nbsp;

&nbsp;

&nbsp;

Re-run a Google Fit sync and confirm row count is stable.

&nbsp;

&nbsp;

No UI changes required — the panel is correct once data is deduped.