```
Goal
Stop the race-time predictor producing absurdly slow times (e.g. 47:27 5K at VO2 max 42) caused by walk/run interval sessions contaminating the tempo and easy pace baselines.
All changes are confined to `supabase/functions/race-predict/index.ts` plus a small UI tweak in `src/components/RaceTimeEstimate.tsx` to surface the new estimator breakdown.

Changes

1. Filter contaminated activities (new helper `isCleanContinuousRun`)
Reject an activity from tempo/easy pools if ANY of:

* Title/name regex matches `/walk|w\/r|w\+r|run\/walk|interval|fartlek|rep(s|eats)?/i` (use `raw_data.name` if present, else fall back to `activity_type`).
* Average pace slower than 8:30/km (running pace ceiling — slower means it's a walk-heavy session).
* HR-based walk share: if `raw_data.hr_samples` / lap data available, drop when >10% of samples are <100 bpm. If hr_samples is missing, SKIP this check (don't reject) — the activity can still pass via the other 3 filters. This prevents rejecting activities from older Garmin models that don't record second-by-second HR.
* Lap variance: if `raw_data.laps` exists with ≥3 laps, compute coefficient of variation on lap pace; reject when CV > 0.30 (alternating run/walk).

Keep the existing min-distance (>800 m) and min-duration (>300 s) gates.

2. Warm-up/cool-down trim
For tempo candidates only: if `raw_data.laps` is present, drop the first and last lap when either is >2:00/km slower than the median of the middle laps, then recompute pace from remaining laps. If no lap data, fall back to the current single average pace.

3. Walk/run-phase fallback
After filtering, if `cleanContinuousRuns.length === 0` in last 14 days:

* Set tempo weight 0.
* Use VO2 max at 70%, easy pace at 30% (only if easy pool survived filtering, else VO2 max 100%).
* Return `basis_note: "Prediction based primarily on VO2 max — tempo data will improve as continuous running develops."`

If no VO2 max data exists at all:
* Use tempo (if clean data exists) + easy pace weights only
* Set confidence = "LOW"
* Add warning: "No VO2 max data available — prediction based on pace data alone. Sync a fitness tracker for more accurate estimates."

4. Rebalance default weights
When clean tempo data exists:

* VO2 max: 0.60 (was 0.30)
* Tempo: 0.30 (was 0.50)
* Easy: 0.10 (was 0.20)

5. VO2-max sanity cap
After computing `T`, derive a VO2-only baseline `T_vo2` via `vo2to5k` + Riegel for the chosen distance. If `T > T_vo2 * 1.40`, replace `T` with `T_vo2`, set `confidence = "LOW"`, and attach:
```

warning: "Prediction looked unusually slow for VO2 max {n} — likely walk/run training data. Falling back to VO2-max-only estimate."

```

6. Estimator breakdown in response
Extend the JSON response with a `breakdown` array, e.g.:
```

[ { src: "tempo", pace: "9:05/km", note: "from walk/run sessions — excluded" }, { src: "vo2max", value: 42, predicted_5k_sec: 1770, weight: 0.7 }, { src: "easy", note: "contaminated by walk breaks — excluded" } ]

```

Each estimator records whether it contributed, was excluded, and why.

7. UI surface
In `RaceTimeEstimate.tsx`, render `breakdown` as a small "How we calculated this" disclosure under the predicted times, plus a yellow warning banner when `warning` is set. No layout changes.

Technical notes

* `vo2to5k` table already exists; reuse it for both the VO2 estimator and the sanity cap.
* Riegel exponent 1.06 already used; keep it.
* Adherence, readiness and maturity multipliers stay unchanged.
* Cache key (7-day per distance) unchanged — predictions will refresh naturally as users re-run.
* No DB schema changes.
* Chatbot intent trigger and `race_time_predictions` cache flow unchanged.

Out of scope

* No changes to plan generation, chatbot prompt, or workout titles.
* No new tables or migrations.
```