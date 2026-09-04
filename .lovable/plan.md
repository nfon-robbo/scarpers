# Guard the Training Ramp penalty against insufficient history

## Problem

The "Training Ramp" modifier divides this week's average daily training minutes by the 28-day average. For users with little logged history the 28-day average is near zero, so a normal training week produces an inflated ratio (e.g. 4.0x) and an unfair penalty of up to -10 on the readiness score.

## Code found (confirmed)

The ramp logic exists in **two parallel implementations** that must both be fixed:

**1. `src/lib/readiness.ts` (~lines 307-322)** — live calculation used by the on-screen widget:

```ts
// Training monotony (7d vs 28d)
if (d.weeklyLoadAvg != null && d.monthlyLoadAvg != null && d.monthlyLoadAvg > 0) {
  const ratio = d.weeklyLoadAvg / d.monthlyLoadAvg;
  if (ratio > 1.4) {
    const penalty = -Math.round(Math.min(10, (ratio - 1.4) * 10));
    modifiers.push({ label: "Training Ramp", adj: penalty,
      detail: `${ratio.toFixed(1)}x vs monthly avg` });
  } else if (ratio < 0.5 && d.weeklyLoadAvg > 0) {
    modifiers.push({ label: "Freshness", adj: 3,
      detail: `${ratio.toFixed(1)}x vs monthly avg` });
  }
}
```

Its inputs are computed in **`src/components/ReadinessWidget.tsx` (~lines 511-549)**, which already loads all activities from the last 28 days (`allActivities`), so counting active days needs no new query.

**2. `supabase/functions/readiness-hourly-snapshot/index.ts` (~lines 233-236)** — the hourly cron recompute duplicates the same block; it already queries 28 days of activities (`back28`, line ~291) and computes `monthlyLoadAvg = month / 28` (line ~383).

Modifiers with |adj| >= 3 are surfaced into the visible factor list in `readiness.ts` (lines ~377-385); a `Recovery` label is already special-cased to show at adj 0 — the same pattern will be reused for the skipped-ramp marker. The factor list is rendered generically by the widget and `FactorDetailDialog`, so a properly formed factor appears in the UI with no extra rendering work.

## Changes

### 1. `src/lib/readiness.ts`
- Add `activeTrainingDays28: number | null` to `ReadinessData` (count of distinct days in the last 28 with at least one logged activity).
- Wrap the ramp/freshness block in a guard, checked as **two separate, independent conditions** (either alone triggers the skip):
  - `monthlyLoadAvg < 15` (28-day average below 15 min/day), or
  - `activeTrainingDays28 < 10` (fewer than 10 active days in the last 28).
- When skipped: compute no ratio, apply no penalty or freshness bonus, and push a factor `{ label: "Training Ramp", status: "good", detail: "Skipped — insufficient training history" }`. Adjust the |adj| >= 3 filter so this zero-adjustment marker is always shown (same special-case pattern as `Recovery`).
- When not skipped: behaviour is byte-for-byte unchanged — same 1.4 threshold, same ratio math, same freshness bonus.

### 2. `src/components/ReadinessWidget.tsx`
- Derive `activeTrainingDays28` from the already-fetched `allActivities` (distinct local dates) and pass it into the readiness data.

### 3. `supabase/functions/readiness-hourly-snapshot/index.ts`
- Same guard and same skipped-history factor marker in the cron copy, using the activities it already queries, so stored snapshots match the live widget. Redeploy the function.

### 4. `docs/algorithms/readiness.md`
- One-line note under the training-monotony modifier documenting the guard.

## Explicitly not changed
- The 1.4x ramp threshold, ramp penalty formula, and freshness bonus.
- The other five factors (sleep 34%, HRV 23%, yesterday's load 16%, deep sleep 15%, resting HR 12%) and their weights — no rebalancing; the skipped ramp simply contributes 0.
- Any other modifier (sleep debt, recovery clock, today's effort, body battery).

## Verification
- Build check via `/tmp/observability/build-errors.log`.
- Report exactly which files were edited and confirm the 15 min/day floor and the 10-active-day floor are implemented as separate, independently checked conditions.
