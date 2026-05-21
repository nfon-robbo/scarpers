## Goal
Restore the original (correct) drain math and figure out why `startPercent` is coming back as 40 when sleep recharge is 81%. Keep all the recent UX improvements.

## 1. Revert the drain formula in `src/lib/body-battery.ts`

Restore the original numbers exactly:

- `passiveDrainRate`: back to **2 / 3 / 4 / 5** pts/hr (was bumped to 3/4/5/6)
- Remove the new **ambient drain** (`hoursAwake * 0.5`) entirely — it didn't exist before and stacks on top of passive
- Final clamp: keep floor at **5** (it's a UX safeguard, not a math change — original was 0 but "0%" reads as broken)
- `drainActive` reported value: revert to just `Math.round(active)` (no ambient term)

Net effect for your 13.7h awake day: drain drops from ~65 pts back to ~44 pts. So a 75% start would land around 31% now — matches what you saw before the "fixes".

## 2. Keep starting-value formula as-is

The current `initialBatteryFromSleep` is actually *more generous* than the original (baseline 45 vs 30, duration cap 40 vs 35, softer HRV penalty). Don't touch it. The 40% you're seeing is an **input problem**, not a formula problem.

## 3. Diagnose why your start is 40

Add a one-shot `console.debug` inside `computeBodyBattery` (gated behind `import.meta.env.DEV` so it never ships to prod logs) that prints the resolved inputs and step-by-step charge:

```
[BodyBattery] inputs: { sleepHours, deepPct, remPct, hrv, hrvBaseline,
                        recentSleepAvgHours, baselineSleepAvgHours, sleepScore }
[BodyBattery] charge: baseline=45  +duration=X  +deep=X  +rem=X  +hrv=X  +debt=X
              => start=NN, passive=NN, active=NN, final=NN%
```

Likely culprits given your symptoms (81% asleep, 40% start):
- `sleepHours` arriving as `null` → falls back to `sleepScore` path which only adds `(score/100)*35` instead of the full +40 plateau
- `deepPct`/`remPct` arriving as fractions (0.18) instead of percentages (18) — all bonuses then evaluate to 0
- `hrv` < baseline by >15% → -10 hit
- Negative sleep debt → another -5

Once we see the debug line in the console with your real numbers, we'll know which one (or which combo) is the culprit and fix it at the source (in `ReadinessWidget.tsx` data assembly), not by hacking the formula again.

## 4. Keep all UX fixes (no changes)
- Persistent chart during refresh ✓
- 5-min auto-refresh while dialog open ✓
- Updated HH:mm + Recompute button ✓
- "Modelled · updates hourly" hint on dashboard ✓
- Reserve mode badge ✓
- Numeric timestamps on XAxis (Recharts line-drop fix) ✓
- visibilitychange only refreshes trend snapshots ✓

## Files touched
- `src/lib/body-battery.ts` — revert `passiveDrainRate`, remove ambient term, add DEV-gated debug log
- Nothing else

## Validation
1. Open dashboard, open browser console
2. Read the `[BodyBattery]` line — confirm which input is wrong
3. Confirm Body Battery widget shows ~30% (not 5%) for your 13.7h day
4. Open 48h dialog — chart still updates, badge/recompute still work
