## Investigation findings

I traced the toast `33:34 → 38:49`. It isn't one estimate worsening — it's **two different estimators being compared as if they were one**, plus **duplicate activities** from a Strava re-sync polluting the inputs.

### 1. Duplicate activities created at 12:00 today

A Strava import ran at 12:00 and re-inserted runs that already existed as FIT uploads. Examples for your account:

```
2026-05-22 07:58:15  FIT   2225m / 1200s   (created 22 May)
2026-05-22 07:58:15  Strava 2224m / 1395s  (created today 12:00)  ← duplicate
2026-05-21 10:34:00  FIT   2929m / 1680s   (created 21 May)
2026-05-21 10:34:00  Strava 2929m / 1680s  (created today 12:00)  ← duplicate
```

`runs_in_last_21d` in `race_prediction_history` jumped from 9 → 11 at exactly 12:00. `purgeStravaOverlaps` in `src/lib/activity-dedupe.ts` is supposed to delete Strava rows that overlap FIT rows within ±15min, but the Strava import path isn't calling it after the insert. So duplicates pile up on every re-sync.

### 2. The toast compares two unrelated estimators

History rows for this user, last 24h:

```
manual / gauge_client     →  2014s (33:34)   basis: VO2max 38 only
activity_synced / server  →  2329s (38:49)   basis: tempo 8:13/km + easy 9:34/km
```

- `RaceTimeEstimate.tsx` (the gauge on TrainingPlan) writes a **VO2max-only** estimate as `triggered_by: "manual"`.
- The edge function `race-predict` writes a **tempo+easy pace** estimate as `triggered_by: "activity_synced"`.
- In `TrainingPlan.tsx` the toast reads `previous_sec` from the edge function, which is "the last row for this distance regardless of source". The last row is almost always the gauge's VO2 estimate, so the server's pace-based estimate is diffed against the gauge's VO2 estimate. They never agree → "5:15 slower" appears any time the auto-link count grows, even with zero new running.

### 3. Server tempo is being computed from walk/run sessions

The 8:13/km "tempo" is a walk-polluted run. The doc `docs/algorithms/race-predictor.md` already flags this under "Planned filtering improvements" (title/HR/lap-CV filters, GPS run-segment extraction) — not yet implemented. With duplicates removed the predictor is still inflated, but the false "worsening" notification is the immediate user-facing bug.

## Plan

### A. Stop Strava re-imports from creating duplicate rows

In `src/lib/strava-background-import.ts`, after each page of imports completes (and once more at the end), call `purgeStravaOverlaps(userId, fitStartTimes, 15)` for the FIT activities in the touched time window. Reuse `purgeAllStravaOverlaps` on the full-account sweep path. Net effect: Strava rows that collide with a FIT row are deleted immediately, preserving the FIT-wins precedence already established in `dedupeActivities`.

Also clean up the 2 existing duplicates for this user via a one-off `purgeAllStravaOverlaps` call when the user next opens the app (or as a one-time SQL cleanup migration — your choice; I'd prefer the client sweep so it heals other users with the same issue).

### B. Stop the toast from comparing apples to oranges

In `supabase/functions/race-predict/index.ts`, change the `previous_sec` lookup to filter by `triggered_by IN ('activity_synced','plan_start','scheduled')` so it ignores the gauge's `manual / gauge_client` rows. Same-source comparison only.

Optional follow-up (not in this plan unless you want it): give the gauge a distinct `triggered_by` value like `gauge_client` instead of `manual`, so the two sources are unambiguous in the table.

### C. Suppress the toast when the change is suspicious

In `TrainingPlan.tsx` (line ~569) only fire the toast when **both**:
- `prevSec` exists and was written by the server (now guaranteed by B), and
- `runs_in_last_21d` actually increased vs the previous server row (add `previous_runs_21d` to the edge response and compare).

If runs didn't grow, still update the chart silently but don't toast — this is the contract "no new running → no notification".

### D. Note the deferred work

Race-predictor walk/run filtering (title keyword, HR < 100, lap-CV, GPS speed-segment extraction) stays as-is — it's already tracked in `docs/algorithms/race-predictor.md §11`. Out of scope for this fix.

## Files touched

- `src/lib/strava-background-import.ts` — call `purgeStravaOverlaps` per page; sweep once at end.
- `supabase/functions/race-predict/index.ts` — same-source `previous_sec`; return `previous_runs_21d`.
- `src/pages/TrainingPlan.tsx` — gate the toast on runs-count actually increasing.

No DB schema changes, no migration required.
