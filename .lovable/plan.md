## Finding: -3% activity drain is mathematically correct for today's data

I queried today's activities and verified the math through `activityIntensityLoad()` → `activityDrain()`. The -3% is the right answer given what's in the database — there's no missing-data bug.

## Today's activities (UTC)

| Time | Type | Duration | HR | training_load | training_effect |
|---|---|---|---|---|---|
| 13:58 | walking | 44.5 min | 107.8 | — | — |
| 08:48 | running | 15.0 min | 96 | — | 0.8 |
| 07:26 | walking | 32.1 min | 93.4 | — | — |

No `training_load` on any of them; the run has `training_effect = 0.8` (very easy); HR averages are 93–108 (walking pace).

## Load → drain math (`src/lib/readiness.ts` + `src/lib/body-battery.ts`)

`activityIntensityLoad()` falls back to HR multiplier `clamp(0.5, 2.0, hr/140)` × minutes, or training_effect: `minutes × (0.25 + te/5 × 1.75)`.

- Walking 44.5min × clamp(0.5, 107.8/140) = 44.5 × 0.77 ≈ **34.3**
- Running 15min × (0.25 + 0.8/5 × 1.75) = 15 × 0.53 ≈ **8.0**
- Walking 32.1min × clamp(0.5, 93.4/140) = 32.1 × 0.667 ≈ **21.4**
- **Total load ≈ 63.7** → `activityDrain = 63.7 × 0.05 ≈ 3.2%` → rounds to **3%** ✅

## Conclusion

- The activities ARE being picked up (3 of them, today's UTC date).
- The fallback estimation IS working (HR + training_effect branches both fire).
- There simply isn't a "60 min moderate run" or "hard 90 min session" today — just a 15-min very-easy jog and two walks at ~95–108 bpm.

The expected drain stated in the request ("10-20% for a 45-60 min moderate run") would require a 200–400 load activity. The user did not do one today.

## Recommendation

**No code change required.** The model is behaving as designed. If you still want to dial up walking/easy-running contribution, the dial is `activityDrain`'s `× 0.05` constant in `src/lib/body-battery.ts:61` — but that affects every activity, not just light ones, and would inflate drain on every prior day too.

If you'd like, I can:
1. Leave it as-is (recommended — the math matches reality).
2. Raise the HR-fallback floor (e.g., bump the `0.5` minimum to `0.7`) so easy walks count a bit more.
3. Change the constant `0.05` (e.g., to `0.07`) to make all activity drains ~40% higher.

Pick one and I'll implement, or confirm "no change".