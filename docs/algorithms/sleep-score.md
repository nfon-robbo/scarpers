# How the Sleep Score Works

A deterministic 0–100 score produced by `calculateSleepScore()` in
[`src/lib/sleep-score.ts`](../../src/lib/sleep-score.ts). No AI is in the loop
until **after** the number has been calculated — the AI insight only ever sees
the raw stage data and the final score.

---

## 1. Inputs

A single `SleepStageData` object (all values in **seconds**):

| Field | Meaning |
|---|---|
| `deep` | Time in deep (slow-wave) sleep |
| `light` | Time in light sleep |
| `rem` | Time in REM sleep |
| `awake` | Time awake while in bed |
| `sleep` | Generic "asleep" time when no stage breakdown is available |

Two derived totals:

- `total = deep + light + rem + awake + sleep` — total time in bed
- `sleepTime = deep + light + rem + sleep` — actual time asleep

If `total === 0` → score is **0**.

---

## 2. Two scoring paths

### 2a. Fallback path (no stage data)

Triggered when `deep + light + rem + awake === 0` but `sleep > 0`
(some providers only return total sleep duration, not stages).

| Hours slept | Score |
|---|---|
| < 6 | `max(15, 50 × hours/6)` |
| 6–7 | `50 + 25 × (hours − 6)` |
| 7–9 | **75** (capped) |
| 9–10 | `65 + 10 × (10 − hours)` |
| > 10 | 55 |

*Why cap at 75?* Without stage data we can't know if the sleep was
restorative. The fallback is honest about that uncertainty — you can't reach
"Excellent" without stages.

### 2b. Full path (stage data present)

Four positive components and one penalty.

```text
raw = duration + deep + rem + efficiency − lightHeavyPenalty
score = round(clamp(raw, 0, 100))
```

---

## 3. Component breakdown

### Duration — 25 pts max

Bell curve around 7–9h. `totalHours = total / 3600`.

| Hours | Points |
|---|---|
| 7–9 | **25** |
| 6–7 | `25 × (hours − 5) / 2` |
| 9–10 | `25 × (10 − hours)` |
| < 6 | `max(0, 25 × hours/7 × 0.4)` |
| > 10 | `25 × 0.25` |

### Deep sleep % — 30 pts max (heaviest)

`deepPct = deep / sleepTime × 100`.

| Deep % | Points |
|---|---|
| 15–25 | **30** |
| 12–15 | `30 × (deepPct − 8)/7` |
| 10–12 | `30 × 0.35` |
| 25–35 | `max(20, 30 − (deepPct − 25) × 0.5)` |
| < 10 | `max(0, 30 × deepPct/15 × 0.15)` (catastrophic) |
| > 35 | 15 |

*Why heaviest?* Walker's research links sub-10% deep sleep to next-day
cognitive impairment, growth-hormone disruption, and immune dip. It's the
single best stage-level predictor of recovery.

### REM % — 20 pts max

`remPct = rem / sleepTime × 100`.

| REM % | Points |
|---|---|
| 20–30 | **20** |
| 12–20 | `20 × (remPct − 5)/15` |
| > 30 | `max(12, 20 − (remPct − 30) × 0.5)` |
| < 12 | `max(0, 20 × remPct/20 × 0.4)` |

### Efficiency — 15 pts max

`efficiency = sleepTime / total × 100`.

| Efficiency | Points |
|---|---|
| ≥ 92 | **15** |
| 80–92 | `15 × (eff − 65)/27` |
| 70–80 | `15 × 0.3` |
| < 70 | `max(0, 15 × eff/90 × 0.3)` |

### Light-heavy penalty — up to −10 pts

If light sleep dominates: `lightPct = (light + genericSleep) / sleepTime × 100`.

```text
if lightPct > 75:
  penalty = min(10, (lightPct − 75) × 0.5)
```

*Why?* Light-heavy nights look "long" but lack the deep waves that drive
physical repair. The penalty caps the headline number for fragmented sleep.

---

## 4. Final assembly

```text
raw       = duration + deep + rem + efficiency − lightPenalty
score     = round(clamp(raw, 0, 100))
```

The theoretical max from the four positive components is **90** (25 + 30 + 20 +
15), leaving ~10 pts of headroom intentionally unreachable. That keeps 95+
scores rare and meaningful.

---

## 5. Label thresholds

Produced by `scoreLabel(score)`:

| Score | Label | Token |
|---|---|---|
| 85+ | Excellent | `text-primary` |
| 70–84 | Good | `text-primary` |
| 50–69 | Fair | `text-yellow-500` |
| 30–49 | Poor | `text-destructive` |
| < 30 | Very Poor | `text-destructive` |

---

## 6. Worked example

Stages (in seconds):

| Stage | Seconds | Hours |
|---|---|---|
| deep | 5,022 | 1h 24 |
| light | 14,400 | 4h 00 |
| rem | 6,120 | 1h 42 |
| awake | 1,800 | 0h 30 |
| sleep | 0 | — |

- `total` = 27,342s → 7.60h
- `sleepTime` = 25,542s → 7.10h
- `deepPct` = 19.7% · `remPct` = 24.0% · `efficiency` = 93.4% · `lightPct` = 56.4%

Components:

| Component | Value |
|---|---|
| Duration (7.60h) | **25** |
| Deep (19.7%) | **30** |
| REM (24.0%) | **20** |
| Efficiency (93.4%) | **15** |
| Light penalty (lightPct ≤ 75) | **0** |

`raw = 25 + 30 + 20 + 15 − 0 = 90` → **Score: 90 (Excellent)**.

---

## 7. Where it's consumed

- **`src/components/SleepCalendar.tsx`** — colours each night cell by score band; passes raw stages to `sleep-insight` edge fn for the popup.
- **`src/lib/readiness.ts`** — `Sleep Quality` factor (34% weight) and seed for Body Battery starting charge.
- **`supabase/functions/sleep-insight/index.ts`** — LLM receives stages + score, never recomputes.
- **`src/components/AIChatbot.tsx`** — quoted in last-30-nights context.
