

# Comprehensive Readiness Score Overhaul

## What Changes

The readiness score currently takes a morning snapshot and never moves. This update makes it a **living score** that shifts throughout the day using all available user data, matching (and exceeding) what Garmin does with Training Readiness.

---

## New Factors Added

| Factor | Data Source | What It Does |
|--------|-----------|--------------|
| **Recovery Time** | `activities` table (last workout's intensity + elapsed hours) | Estimates hours until fully recovered; penalises score if still within recovery window |
| **3-Day Sleep History** | `daily_metrics` (last 3 nights sleep duration vs 30-day avg) | Detects sleep debt across multiple nights, not just last night |
| **3-Day Stress Trend** | `daily_metrics` (last 3 days stress_score) | Sustained high stress penalises more than a single bad day |
| **Training Monotony** | `activities` (7-day load vs 28-day avg) | Flags sudden ramp-ups or staleness in training volume |
| **Workout Intensity** | `activities` (avg_heart_rate, training_load, training_effect) | Weights sessions by actual effort, not just raw minutes |
| **Today's Load** | `activities` (today's sessions) | Real-time penalty as you train during the day |
| **Circadian Modifier** | Client clock (current hour) | Small energy curve adjustments: boost mid-morning, dip post-lunch, wind-down evening |

---

## Bug Fix Included

**Sleep double-counting**: The current query fetches sleep stages for both today and yesterday and sums them all. This fix groups by date and picks only the most recent night.

---

## How Scoring Works

The base score is the weighted average of the core factors (Sleep Quality, RHR, HRV, Stress). Then **modifiers** are applied on top:

- **Recovery Time**: If last hard workout was < 12h ago, apply -5 to -15 penalty based on intensity
- **3-Day Sleep Debt**: Compare 3-night avg sleep hours to 30-day avg. If consistently under, -5 to -15
- **3-Day Stress Trend**: Average last 3 days of stress. If elevated (>50 avg), -5 to -10
- **Training Monotony**: 7-day avg daily load / 28-day avg. If ratio > 1.5, penalise -5 to -10 (overreaching). If < 0.5, small boost (freshness)
- **Today's Load**: If already trained today, -5 to -15 based on intensity-weighted minutes
- **Circadian**: -3 to +3 based on time of day

Final score is clamped to 0-100.

---

## Technical Details

### File: `src/components/ReadinessWidget.tsx`

**1. Expand `ReadinessData` interface** with new fields:
- `todayLoad` (intensity-weighted minutes today)
- `recoveryHoursSinceLastHard` (hours since last high-intensity session)
- `lastWorkoutIntensity` (0-100 based on HR/training_effect)
- `recentSleepAvgHours` (3-night average)
- `baselineSleepAvgHours` (30-day average)
- `stressHistory` (array of last 3 days' stress scores)
- `weeklyLoadAvg` (7-day daily average training minutes)
- `monthlyLoadAvg` (28-day daily average training minutes)
- `currentHour` (local hour for circadian)

**2. Expand data fetching** in the `useEffect`:
- Add `date` to sleep_stages select, group by date, pick most recent night only (fixes double-count bug)
- Fetch today's activities (not just yesterday's) with `avg_heart_rate, training_load, training_effect, duration_seconds`
- Expand activities query window to 28 days back for monotony calculation
- Compute intensity-weighted load: if `training_load` exists use it, else estimate from `avg_heart_rate` and duration
- Compute recovery time from last activity's `start_time + duration` vs now
- Compute 3-night sleep average from `daily_metrics.sleep_duration_seconds`
- Compute 3-day stress average from `daily_metrics.stress_score`

**3. Rewrite `computeReadiness`** to use a two-phase approach:
- **Phase 1 -- Core factors** (weighted average, same as now but with intensity-aware load):
  - Sleep Quality (weight 30%)
  - RHR vs baseline (weight 20%)
  - HRV vs baseline (weight 25%)
  - Stress (weight 15%)
  - Yesterday's Load using intensity (weight 10%)
- **Phase 2 -- Modifiers** (additive adjustments to the weighted score):
  - Recovery time modifier
  - 3-day sleep debt modifier
  - 3-day stress trend modifier
  - Training monotony modifier
  - Today's load modifier
  - Circadian modifier
- Clamp final score 0-100

**4. Display new factors** in the widget:
- Show modifiers as additional rows only when they meaningfully impact the score (absolute adjustment >= 3 points)
- Labels like "Recovery", "Sleep Debt", "Training Ramp", "Today's Effort"
- Circadian modifier is applied silently (no row shown -- it's just background feel)

### File: `supabase/functions/readiness-advice/index.ts`

No structural changes needed -- it already receives `result.score` and `result.factors`, so it will automatically see the new factor rows and adjusted score.

---

## Factor Display Examples

When everything is good:
```text
Sleep Quality     82/100 (Good) - 7.4h        [green]
Resting HR        52 bpm (-1 vs avg)           [green]
HRV               48 ms (+8% vs avg)           [green]
Stress            22/100                        [green]
Recovery          18h since last session        [green]
```

When things are rough:
```text
Sleep Quality     41/100 (Poor) - 5.2h         [red]
HRV               31 ms (-22% vs avg)          [red]
Sleep Debt        -1.4h vs avg (3 nights)      [yellow]
Today's Effort    65 min (intense)             [yellow]
Training Ramp     1.7x vs monthly avg          [red]
```
