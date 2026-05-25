
# Advanced Sleep Metrics Enhancement

The Garmin screenshot parser already extracts SpO₂, breathing pattern, respiration, restless count, skin temp change, 7d HRV status and body battery change — these are stored as JSON in `daily_metrics.raw_data.garmin_sleep_vitals`. This plan promotes them to first-class columns, wires them through the scoring/readiness algorithms, surfaces them in the UI, and lets users edit them manually.

## Phase 1 — Foundation (schema + manual form + alerts)

### 1. Database migration
Add to `daily_metrics`:
- `spo2_avg` numeric — % (also keep existing `spo2` for back-compat, mirror writes)
- `spo2_lowest` numeric
- `respiration_avg` numeric — brpm
- `breathing_pattern` text — 'Balanced' | 'Few' | 'Many'
- `skin_temp_deviation` numeric — °C from baseline
- `restless_count` integer
- `hrv_7d_trend` text — 'Balanced' | 'Unbalanced'
- `body_battery_change` integer

All nullable, no defaults. No RLS changes (existing policies cover it).

### 2. Garmin parser writes columns
In `SleepSourcesPanel.saveGarminVitals` and `save`, in addition to writing `raw_data.garmin_sleep_vitals`, also write to the new scalar columns (so they're queryable for charts/readiness without parsing JSON).

### 3. Manual entry form — new "Advanced Metrics (optional)" section
In `src/components/insights/SleepSourcesPanel.tsx`, after RHR/HRV inputs, add a collapsible group:
- SpO₂ Avg / SpO₂ Low (number, 70–100)
- Respiration brpm (8–25) / Breathing Pattern (select: Balanced/Few/Many)
- Skin Temp °C (−3 to +3) / Restless Count (0–200)
- 7d HRV Trend (select: Balanced/Unbalanced)

Auto-fills from parsed Garmin vitals; user edits override. On save, all values flow into the new columns plus `raw_data.garmin_sleep_vitals` (source `"manual"` when typed by hand).

### 4. Health alerts component
New `src/components/HealthAlerts.tsx` rendered on the Insights page (and inside `ReadinessWidget` mini-strip):
- Red: SpO₂ <90 · Restless >100 · Skin temp >±2.5°C
- Amber: SpO₂ 90–92 · Restless 60–100 · Breathing "Many" · Skin temp >±1.5°C
- Green: SpO₂ ≥95 + breathing Balanced + restless <40 ("Excellent oxygen levels")

Each alert: icon, one-line headline, one-line context, optional suggestion. Pulls latest 1–3 nights from `daily_metrics`.

## Phase 2 — Algorithms

### 5. Sleep score (`src/lib/sleep-score.ts`)
Add optional `AdvancedSleepMetrics` to `calculateSleepScore` signature (back-compat: works without it). New components added AFTER current `raw` calc, then clamped 0–100:

- **SpO₂ bonus** (−10..+5): avg ≥95 +5; 92–95 +3; 88–92 +1; <88 −5; lowest <85 additional −5
- **Breathing** (−3..+3): Balanced +3; Few +1; Many −3
- **Restlessness penalty** (−5..0): <30 0; 30–60 −2; 60–100 −4; >100 −5
- **Skin temp penalty** (−5..0): |dev| ≤1 0; >1.5 −3; >2.5 −5

Score remains clamped 0–100. Return an optional `breakdown` object so the UI can show "+SpO₂ +5, restless −2" etc.

### 6. Readiness (`src/lib/readiness.ts`) — Option A (6th factor)
Rebalance:
- Sleep Quality 32% (−2), HRV 21% (−2), Yesterday's Load 15% (−1), Deep% 14% (−1), RHR 11% (−1)
- **Respiration Health 7% (NEW)**

Respiration Health (0–100): base 50, +20 if SpO₂≥95 / −30 if <90 · +15 Balanced / −15 Many · +15 restless<40 / −20 restless>80 · clamp 0–100.

Missing metrics → factor returns 50 (neutral), so users without Garmin vitals see no change to existing scores.

### 7. Insights mini-stats row
Below sleep score in `SleepCalendar` detail popup (and a strip in `WellnessTab`):
- 💨 Breathing · 🫁 SpO₂ · 😴 Restless · 🌡️ Skin temp
Colour-coded by the thresholds above.

## Phase 3 — Polish

### 8. AI chatbot context
In `src/components/AIChatbot.tsx` last-30-nights context block, include SpO₂ / breathing / restless / skin / HRV-trend lines per night when present.

### 9. Documentation
Append "Advanced Metrics" section to `docs/algorithms/sleep-score.md` and a "Respiration Health factor" note to `docs/algorithms/readiness.md` matching the implemented formulas.

## Technical Notes

- Existing parser (`parse-garmin-sleep` edge function) already returns every field needed — **no edge function changes**.
- Form numeric validation done client-side with `min`/`max` on `<Input type="number">` plus a `clamp` helper; invalid values blocked on save with a toast.
- Score breakdown surfaced via a new `SleepScoreBreakdown` type returned alongside the score (callers ignoring it stay back-compat).
- All new columns nullable so historical rows continue to render and score cleanly.

## Out of scope
- Long-term trend charts for SpO₂/restlessness (can be a follow-up)
- Sleep apnea screening flow beyond the alert text
- Pushing new metrics into Strava / external services
