# How the Race Time Predictor Works

A blended prediction for 5K / 10K / Half / Marathon target time, served by the
[`race-predict`](../../supabase/functions/race-predict/index.ts) edge function.
Combines three independent estimators (tempo, VO2max, easy pace), then adjusts
for plan progress, adherence, and recent readiness.

---

## 1. Inputs

| Source | Window | Used for |
|---|---|---|
| `activities` | last 56 days | tempo & easy pace extraction, run count |
| `daily_metrics.vo2_max` | last 14 days | VO2max-based 5K time |
| `readiness_snapshots.score` | last 7 days | small ± adjustment |
| `training_plans` (active) | — | start_date, race_date, race_distance, goal_time, planned sessions |
| Request body | — | `race_distance`, `triggered_by`, `activity_id` |

Distance comes from the request (`race_distance`) or falls back to the active
plan, normalised to `"5K"`, `"10K"`, `"Half Marathon"`, or `"Marathon"`.

---

## 2. Activity filtering

A run qualifies if **all** of:

| Rule | Threshold |
|---|---|
| `activity_type` matches `/run/i` | regex |
| `distance_meters` | > 800 |
| `duration_seconds` | > 300 |
| Within the last 56 days | from `since` cutoff |

Of those, the 21-day subset (`last21`) is what drives the "enough data?" check.
If fewer than **3** qualifying runs exist in the last 21 days the function
returns an `insufficient: true` payload rather than guessing.

> 📝 **Planned filtering improvements** (not yet in `race-predict/index.ts`):
> titles containing `walk` / `interval` / `fartlek`, lap-CV > 0.30, and
> HR < 100 bpm for > 10% of the run. These checks are tracked in the
> [race-time-predictor memory](../../) but not currently enforced server-side.

---

## 3. Pace extraction

`paceOf(a) = duration_seconds / (distance_meters / 1000)` → seconds per km.

### 3a. Easy pace

From the **21-day** set:

- Keep activities with `avg_heart_rate ≤ 150` (or HR missing).
- Keep paces in the running range `240–900 s/km` (4:00–15:00/km).
- Sort ascending; take the **median**.

### 3b. Tempo pace

From the **14-day** set:

- Keep activities with `duration_seconds ≥ 900` (≥ 15 min).
- Keep paces in `180–600 s/km` (3:00–10:00/km).
- Sort ascending; take the **fastest** (first element).

> 📝 **Planned: GPS run-segment extraction** at the ≥ 7.0 km/h speed threshold
> from `raw_data.gps_track`. This would strip walk breaks out of walk/run
> interval workouts before they reach the tempo calculation. Not in current
> code — tempo today is the whole-activity average.

---

## 4. VO2max → race time

The most recent non-null `vo2_max` from the 14-day metrics window is converted
to a 5K time via a piecewise linear table (`vo2to5k()`):

| VO2max | 5K time (seconds) | (m:ss) |
|---|---|---|
| 30 | 2700 | 45:00 |
| 35 | 2220 | 37:00 |
| 42 | 1770 | 29:30 |
| 50 | 1410 | 23:30 |
| 55 | 1260 | 21:00 |
| 60 | 1140 | 19:00 |

Intermediate values are linearly interpolated; values outside the table clamp
to the nearest endpoint.

For other distances, the 5K time is extrapolated with **Riegel's formula**:

```ts
t2 = t1 × (d2 / d1) ^ 1.06
```

---

## 5. Weighted blend

Each estimator produces a candidate finish time and a weight:

| Estimator | Weight | Pace adjustment vs. race distance |
|---|---|---|
| Tempo | 0.5 | 5K −15s/km · 10K −8s/km · Half +5s/km · Marathon +20s/km |
| VO2max | 0.3 | (direct 5K time, Riegel for other distances) |
| Easy | 0.2 | 5K −75s/km · 10K −75s/km · Half −90s/km · Marathon −90s/km |

```ts
T = Σ(estimateTime × weight) / Σ(weight)
```

If none of the estimators can be built, the function returns `insufficient: true`.

> ⚠️ **Note on spec vs. code.** Earlier outlines proposed reweighting to
> VO2max 60% / tempo 30% / easy 10% with a 1.4× sanity cap. The current
> implementation uses **50 / 30 / 20** without a sanity cap. Until the planned
> run-segment extraction is in place, increasing the VO2max weight is risky
> for users with stale or inflated VO2max readings, so the change has been
> held back.

---

## 6. Adjustments

After the blend, three small modifiers tweak `T`:

### 6a. Plan progress taper

```ts
weeksCompleted = (now − plan.start_date) / (7 days)
T *= 1 − min(weeksCompleted × 0.0125, 0.08)    // max 8% faster
```

### 6b. Adherence

Plan sessions completed vs. planned (extracted from the markdown plan headers).

```ts
adherence = min(1, completed / planned)
if adherence < 0.7:
  T *= 1 + (0.7 − adherence) × 0.33
```

### 6c. Mean readiness

```ts
meanReadiness < 55  → T *= 1.02
meanReadiness > 80  → T *= 0.99
```

Final outputs:

| Field | Value |
|---|---|
| `target_sec` | T |
| `conservative_sec` | T × 1.04 |
| `stretch_sec` | T × 0.97 |
| `pace_sec_per_km` | T / distance_km |

---

## 7. Confidence

| Tier | Required |
|---|---|
| **HIGH** | tempo present **and** ≥ 6 runs in last 21d **and** an intensity session (HR ≥ 160) in last 14d |
| **MEDIUM** | ≥ 4 runs in last 21d **or** VO2max present |
| **LOW** | otherwise, or < 3 weeks into the plan with no VO2max |

`basis` lists what was actually used, e.g. `["tempo 5:42/km", "VO2max 48", "easy 6:18/km"]`.

---

## 8. History dedupe

Every successful prediction is written to `race_prediction_history`, but only
if the **last** row for the same `(user_id, distance)` either:

- differs in `predicted_seconds`, or
- is older than **6 hours**.

This stops pause/resume cycles and page reloads from flooding the table.

The row also stores `data_sources` (`{ basis, confidence, runs_in_last_21d,
adherence }`) and `triggered_by` (`plan_start | activity_synced | manual |
scheduled`).

---

## 9. Worked example

User predicting a 10K (`distance_km = 10`).

| Source | Value |
|---|---|
| VO2max (latest, last 14d) | 42 |
| Tempo (fastest ≥ 15-min run, last 14d) | 5:42/km → 342 s/km |
| Easy (median HR ≤ 150 pace, last 21d) | 6:30/km → 390 s/km |
| Runs in last 21d | 7 |
| `weeksCompleted` | 4 |
| `adherence` | 0.85 |
| Mean readiness (7d) | 72 |

**Estimates**:

| Estimator | Calculation | Time (s) | Weight |
|---|---|---|---|
| Tempo | `(342 − 8) × 10` | 3340 | 0.5 |
| VO2max | Riegel from VO2 42 → 5K 1770s → `1770 × (10/5)^1.06` | 3690 | 0.3 |
| Easy | `(390 − 75) × 10` | 3150 | 0.2 |

```text
T = (3340×0.5 + 3690×0.3 + 3150×0.2) / 1.0
  = (1670 + 1107 + 630) / 1.0
  = 3407 s    → 56:47
```

**Adjustments**:

| Step | Multiplier | T (s) |
|---|---|---|
| Plan taper (4 wk × 0.0125 = 5%) | × 0.95 | 3237 |
| Adherence 0.85 (no penalty) | × 1.00 | 3237 |
| Mean readiness 72 (neutral) | × 1.00 | 3237 |

**Outputs**:

| Field | Value |
|---|---|
| `target_sec` | 3237 → **53:57** |
| `conservative_sec` | 3367 → **56:07** |
| `stretch_sec` | 3140 → **52:20** |
| `pace_sec_per_km` | 324 → **5:24/km** |
| `confidence` | HIGH |

---

## 10. Where it's consumed

- **`src/components/RaceTimeEstimate.tsx`** — summary card with goal comparison.
- **`src/components/RaceEstimateTabs.tsx`** — distance tabs + gauge.
- **`src/components/RacePredictionGraph.tsx`** — progress chart driven by `race_prediction_history`.
- **`src/components/AIChatbot.tsx`** — race-prediction intent calls this function before answering.
- **`supabase/functions/intervals-sync`** — uses predicted pace bands when writing workout targets (target ranges, not single values, to satisfy Garmin sync).

---

## 11. Known gaps (tracked, not yet implemented)

- GPS run-segment extraction (≥ 7.0 km/h, 8-min minimum) to clean walk/run intervals.
- Title-keyword filter (`walk` / `interval` / `fartlek`).
- Lap-CV > 0.30 and low-HR-duration filters.
- VO2max-first weighting (60/30/10) and the 1.4× sanity cap.
- Pace-range output (`±15 s/km`) emitted directly from this function rather than computed downstream.
