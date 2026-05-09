## Problem

When we export workouts to Garmin (.fit), the rest/recovery steps are being sent with a pace target of "9:25/km" (walk pace). The user compared with another app that sends:

- **Warm up** — no target
- **Run** — with target (correct, leave alone)
- **Rest** — no target (ours wrongly sets walk pace)
- **Cool down** — no target

Our current behaviour lives in `src/lib/intervals-workout-fit.ts`. In `buildSpeedFitStep` we detect warmup/cooldown/recovery/rest and force their pace to `9:25/km`, then still build a SPEED-target step. That's why the watch shows a pace target on what should be open steps.

Also `parseTextStep` rewrites walk lines to "Recovery" but still routes them through the speed step builder if a pace is present in the text.

## Fix

In `src/lib/intervals-workout-fit.ts`:

1. **`buildSpeedFitStep`**: if intensity is `warmup`, `cooldown`, `recovery`, or `rest`, return an **open** step (no target) instead of a speed-target step. Use the existing `buildOpenStep` with a sensible label (e.g. "Warm up", "Cool down", "Recover").
2. **`buildFitStep`** (HR-target branch used when API steps lack pace): same treatment — for warmup/cooldown/recovery/rest, return an open step instead of an HR-target step, so the watch shows no target on rests regardless of source.
3. **`parseTextStep`**: when the line is a walk or the resolved intensity is non-active, skip target parsing entirely and return an open step using just the duration.
4. Remove the now-unused "9:25/km fallback pace" branch in `buildSpeedFitStep`.

Active/interval steps keep their pace or HR target exactly as today — only the non-working steps become open.

## Files touched

- `src/lib/intervals-workout-fit.ts` — only file affected. No DB / edge function / UI changes.

## Verification

- Re-export a known interval workout to .fit; inspect with the existing FIT decoding (or push to the watch) and confirm warm up / rest / cool down show **No Target**, while the work intervals keep their pace target.
