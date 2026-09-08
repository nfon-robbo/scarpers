# "That pace was too slow" — coach-recommended pace, applied across the plan

When a session's run pace feels too slow, you get a coach recommendation for a better pace, can accept it or type your own, and the plan updates everywhere that pace appears — including any later sessions of the same type that are slower than the new one.

## How it works for you

1. You flag the pace as too slow, from any of three places:
   - the AI chat ("9:15 is too slow")
   - the after-run questions popup (new "Pace felt too slow / too fast" option)
   - an "Adjust pace" button on a session in the training plan
2. A pace dialog opens showing the current target (e.g. 9:15/km) and a coach recommendation (e.g. 8:30–8:50/km) with a one-line reason based on your run data — recent run paces, heart rate against your measured zones, your benchmark threshold pace, cadence and any active niggle.
3. You either accept the recommendation or enter your own pace.
4. Before anything is saved you see a plain list of every session that will change: date, session name, old pace, new pace.
5. On confirm, the plan is saved, undo stays available, and the changed future sessions re-sync to intervals.icu through the normal sync path.

## What gets changed

Only sessions of the same type as the one you flagged (an easy-run change never touches tempo or interval sessions), only dated sessions from today forward, and never warm-up, cool-down or walk rows — those stay heart-rate based with no pace.

Within that set:
- sessions showing the same old pace get the new pace
- sessions slower than the new pace get raised to it
- sessions already faster than the new pace are left alone

Completed and past sessions are never touched.

## Technical detail

New file `src/lib/pace-adjustment.ts`:
- `classifySessionType(title, segmentName)` — reuses the keyword table in `recompute-plan-paces.ts` (easy / steady / marathon / threshold / cv / vo2 / rep / race) and returns `null` for warm-up, cool-down, walk and mobility rows.
- `parsePaceToken` / `paceToSeconds` — handles `M:SS/km` and `M:SS-M:SS/km`, comparing on the slower (upper) bound.
- `planPaceChangePreview(planContent, { fromIsoDate, sessionType, oldPace, newPace })` — walks dated blocks and their `| Segment | Duration | Target | HR Zone | Notes |` tables, returns `{ newContent, changes[] }` with no side effects (same contract as `recomputePlanPaces`).
- `recommendPace(...)` — deterministic fallback derived from the confirmed benchmark threshold pace via `paceRangeFromThreshold` for the session category, clamped so the recommendation is never more than ~10% faster than the current target.

AI recommendation: a new `mode: "pace_recommendation"` branch in `supabase/functions/ai-coach/index.ts`, using the existing plan/activity/readiness context builder. It returns strict JSON `{ recommendedPace, rationale }` only — no prose plan edits, no LLM-authored table rewrite — so the number is deterministic downstream. If the call fails, the deterministic fallback above is used and the dialog says so.

New component `src/components/PaceAdjustDialog.tsx`, modelled on `PlanPaceRecalcDialog.tsx`: recommendation card, "Use my own pace" input with validation, grouped change preview, confirm writing `training_plans.content` and invoking `intervals-sync`, plus an entry in `plan-edit-log` / undo history.

Wiring:
- `src/components/AIChatbot.tsx` — when the message matches a "too slow / too fast" intent for a dated session, open `PaceAdjustDialog` instead of routing through the day-adjust LLM. `parsePaceChangeRecommendation` stays as the fallback when the coach already stated an explicit pace.
- `src/components/WorkoutReviewDialog.tsx` — add the pace-feedback question after the existing effort/niggle questions; choosing "too slow" opens the same dialog for the completed session's pace.
- `src/pages/TrainingPlan.tsx` / `src/components/PlanDayList.tsx` — "Adjust pace" action on a paced session, opening the same dialog.

Guardrails: no changes to warm-up/cool-down pacing rules, no changes to benchmark or zone logic, and the existing plan validators still run after the rewrite.
