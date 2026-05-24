# How the Readiness Score Works

A 0–100 daily training-readiness score computed by `computeReadiness()` in
[`src/lib/readiness.ts`](../../src/lib/readiness.ts). It runs in two modes:

- **`morning`** — pure overnight recovery snapshot (5 factors only).
- **`eod`** (default) — overnight recovery + daytime modifiers + Body Battery penalty.

---

## 1. Inputs

A `ReadinessData` object aggregating sleep, HRV/RHR, training history, and
today's activities. The fields used by each factor are shown in §3.

---

## 2. Phase 1 — five core factors

The base score is a weighted average of five factors. **All five are always
applied, in both morning and eod modes.** Missing data triggers a documented
fallback (not a hard penalty in most cases).

| Factor | Weight |
|---|---|
| Sleep Quality | **34%** |
| HRV vs baseline | **23%** |
| Yesterday's Load | **16%** |
| Deep Sleep % | **15%** |
| Resting HR vs baseline | **12%** |
| **Total** | **100%** |

> ⚠️ **Note on spec vs. code.** Earlier outlines described a 7-factor model
> (sleep 34 / HRV 18 / RHR 16 / yest. load 13 / battery 12 / today 4 / hours
> 3). The implemented model uses the 5-factor split above, with Body Battery
> and today's effort applied as **modifiers** in Phase 2 rather than weighted
> factors. This keeps the morning snapshot stable and isolates daytime drain.

---

## 3. Factor scoring curves

### 3a. Sleep Quality (34%)

Input: `sleepScore` (0–100, from `calculateSleepScore()`).

```ts
adjustedSleep =
  s >= 80 ? s :
  s >= 60 ? s * 0.75 :
  s >= 50 ? s * 0.65 :
            s * 0.55
contribution = adjustedSleep × 0.34
```

| Sleep score | Effective value | Status |
|---|---|---|
| ≥ 75 | s | good |
| 55–74 | s × 0.65–0.75 | warning |
| < 55 | s × 0.55 | poor |

Missing: contributes `30 × 0.34 = 10.2` pts and a "Not synced" factor.

*Why aggressive?* Sub-70 sleep scores correlate strongly with elevated next-day
RPE; the curve makes that pain visible instead of averaging it away.

### 3b. HRV vs baseline (23%)

```ts
pct = (hrv − baseline) / baseline × 100
```

| pct | Score |
|---|---|
| ≥ +10 | 90 |
| 0 to +10 | 75 |
| −10 to 0 | 55 |
| −20 to −10 | 35 |
| < −20 | 15 |

Missing: contributes `40 × 0.23 = 9.2` (mild penalty — often a data-timing
issue, not actual collapse).

### 3c. Yesterday's Load (16%)

`yesterdayLoad` is intensity-weighted minutes from `activityIntensityLoad()`.

| Load (min) | Score | Status |
|---|---|---|
| ≤ 15 | 85 | good |
| 16–40 | 70 | good |
| 41–80 | 45 | warning |
| 81–140 | 25 | poor |
| > 140 | 10 | poor |

Missing (rest day): contributes `50 × 0.16 = 8.0`.

### 3d. Deep Sleep % (15%)

| deep% | Score | Label |
|---|---|---|
| ≥ 15 | 90 | Healthy |
| 12–15 | 65 | Healthy |
| 10–12 | 45 | Low |
| 7–10 | 25 | Low |
| < 7 | 10 | Critically low |

Missing: contributes `25 × 0.15 = 3.75`.

### 3e. Resting HR vs baseline (12%)

`diff = rhr − rhrBaseline`

| diff (bpm) | Score |
|---|---|
| ≤ 0 | 85 |
| 1–2 | 75 |
| 3–4 | 55 |
| 5–7 | 35 |
| > 7 | 15 |

RHR without baseline: 40. Missing entirely: 15.

---

## 4. Base score assembly

```ts
baseScore = Σ(factorScore × weight)   // already sums to 100% weight
```

In **morning** mode, that's the whole calculation:

```ts
score = round(clamp(baseScore, 5, 100))
return { score, factors }
```

---

## 5. Phase 2 — EOD modifiers (additive ±)

Applied only when `mode === "eod"`. Each modifier returns an integer
adjustment; the sum is added to `baseScore`.

### 5a. Recovery clock

Only counted if last hard workout was **yesterday or earlier** (today's
session is already covered by 5d).

```ts
neededHrs = 8 + (lastWorkoutIntensity / 100) × 16    // 8–24h
if hrs < neededHrs:
  adj = −round(4 + (1 − hrs/neededHrs) × 10)         // −4 to −14
```

### 5b. 3-day sleep debt

```ts
debt = recentAvgHours − baselineAvgHours
if debt < −0.3:
  adj = max(−15, round(debt × 8))                    // 0 to −15
```

### 5c. Training monotony (7d vs 28d)

```ts
ratio = weeklyLoadAvg / monthlyLoadAvg
ratio > 1.4 → adj = −min(10, (ratio − 1.4) × 10)     // ramp penalty
ratio < 0.5 → adj = +3                               // freshness
```

### 5d. Today's effort

```ts
adj = −min(12, (todayLoad / 60) × 8)                 // −1 to −12
```

### 5e. Body Battery penalty

The battery itself is computed by `computeBodyBattery()` (see
[body-battery.md](./body-battery.md)). Its readiness contribution is:

```ts
batteryPenalty = −round(min(25, (100 − percent) × 0.25))
```

A full battery costs nothing; a fully drained battery shaves up to **25 pts**.

---

## 6. Composite formula

```ts
finalScore = round(clamp(
  baseScore + Σ(modifiers) + batteryPenalty,
  5, 100
))
```

The hard **floor of 5** means readiness never reads zero — even on the worst
possible day there's a visible non-zero value.

---

## 7. Label thresholds

(Used by `ReadinessWidget` for the gauge colour and verb.)

| Score | Label | Colour token |
|---|---|---|
| 80+ | Excellent | `text-emerald-400` |
| 65–79 | Good | `text-primary` |
| 50–64 | Medium | `text-yellow-500` |
| 35–49 | Low | `text-amber-500` |
| < 35 | Poor | `text-destructive` |

---

## 8. Carry-forward (midnight drop fix)

Between midnight and sleep sync (typically 06:00–08:00) there's no last-night
sleep data yet, which would otherwise produce a misleadingly low morning score.
Two mitigations:

- **`readiness-hourly-snapshot`** edge function writes the last computed score
  to `readiness_snapshots` hourly, so the widget always has a recent value to
  show while the new night is still being graded.
- **`ReadinessWidget`** prefers a previous-evening snapshot when the current
  computation lacks `sleepScore`, labelled *"Carried forward — waiting for
  tonight's sleep data"*.

---

## 9. Worked example (EOD)

Inputs:

| Field | Value |
|---|---|
| `sleepScore` | 82 |
| `deepPct` | 17 |
| `rhr` / `rhrBaseline` | 52 / 50 (+2) |
| `hrv` / `hrvBaseline` | 58 / 60 (−3.3%) |
| `yesterdayLoad` | 95 (intensity-weighted min) |
| `todayLoad` | 45 |
| `recentSleepAvgHours` / baseline | 7.0 / 7.6 (−0.6h debt) |
| `weeklyLoadAvg` / monthly | 65 / 50 (ratio 1.30) |
| Body Battery | 38% (Steady-Low) |

**Phase 1**:

| Factor | Raw score | × weight | Contribution |
|---|---|---|---|
| Sleep Quality | 82 (≥80, kept raw) | × 0.34 | 27.88 |
| HRV (−3.3%) | 55 | × 0.23 | 12.65 |
| Yesterday Load (95) | 25 | × 0.16 | 4.00 |
| Deep% (17) | 90 | × 0.15 | 13.50 |
| RHR (+2) | 75 | × 0.12 | 9.00 |
| **baseScore** |  |  | **67.03** |

**Phase 2 modifiers**:

| Modifier | Adj |
|---|---|
| Recovery clock (today's session present → skipped) | 0 |
| Sleep debt (−0.6h × 8 = −4.8) | −5 |
| Training monotony (1.30 ≤ 1.40) | 0 |
| Today's effort (45/60 × 8 = 6) | −6 |
| Body Battery penalty `(100 − 38) × 0.25 = 15.5` | −16 |

**Final**: `67.03 − 5 − 6 − 16 = 40.03` → **40 (Low)**.

---

## 10. Where it's consumed

- **`src/components/ReadinessWidget.tsx`** — gauge, factor list, history sparkline.
- **`src/pages/Dashboard.tsx`** — readiness card with verb + colour.
- **`supabase/functions/readiness-hourly-snapshot/index.ts`** — cron-driven recompute powering the 48h chart and carry-forward.
- **`supabase/functions/readiness-advice/index.ts`** & **`readiness-coach-insight/index.ts`** — AI prompts receive the score + factor breakdown.
- **`src/lib/running-iq.ts`** — scales Running IQ ±10% based on rolling readiness.
