## Goal

Replace the current "charged/drained" framing with a phone-battery model: a single 0–100% reserve that fills overnight and falls during the day. The number on the dashboard should match how the user actually feels.

## New model

**Initial charge (on wake)** — from last night's sleep, capped at 100%:
- Start at 30% baseline
- + Duration: up to +35 (linear 0→7h, plateau at 7–9h, gentle taper after 10h)
- + Stage quality: up to +20 (deep% scaled, REM% scaled)
- + HRV vs baseline: ±15 (>+10% = +15, ±5% band = 0, <−15% = −15)
- + Sleep-debt bonus/penalty: ±5 (3-night avg vs 30-day)
- Floor 10, cap 100

**Awake passive drain** — accelerating with hours awake:
- 0–4h: 2/hr · 4–8h: 3/hr · 8–12h: 4/hr · 12h+: 5/hr
- Applied continuously since `wakeTimeIso`

**Activity drain** — no cap (was capped at 10):
- `intensityLoad × 0.05` per activity, distributed over the activity's duration

**Display:**
- Single number: `78%` with label (`Charged` / `Steady` / `Low` / `Drained`)
- Color: green ≥70, amber 40–69, orange 20–39, red <20
- Breakdown line: `Started 92% · −18 awake · −6 run · 12.3h on the go`
- Contextual insight: "Long day on your feet — easy night recommended" / "Great reserve — green light for tonight's session"

## Files to change

**Logic (single source of truth):**
- `src/lib/readiness.ts` — replace `bodyBatteryDrain()` with `computeBodyBattery()` returning `{ percent, startPercent, drainAwake, drainActive, hoursAwake, status, insight }`. Drop `passiveCharge` (awake recharge) entirely. Update the `Body Battery` factor push to show `${percent}% · ${status}` + breakdown.
- `src/lib/body-battery.ts` (new) — extract the pure battery math so it can be shared between client, edge function, and the 48h dialog without duplication. Exports `computeBodyBattery`, `initialBatteryFromSleep`, `passiveDrainRate(hoursAwake)`, `activityDrain(act)`.

**Edge function (kept in sync):**
- `supabase/functions/readiness-hourly-snapshot/index.ts` — replace inlined `bodyBatteryDrain` with the new model (port the same math). Snapshot the new `Body Battery` factor with the new percent string. Future snapshots will all use the clean format; old rows are left as-is (already cleaned up earlier).

**Dashboard tile:**
- `src/components/FactorDetailDialog.tsx` (only if it references the old label string — quick scan and adjust) — no behavioural change.
- `src/components/ReadinessWidget.tsx` (if it surfaces a battery snippet) — point at the new field shape.

**48h dialog:**
- `src/components/BodyBattery48hDialog.tsx` — switch to the shared `passiveDrainRate` + `activityDrain` from `body-battery.ts` so the chart matches the score. Keep the three-phase coloured area chart (sleep/awake/active) and the recharge/drain summary panels. Re-anchor initial battery to `initialBatteryFromSleep` instead of the hardcoded `60`.

**Score integration:**
- In `computeReadiness` (eod), the readiness penalty derived from the battery becomes `−round((100 − percent) × 0.25)` capped at −25, so a fully-drained battery still only shaves 25 pts (same ceiling as today). No other modifier changes.

## What gets removed

- The awake-hour HRV-driven recharge loop (the source of the `⚡ charged (+N rest)` string).
- The hard cap of 10 on activity drain.
- The mixed "charged + drained" detail string.
- `Math.round(baseScore) + passiveCharge` arithmetic that produced the confusing number.

## Out of scope

- No DB schema changes. `readiness_snapshots.factors` is JSONB and just stores the new string.
- No changes to AI coach prompts beyond the natural change in the "Body Battery" factor text they already receive.
- No change to morning readiness — it remains a pure overnight snapshot.

## Acceptance

- Dashboard "Body Battery" factor shows e.g. `74% · Steady` with subline `Started 92% · 8.4h awake · −12 passive · −6 run`.
- Number drops monotonically through the day (no awake recharge spikes).
- After a great night + no training, morning value is 85–100%.
- After a 90-min hard session at hour 10, value drops by ~20–30 pts visibly.
- 48h chart's "now" point equals the displayed % (within ±2 pts rounding).
