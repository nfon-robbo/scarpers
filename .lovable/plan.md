
# Race prediction history + progress graph

Add a persistent history table for race-time predictions, auto-recalculate after every completed workout, and surface a progress graph on the Training Plan page so users can see their estimate improve over the course of the plan.

## 1. Database — new `race_prediction_history` table

Migration creates an append-only history table (one row per recalculation).

Columns:
- `id`, `user_id`, `created_at`, `calculated_at`
- `distance` (text, e.g. `5K`, `10K`)
- `predicted_seconds` (int) — main estimate
- `predicted_pace_per_km` (int)
- `vo2_max` (numeric, nullable)
- `data_sources` (jsonb) — breakdown weights & counts at time of calc
- `triggered_by` (text) — `plan_start` | `activity_synced` | `manual` | `scheduled`
- `activity_id` (uuid, nullable — no FK, since `activities.id` is not a unique constraint target in this schema)

Indexes:
- `(user_id, distance, calculated_at DESC)` for graph queries
- `(user_id, created_at DESC)` for recent lookups

RLS: users can `SELECT` / `INSERT` their own rows. No update/delete (audit trail). Service role full access for edge function writes.

## 2. Edge function — `race-predict` updates

In `supabase/functions/race-predict/index.ts`:

- **Cache key** changes from `${userId}|${distance}` to `${userId}|${distance}|${activityCount28d}|${latestVo2Date}` so cache auto-invalidates when new activities arrive or VO2 max changes. Accept a `force: true` body flag to bypass cache for manual recalc.
- **History write**: after a successful calculation, insert a row into `race_prediction_history` with `predicted_seconds = target_sec`, the basis array as `data_sources`, and `triggered_by` from the request body (defaults to `'manual'`). Skip the write if the latest row for `(user_id, distance)` has the same `predicted_seconds` AND was written <6h ago (dedupe near-duplicates).
- Return the previous prediction alongside the new one so the client can show a delta toast.

## 3. Auto-recalc trigger — client side

In `src/pages/TrainingPlan.tsx`:

- When a workout becomes "completed" (new linked activity appears for a plan day that didn't have one on previous render), debounce 2s then call `race-predict` with `{ triggered_by: 'activity_synced', force: true }`.
- On plan creation/activation (detect first mount with a plan and zero history rows for this distance), call once with `{ triggered_by: 'plan_start' }` to seed a baseline data point.
- Show a sonner toast on significant change (>30s improvement or regression): `🎯 Race estimate updated: 35:26 → 32:57 (2:29 faster!)`.

Background/async — do not block UI.

## 4. `RaceTimeEstimate.tsx` — last-updated + trend arrow

- Add "Last updated 2h ago" line under the estimate.
- Add small trend arrow vs previous history row: ↓ green (faster), ↑ amber (slower), → muted (steady ±10s).
- Add a "Recalculate" button that calls the edge function with `force: true`.

## 5. New component — `src/components/RacePredictionGraph.tsx`

- Fetches all rows from `race_prediction_history` for the current user + plan's distance, ordered by `calculated_at`.
- Renders a Recharts `LineChart` (already in deps) with:
  - X axis: date (DD/MM/YYYY, UK format per project rule)
  - Y axis: predicted time in MM:SS, inverted so "down" = faster
  - Reference line at `goal_time` (dashed)
  - Tooltip showing date, time, trigger reason, VO2 max
- Empty state: "Your race estimate will appear here once your first workout is recorded."
- Mounted on Training Plan page, just below the existing `RaceTimeEstimate` card.

## 6. Out of scope (per spec)

- Algorithm changes (already correct)
- Real-time mid-workout updates
- Push notifications
- Multi-distance comparison on one graph
- Graph image export

## Files to change

- `supabase/migrations/<ts>_race_prediction_history.sql` — new table + RLS
- `supabase/functions/race-predict/index.ts` — cache key, history insert, force flag, previous-value return
- `src/pages/TrainingPlan.tsx` — auto-recalc on workout completion, seed on plan start, toast on delta, mount graph
- `src/components/RaceTimeEstimate.tsx` — last-updated, trend arrow, recalc button
- `src/components/RacePredictionGraph.tsx` — new Recharts component
- `src/integrations/supabase/types.ts` — auto-regenerated after migration

## Technical notes

- History writes are dedup'd in the edge function so accidental double-syncs don't pollute the graph.
- Toast threshold (30s) avoids notification spam from minor noise.
- No FK on `activity_id` (matches existing pattern — `activities.id` isn't a unique constraint target across the codebase).
- Cache key change is backward-compatible (old cache entries simply miss and recompute once).
