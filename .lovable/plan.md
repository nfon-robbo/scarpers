## 1. Initial charge — looser curve (`src/lib/body-battery.ts`)

Rewrite `initialBatteryFromSleep` so a normal good night lands at 95–100%:

- Baseline: `30 → 45`.
- Duration (up to **+40**, was +35):
  - `h <= 0`: 0
  - `h < 7`: `(h / 7) * 40`
  - `7 ≤ h ≤ 9`: 40 (full plateau)
  - `9 < h ≤ 10`: `40 - (h - 9) * 3` (gentle taper)
  - `h > 10`: `max(25, 37 - (h - 10) * 2)`
- Stage quality: unchanged (+20 cap: deep up to +12, REM up to +8).
- HRV vs baseline: tighten to **±10**
  - `≥ +10%` → +10, `≥ +5%` → +7, `±5%` → 0, `≥ −15%` → −6, else −10.
- Sleep debt (3-night vs 30-day): keep at ±5.
- Clamp: `Math.round(clamp(charge, 10, 100))`.

Sanity table the new formula must satisfy:

| Sleep | Stages | HRV | Expected |
|---|---|---|---|
| 8h | 15% deep / 22% REM | +5% | ~100% |
| 7.5h | 12% deep / 18% REM | baseline | 95–100% |
| 6.5h | average | baseline | 80–90% |
| 5.5h | fragmented | −10% | 60–75% |
| 4.5h | poor | −20% | 40–55% |

No changes to passive drain, activity drain, or `computeBodyBattery` flow.

## 2. "Drained" card — today only (`src/components/BodyBattery48hDialog.tsx`)

The card currently sums passive + activity drain across the entire 48h window (multiple wake periods → values like −115%). Scope it to "since last wake":

- During the existing per-step loop, also accumulate `todayDrainAwake` and `todayDrainActive` **only for steps whose timestamp is after the most recent `sleep → awake` transition** (i.e. the last wake of the window, falling back to the start of the awake series if no sleep was recorded in window).
- Track `lastWakeMs`: every time `sleepAt(t)` returns non-null, reset it to `null`; the first step after a sleep block where `sleepAt(t)` is null sets `lastWakeMs = t`. Reset the today counters whenever `lastWakeMs` is re-assigned.
- Render the Drained card from the today counters:
  - Headline: `−{awake+active}%`
  - Sub-rows: `Awake −{awake}%` and `Activity −{active}%`
  - Drop the "Net" row (no longer meaningful when drain is today-scoped and recharge is 48h-scoped); replace with a small caption: `Since last wake ({hours}h ago)`.
- Leave the Recharged card untouched (still 48h sleep total).

## 3. Dashboard ↔ chart sync (`src/components/BodyBattery48hDialog.tsx`)

Today the chart simulates with `let battery = 60` and stage-weight gains, so its "Now" diverges from the dashboard tile (which uses `computeBodyBattery`). Fix by anchoring the chart's final point to the shared function:

- After the simulation loop, call `computeBodyBattery({ sleep, wakeTimeIso, todayActivities, now })` with the **same inputs** the dashboard uses. Fetch the same sleep summary row + today's activities used by readiness (already available via existing queries; reuse the sleep_stages aggregation to derive `sleepHours`, `deepPct`, `remPct`, plus the latest `daily_metrics` row for `hrv`, `hrvBaseline`, `recentSleepAvgHours`, `baselineSleepAvgHours`, `wakeTimeIso`).
- Overwrite the last hourly point's `battery` with `result.percent` so the line ends exactly where the dashboard tile says.
- Add a small "Now: X%" label inside the chart card driven by `result.percent` (not by the simulated value) so the two numbers can never disagree.
- The intermediate hourly simulation is kept for the shape of the curve, but is **rescaled** by a constant offset so that its final value equals `result.percent` (subtract `simulatedNow - result.percent` from every point, then clamp to 0–100). This keeps the visual story consistent without rewriting the whole simulator.

## Out of scope

- Edge function `readiness-hourly-snapshot` (already uses shared logic; no behaviour change needed for these three fixes).
- DB schema, AI prompts, morning readiness scoring weights.
- Recharge math and colour bands.

## Acceptance

- Logged-in user with 7.5h sleep, decent stages, neutral HRV: dashboard tile and 48h "Now" both read 95–100% on wake.
- 48h dialog Drained card shows e.g. `−62%` with `Awake −56% · Activity −6%` and never exceeds 100.
- Dashboard tile percentage equals chart "Now: X%" to the integer at any refresh.
