
## What I found in your data (verified)

- **Confirmed benchmark row** `fe76a28e…` exists, `status=confirmed`, `active=true`, `benchmark_protocol=30min`, `effort_window_source=lap`.
  - `effort_window_duration_s = 1855.126` (elapsed), `effort_window_distance_m = 3375.1`
  - `threshold_pace_s_per_km = 549.65` → **9:09/km** — this is elapsed pace **including the 4:36 timer stop**
  - `threshold_hr = 145`, `lthr = 145` — this is the **whole-activity average HR**, not the effort window's HR
  - `confidence_score = 90`, deductions: `hr_sensor_wrist -10` only
- **`hr_zones` table is empty for you** — `applyMeasuredZones` is never called on the auto-confirm path, so no measured band was ever written. Every zone consumer falls back to observed-max (186 bpm → LTHR 166 → the estimated bands you saw).
- **Lap 2 evidence for the stop**: `elapsed 719.798s` vs `moving 444.03s` (275.8s of timer-stopped time). Recomputed on the 4 effort laps:
  - moving-time pace ≈ **7:47/km**, threshold HR (moving-time-weighted over laps 1–4) ≈ **156 bpm** — matches what you're telling me.
- **Plan gen** reads `resolveZonesForUser` without the measured LTHR; the "estimated" zones you see (<141, 142–149, 150–157, 158–168) are the observed-max path output.

## Fixes (in this order)

### 1. Effort-window pace and HR from moving time, not elapsed
`src/lib/benchmark-persist.ts` + `src/lib/benchmark-detection.ts`:
- `identifyEffortWindow` (lap path) already sums `duration_s`; switch the 30-min path to sum `moving_time_s` for the contiguous window, and record `elapsed_time_s - moving_time_s` per lap as `stoppedSeconds`. Return `{ durationSeconds (moving), distanceMeters, stoppedSeconds }`.
- `confirmBenchmark`:
  - `threshold_pace_s_per_km = duration_moving / (distance / 1000)`
  - Replace `threshold_hr = activity.avg_heart_rate` with a **lap-weighted average of `avg_heart_rate` across the effort laps, weighted by moving time**. Falls back to activity avg only when no laps exist (derived path).
  - Store `stoppedSeconds` on the row (new column `effort_window_stopped_s`).

### 2. Timer-stop confidence deduction
`src/lib/benchmark-calculations.ts` (`BenchmarkConfig.CONFIDENCE_DEDUCTIONS`):
- Add `TIMER_STOPPED_IN_EFFORT: 15` and threshold constant `TIMER_STOPPED_MIN_S: 60`.
- `scoreConfidence` gains `timerStoppedSInEffort`; when it exceeds `TIMER_STOPPED_MIN_S`, push `{reason: "timer_stopped_in_effort", points: 15}`.
- `BenchmarkHistory` renders "Timer stopped: 4:36" when `effort_window_stopped_s > 0`.

### 3. Migration
```text
ALTER TABLE benchmark_results ADD COLUMN effort_window_stopped_s numeric;
```
(No grant/policy changes — same access as siblings.)

### 4. Measured LTHR must flow into every zone resolver
Only one thing changes here — the client already passes `measured_threshold_hr` into `ai-coach`, but `resolveZonesForUser` inside `ai-coach` is called with **no `measuredLthr` option**, so the shared resolver still estimates from observed max.
- `supabase/functions/ai-coach/index.ts` line 1862: pass `{ measuredLthr: measured_threshold_hr ?? null }`.
- `supabase/functions/intervals-sync/index.ts` line 369: pull the latest confirmed `benchmark_results.lthr` for the user and pass it.
- `useHrZones` hook: read the latest active-confirmed benchmark's `lthr` and pass it into `resolveZonesForUser`.
- `resolveZonesForUser` already accepts `opts.measuredLthr` and hands off to `resolveZones`, which returns `lthrSource: "measured"` — no change needed there.
- Also **write** `hr_zones` on confirmation: call `applyMeasuredZones` from `confirmBenchmark` for the 30-min protocol (it already refuses 3k/5k and enforces the 100–210 plausibility gate). This keeps the ZoneComparisonDialog for the "compare & apply" UX but ensures the canonical row exists.

### 5. Model must not write bpm ranges
`supabase/functions/ai-coach/index.ts` (plan-gen prompt around lines 2270–2300):
- Add a hard rule: "Zones may be referenced by **label only** (`Z1`, `Z2`, `Z1–Z2`). Do not write bpm numbers next to zone labels — the app renders them from the resolver."
- Add a post-processor after the stream completes: scan every generated segment for `\bZ[1-5](?:\s*[–-]\s*Z[1-5])?\s*\(\s*\d{2,3}\s*[-–]\s*\d{2,3}\s*bpm\s*\)` and rewrite the `(…bpm)` block using `zoneRangeLabel(zone, zones)`. Log any replacement (`{date, segment, model_bpm, resolver_bpm}`) and surface the diff to me on the next benchmark reprocess.
- Same replacement pass runs in `plan-continuation` output.

### 6. Race day "REST DAY" bug + race pace derivation
- The 17/10/2026 rest-day header comes from the coach's rest-day boilerplate being emitted for the race date. Add a guardrail in the prompt: "If a date equals `race_date`, its header MUST be `Race Day` and it MUST contain the goal race workout — never `REST DAY`." Add a validator in `src/lib/plan-validation.ts` to catch a "REST DAY" header on race_date and re-request that day via `plan-continuation`.
- Race pace target derivation: currently `goal_time` is user-supplied and, if missing, the model invents splits. Change:
  - Predict race time from measured threshold via `predict5kSeconds` (already implemented) and the existing Riegel exponent for 10k/HM/M distances.
  - Inject predicted target pace + acceptable window into the prompt and require the race day session to use it verbatim.
  - Add "**race pace must be trained before race day**": require the plan to include at least 3 race-pace sessions (progressive dose) in the final 6 weeks. Validator flags plans that do not.

### 7. Intervals.icu / watch description fixes
`src/pages/TrainingPlan.tsx` benchmark stub (lines 2956–2965):
- Change warm-up Notes to `Easy jog to loosen up` (remove "a few strides at the end").
- Trim workout name — strip trailing whitespace when building `Scarpers Dash - …`.

`supabase/functions/intervals-sync/index.ts` (`formatWorkoutDescription`):
- Find the truncation (currently silent — likely a `.slice(0, N)` or Intervals' own 255-char cap). Change the description to a compact, complete instruction (≤240 chars) instead of the long freehand one. For a benchmark, emit the fixed verbatim protocol: "Threshold benchmark — hold the hardest even effort you can for 30 min. No pacing target. Warm up 5 min, cool down 5 min." Assert length in code and log a warning if it would exceed the cap.

### 8. Reprocess your existing benchmark
One-off script (not a migration):
- Recompute `threshold_pace_s_per_km`, `threshold_hr`, `lthr`, `effort_window_duration_s`, `effort_window_stopped_s`, `confidence_score`, `confidence_deductions` for row `fe76a28e-…` using laps 1–4 of activity `c3ac0ea5-…`.
- Insert the corresponding `hr_zones` row via `applyMeasuredZones`.
- Report back to you:
  - measured pace, HR, LTHR, zones (Z1–Z4 bounds)
  - confidence score + every deduction (expect `hr_sensor_wrist -10`, `timer_stopped_in_effort -15`)
  - effort-window path (`lap`)
- Then regenerate the plan and show you the zone lines + race-day session.

## Out of scope (say so if you want them)
- Rewriting the derived-path (Path 2) to also subtract timer-stopped time from stream data — will file separately unless you want it now.
- Auto-linking `hr_zones` rows to historic benchmarks that predate this change (only your latest is affected).
