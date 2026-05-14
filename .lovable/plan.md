## Goal

Make morning and end-of-day readiness genuinely different, and have a background job take an hourly snapshot per user so the trend reflects fresh data without the dashboard recomputing on every load.

## 1. Database schema

Add a `kind` column to `readiness_snapshots`:

- `kind text not null default 'eod'` with check `kind in ('morning','eod')`
- Index on `(user_id, kind, recorded_at desc)` for fast latest lookups
- Backfill: mark all existing rows as `kind = 'morning'` (the recent recalc used the morning algorithm)

## 2. Two scoring modes

In `src/lib/readiness.ts`, extend `computeReadiness(d, mode)` where `mode: 'morning' | 'eod'` (default `'eod'` to keep callers working).

Morning mode reflects state immediately after sleep sync — overnight recovery only:

- Same Phase 1 core factors (Sleep, Deep, RHR, HRV, Yesterday's Load)
- Skip all modifiers: Recovery, Sleep Debt, Training Ramp / Freshness, Today's Effort
- Skip `bodyBatteryDrain` entirely (no hours-awake passive drain, no active drain, no daytime charge)
- Body Battery factor not added
- Sleep Debt still allowed (overnight signal) — but Today's Effort/Recovery omitted

End-of-day mode = current behaviour, unchanged.

## 3. Hourly background job

New edge function `readiness-hourly-snapshot` (no JWT verify, service role):

1. List all users with at least one activity, sleep stage, or daily metric in the last 14 days (the "active user" cohort)
2. For each user:
   - Trigger the existing per-user sync path used by `auto-sync` (Google Fit + Intervals; Strava already excluded from auto sync per memory) so the latest data lands first
   - Build the same `ReadinessData` the dashboard builds (rebuild the data assembly server-side using existing tables)
   - Call `computeReadiness(data, 'morning')` and `computeReadiness(data, 'eod')`
   - Insert two rows into `readiness_snapshots` with appropriate `kind`, `score`, `factors`, `recorded_at = now()`, `hour = current UTC hour`
3. Always insert even when no new source data (so trend points stay consistent)

Schedule via `pg_cron` at `0 * * * *` (top of every UTC hour) calling the function with the service role key (uses `supabase--insert` to register because the URL contains the project ref).

The existing daily auto-sync cron stays for now; the hourly job effectively supersedes it but we won't remove it in this change.

## 4. Dashboard reads

`ReadinessWidget`:

- Drop the heuristic that picks "morning" vs "eod" from a single pool
- Query latest morning snapshot and latest eod snapshot per day for the 7-day window using the new `kind` column
- Live computation on the dashboard remains for the "now" display only; the trend lines come purely from snapshots
- Hourly cache on the dashboard is kept

## 5. Backfill historical morning scores

Existing post-14/05 rows are already morning-style — relabel them `kind='morning'`. We won't synthesise a historical end-of-day series; the eod line will start populating from the first hourly cron run forward (an explicit gap before that is honest).

## Technical notes

- Server-side `ReadinessData` assembly mirrors the queries in `ReadinessWidget` lines ~408–520 and the per-user `computeReadiness` inputs from earlier in the file. Extract a small shared helper in `supabase/functions/_shared/readiness-data.ts` so the edge function and the client stay consistent (the client can keep using it via copy, since edge functions can't import from `src/`).
- The sync trigger reuses the same logic as `auto-sync/index.ts` — call its per-user routine in-process rather than HTTP-invoking it.
- `kind` index avoids full table scans as snapshots accumulate (24 rows × users × day).
- Cron registration uses `supabase--insert` because the SQL embeds the project URL and anon key.

## Out of scope

- Removing the existing daily auto-sync cron
- Backfilling a historical end-of-day series
- UI copy changes beyond what the existing morning/eod toggle already shows