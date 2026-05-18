# Guarantee Every Plan Write Reaches Race Day

## Goal

Every AI path that produces or modifies the training plan, and every code path that writes to `training_plans.content`, must end with `🏁 RACE DAY` on the stored `race_date`. If it doesn't, run one more AI continuation; if it still doesn't, refuse to save.

## What currently exists

The continuation loop in `supabase/functions/ai-coach/index.ts` (lines 1421-1573) already handles `training-plan` and `plan-adjust` — buffers the stream, detects the last date, and runs up to 3 continuation passes until `hasRaceDayEntry(fullText, race_date)` is true.

The client calls `savePlan()` from many paths but writes whatever the AI emitted (or a client-side splice produces) without checking race-day presence.

## Clarifying the type list

The user mentions `plan-easier`, `plan-harder`, `plan-apply` as separate types. They don't exist as distinct types — they're all `streamAICoach({ type: "plan-adjust", adjustment: "easier" | "harder" | "apply", ... })` from `applyAdjustment()`. So `plan-adjust` already covers all three. The plan below treats them as one path but makes the guarantee defensive so any future plan-writing type inherits it.

## Edge function changes — `supabase/functions/ai-coach/index.ts`

1. Replace the narrow `needsRaceDateContinuation` predicate (line 1368) with a set-based check covering every type whose output overwrites plan content:
   ```
   const planRewriteTypes = new Set(["training-plan", "plan-adjust", "plan-easier", "plan-harder", "plan-apply"]);
   const needsRaceDateContinuation = planRewriteTypes.has(type) && !!race_date && race_date !== "ai-recommend";
   ```
   This is a no-op for the current frontend but future-proofs the named variants the user asked about.

2. After the 3-pass continuation loop (line 1564), add a final mandatory validation pass:
   - If `!hasRaceDayEntry(assistantSoFar, targetIso)` OR `lastIsoDate(assistantSoFar) < targetIso`, run ONE more continuation pass with a stronger directive ("the previous output is INVALID because it does not contain the race day entry on {race_date} — emit only the missing tail ending with 🏁 RACE DAY…").
   - This pass uses its own budget so it always fires even after the 3 normal passes were exhausted.

3. Keep the existing `[DONE]` emission and buffered re-emit so the client still sees a live stream.

## Client validation — single chokepoint in `savePlan`

In `src/pages/TrainingPlan.tsx`, every write to `training_plans.content` already flows through `savePlan()` (lines 543-…) except two splice paths: the inline workout move (line 695) and `persistStartDateShift` (line 730). Route those through `savePlan` too (or extract the validation guard into a shared helper they both call).

Add a `validatePlanReachesRaceDay(content, raceDateIso)` helper (in `src/lib/plan-validation.ts`) that mirrors the edge-function logic:
- last ISO/UK date in content is `>= raceDateIso`
- a `race day` heading or table row contains `raceDateIso` or its `DD/MM/YYYY` form

In `savePlan()`, before the supabase update:
1. If `raceDate` is set and `validatePlanReachesRaceDay(planContent, raceIso)` is false:
   - Call a new edge-function entrypoint `type: "plan-continuation"` with `{ current_plan: planContent, race_date: raceIso, ...pacing context }`. The handler reuses the same buffered + continuation streaming branch and returns the extended plan.
   - Append the streamed continuation to `planContent`.
   - Re-validate. If still failing, abort the save, restore prior content, and surface a destructive toast: "Couldn't extend the plan to race day. No changes saved." The user can retry.
2. Only after validation passes, write to `training_plans.content`.

This single guard covers: plan generation, regenerate-for-new-end-date, plan adjustment (apply/easier/harder), Day Ahead surgical edits (`applyDayAdjustment`), Day Ahead move/skip (`commitDayAheadAction`), DOCX/FIT import, workout move, start-date shift, and any future auto-adaptation write.

## New ai-coach type — `plan-continuation`

Add to the type switch in the edge function. Inputs: `current_plan`, `race_date`, `race_distance`, `goal_time`, `training_days`, `timezone`. System prompt is a trimmed version of the training-plan prompt; user prompt is "The plan below stops short of {race_date}. Output ONLY the missing days from the day after the last entry through {race_date} inclusive, in the same markdown format, ending with 🏁 RACE DAY…". Route through the buffered + continuation branch by adding `"plan-continuation"` to `planRewriteTypes`.

## Files to change

- `supabase/functions/ai-coach/index.ts` — expand `planRewriteTypes` set, add final mandatory validation pass after the 3-pass loop, add `plan-continuation` type handler.
- `src/lib/plan-validation.ts` (new) — `validatePlanReachesRaceDay`, `lastIsoDate`, `hasRaceDayEntry` (ported from the edge function so client and server share logic).
- `src/lib/ai-stream.ts` — add `plan-continuation` to the accepted type union and pass-through args.
- `src/pages/TrainingPlan.tsx` — wrap `savePlan` with the validation+continuation guard; route the two splice writes (lines 695, 730) through `savePlan` instead of direct supabase updates.

## Verification

1. Regenerate active plan: confirm last entry is `🏁 RACE DAY` on stored `race_date`.
2. Tap Make it easier on a long plan: confirm same.
3. Tap Day Ahead → Move it on a session: confirm savePlan keeps race day intact (no extension needed since splice preserves it).
4. Manually truncate plan content in DB then trigger any save: confirm the client auto-extends via `plan-continuation` before writing.
5. Force a continuation failure (e.g. simulate 429): confirm the save is refused and the prior plan is preserved.
