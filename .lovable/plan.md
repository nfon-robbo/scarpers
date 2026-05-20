## Problem

The Body Battery factor on the dashboard shows the raw float (e.g. `⚡90.70341916666666 charged (+9 rest)`) instead of a rounded integer.

## Root cause

The hourly snapshot edge function `supabase/functions/readiness-hourly-snapshot/index.ts` computes `passiveCharge` as a float and returns it un-rounded (line 88), unlike the client-side `src/lib/readiness.ts` which rounds it (line 180). When building the detail string at line 202:

```ts
const charged = Math.round(baseScore) + battery.passiveCharge; // float!
```

…the result is a long-decimal number that gets rendered directly into the `detail` string stored in `readiness_snapshots`. The dashboard then shows whatever snapshot it last loaded.

## Fix

1. In `supabase/functions/readiness-hourly-snapshot/index.ts`, round `passiveCharge` (and ideally `passiveDrain` / `activeDrain` for parity) in the `bodyBatteryDrain` return — matching `src/lib/readiness.ts` line 180. This guarantees the `⚡N charged` string is always an integer.
2. No client changes needed; the client path already rounds.
3. Optional cleanup: trigger one fresh hourly snapshot so the currently-stored bad string is overwritten (or wait for the next :45 tick).

## Files to change

- `supabase/functions/readiness-hourly-snapshot/index.ts` — round `passiveCharge`, `passiveDrain`, `activeDrain` in the returned object.
