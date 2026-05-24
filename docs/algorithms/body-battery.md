# How the Body Battery Works

A phone-battery model of energy reserves (0–100%). It **charges** overnight
from sleep quality and **drains** during the day at an accelerating rate, with
extra drain from workouts. All math lives in
[`src/lib/body-battery.ts`](../../src/lib/body-battery.ts) and is shared
between the client (`readiness.ts`), the hourly snapshot edge function
(`readiness-hourly-snapshot`), and the 48h chart.

---

## 1. Inputs

```ts
computeBodyBattery({
  sleep: SleepInputs,            // sleep quality, duration, stages, HRV
  wakeTimeIso: string | null,    // when the user woke (fallback: 07:00 today)
  todayActivities: ActivitySpan[], // each: startIso, durationSec, intensityLoad
  now?: number                   // optional override of "now"
})
```

`SleepInputs`:

| Field | Used for |
|---|---|
| `sleepScore` | Fallback when duration is missing |
| `sleepHours` | Duration bonus (primary) |
| `deepPct`, `remPct` | Stage-quality bonus |
| `hrv`, `hrvBaseline` | HRV adjustment |
| `recentSleepAvgHours`, `baselineSleepAvgHours` | Sleep-debt adjustment |

---

## 2. Starting charge (`initialBatteryFromSleep`)

Starts at **base 45**, then adds/subtracts up to ~45 pts. Clamped to **10–100**.

### 2a. Duration (up to +40)

| Hours slept | Bonus |
|---|---|
| ≤ 0 | 0 |
| 0–7 | `hours / 7 × 40` |
| 7–9 | **+40** (plateau) |
| 9–10 | `40 − (hours − 9) × 3` (gentle taper) |
| > 10 | `max(25, 37 − (hours − 10) × 2)` |

If `sleepHours` is missing but `sleepScore` exists: `+ sleepScore/100 × 35`.

### 2b. Deep sleep bonus (up to +12)

| Deep % | Bonus |
|---|---|
| ≥ 15 | +12 |
| 12–15 | +9 |
| 10–12 | +6 |
| 7–10 | +3 |
| < 7 | 0 |

### 2c. REM bonus (up to +8)

| REM % | Bonus |
|---|---|
| ≥ 20 | +8 |
| 15–20 | +5 |
| 10–15 | +2 |
| < 10 | 0 |

If neither deep nor REM are present but `sleepScore` is: `+ sleepScore/100 × 10`.

### 2d. HRV vs baseline (±10)

`pct = (hrv − baseline) / baseline × 100`

| pct | Adjustment |
|---|---|
| ≥ +10 | +10 |
| +5 to +10 | +7 |
| −5 to +5 | 0 |
| −15 to −5 | −6 |
| < −15 | −10 |

### 2e. 3-night sleep debt (±5)

`debt = recentAvg − baselineAvg`

| Debt (hours) | Adjustment |
|---|---|
| ≤ −1.0 | −5 |
| −1.0 to −0.3 | −3 |
| ≥ +0.5 | +3 |
| otherwise | 0 |

Result is rounded and clamped to `[10, 100]`.

> ⚠️ **Note on spec vs. code.** Earlier drafts described the duration bonus as
> `(deep_minutes / total_sleep) × 9 pts/hr`. The current implementation uses
> the stepwise tables above. The tables produce nearly identical results in
> the normal 6–9h range but are simpler to reason about and degrade more
> gracefully at the extremes.

---

## 3. Drain (during awake hours)

### 3a. Passive drain — `passiveDrainRate(hoursAwake)`

| Hours awake | Rate (pts/hr) |
|---|---|
| 0–4 | 2 |
| 4–8 | 3 |
| 8–12 | 4 |
| 12+ | 5 |

`totalPassiveDrain(hoursAwake)` integrates this band-by-band, so a 14h day
costs `(4 × 2) + (4 × 3) + (4 × 4) + (2 × 5) = 46` pts.

*Why accelerating?* Cortisol rises through the day even at rest; subjective
fatigue tracks roughly linearly until ~12h, then climbs faster. The bands are
the smallest practical step function that captures this.

### 3b. Activity drain — `activityDrain(intensityLoad)`

```ts
drain = max(0, intensityLoad) × 0.05
```

`intensityLoad` is intensity-weighted minutes (Garmin training load if
present, otherwise estimated from `training_effect` or average HR — see
`activityIntensityLoad()` in `readiness.ts`).

Examples:

| Workout | intensityLoad | Drain (pts) |
|---|---|---|
| 30-min easy jog | ~30 | 1.5 |
| 1h tempo | ~120 | 6 |
| 1h hard intervals | ~200 | 10 |
| Long run 2h | ~180 | 9 |

Activities started in the future (relative to `now`) are skipped.

---

## 4. Status bands

```ts
percent = round(clamp(startPercent − passive − active, 5, 100))
```

| Percent | Status |
|---|---|
| ≥ 70 | **Charged** |
| 40–70 | **Steady** |
| 20–40 | **Low** |
| < 20 | **Drained** |

There is a hard **floor of 5%** — the battery never reads truly empty.

> 📝 A formal "Reserve Mode" with an amber-badge state is **not** implemented.
> The `Drained` status (< 20%) is what the UI uses to flag low-energy days,
> together with the `insight` sentence that suggests rest/food/early bedtime.

---

## 5. Worked example

Inputs:

- 7h 30 sleep · 18% deep · 22% REM · HRV +6% above baseline · no sleep debt
- Woke at 07:00; `now = 21:00` → **14h awake**
- One activity today: 60-min hard run, intensityLoad ≈ 200

**Starting charge** (`initialBatteryFromSleep`):

| Component | Value |
|---|---|
| Base | 45 |
| Duration (7.5h) | +40 |
| Deep (18%) | +12 |
| REM (22%) | +8 |
| HRV (+6%) | +7 |
| Sleep debt | 0 |
| **Total** | **112 → clamped to 100** |

So `startPercent = 100`.

**Passive drain** over 14h:

```text
(4 × 2) + (4 × 3) + (4 × 4) + (2 × 5) = 8 + 12 + 16 + 10 = 46
```

**Activity drain**: `200 × 0.05 = 10`

**Final**: `100 − 46 − 10 = 44%` → **Steady**.

If the same day had ended at 23:00 (16h awake): passive becomes
`8 + 12 + 16 + (4 × 5) = 56`, so `100 − 56 − 10 = 34%` → **Low**.

---

## 6. Where it's consumed

- **`src/components/BodyBattery48hDialog.tsx`** — 48-hour history chart and current value.
- **`src/lib/readiness.ts`** — applied as a **penalty** in the EOD readiness composite: `batteryPenalty = −min(25, (100 − percent) × 0.25)`. A fully drained battery shaves up to 25 pts off readiness.
- **`supabase/functions/readiness-hourly-snapshot/index.ts`** — recomputes hourly so the 48h chart has data points even when the app is closed.
- **`src/components/ReadinessWidget.tsx`** — surfaces battery as a labelled factor under the readiness gauge when `hoursAwake > 0.5`.
