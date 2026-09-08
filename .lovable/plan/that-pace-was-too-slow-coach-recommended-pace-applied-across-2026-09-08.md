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
5. On confirm, the plan is saved, undo stays available, and the changed future sessions re-sync to [intervals.icu](http://intervals.icu) through the normal sync path.

## What gets changed

Only sessions of the same type as the one you flagged (an easy-run change never touches tempo or interval sessions), only dated sessions from today forward, and never warm-up, cool-down or walk rows — those stay heart-rate based with no pace.

Within that set:

- comparison is on the slower (upper) bound of each session's pace range — any future session whose upper bound is at or slower than the new pace's upper bound gets raised to the new pace
- sessions already faster than the new pace are left alone
- race-day sessions are always excluded from the cascade, regardless of session type match — a coach recommendation never rewrites the actual race target

Completed and past sessions are never touched.

## Technical detail

New file `src/lib/pace-adjustment.ts`:

- `classifySessionType(title, segmentName)` — reuses the keyword table in `recompute-plan-paces.ts` (easy / steady / marathon / threshold / cv / vo2 / rep / race) and returns `null` for warm-up, cool-down, walk and mobility rows.
- `parsePaceToken` / `paceToSeconds` — handles `M:SS/km` and `M:SS-M:SS/km`, comparing on the slower (upper) bound.
- `planPaceChangePreview(planContent, { fromIsoDate, sessionType, oldPace, newPace })` — walks dated blocks and their `| Segment | Duration | Target | HR Zone | Notes |` tables, returns `{ newContent, changes[] }` with no side effects (same contract as `recomputePlanPaces`). Excludes race-day sessions unconditionally, in addition to the existing warm-up/cool-down/walk/mobility exclusion.
- `recommendPace(...)` — deterministic fallback derived from the confirmed benchmark threshold pace via `paceRangeFromThreshold` for the session category, clamped so the recommendation is never more than ~10% faster than the current target.

AI recommendation: a new `mode: "pace_recommendation"` branch in `supabase/functions/ai-coach/index.ts`, using the existing plan/activity/readiness context builder. It returns strict JSON `{ recommendedPace, rationale }` only — no prose plan edits, no LLM-authored table rewrite — so the number is deterministic downstream. If the call fails, the deterministic fallback above is used and the dialog says so.

New component `src/components/PaceAdjustDialog.tsx`, modelled on `PlanPaceRecalcDialog.tsx`: recommendation card, "Use my own pace" input with validation, grouped change preview, confirm writing `training_plans.content` and invoking `intervals-sync`, plus an entry in `plan-edit-log` / undo history.

**Custom pace entry:** "Use my own pace" is not clamped by the ~10% recommendation cap — it's a deliberate user override. If the entered pace is more than ~10% faster than the coach recommendation, the dialog shows a non-blocking warning ("This is faster than we'd normally recommend based on your data") but still allows confirm.

**Undo behaviour:** undo reverts `training_plans.content` to its pre-change state **and** re-triggers `intervals-sync` for every session that was part of the change set, so the watch reflects the reverted paces rather than the ones that were briefly pushed. This follows the same pattern as the existing pause/resume auto-delete-and-re-push logic — undo is not just a content rollback, it's a full re-sync.

Wiring:

- `src/components/AIChatbot.tsx` — when the message matches a "too slow / too fast" intent for a dated session, open `PaceAdjustDialog` instead of routing through the day-adjust LLM. `parsePaceChangeRecommendation` stays as the fallback when the coach already stated an explicit pace.
- `src/components/WorkoutReviewDialog.tsx` — add the pace-feedback question after the existing effort/niggle questions; choosing "too slow" opens the same dialog for the completed session's pace.
- `src/pages/TrainingPlan.tsx` / `src/components/PlanDayList.tsx` — "Adjust pace" action on a paced session, opening the same dialog.

Guardrails: no changes to warm-up/cool-down pacing rules, no changes to benchmark or zone logic, race-day sessions are never modified by this feature, and the existing plan validators still run after the rewrite.