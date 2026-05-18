## Goal

Make **Assess Day Ahead** produce the same advice and the same three action buttons as the sleep sync check, so a single poor night doesn't trigger an adjustment, and ADJUSTED outcomes offer Make it easier / Move it / Keep it.

Note on terminology: there is no separate "sleep sync check" function in the codebase today — I'll treat your description as the spec, and align the existing Day Ahead flow to it. The three-button action set already exists in the AI Chatbot (`src/components/AIChatbot.tsx` — `applyDayAction` with `skip` / `move` / `move-compressed` / `move-shift-race` and `detectRaceDateConflict`). We'll reuse that exact logic.

## Changes

### 1. `supabase/functions/ai-coach/index.ts` — `day-adjust` system prompt (lines ~290–354)

Rewrite the decision rubric so ADJUSTED requires a real trend, not a one-off bad night:

- **KEEP AS-IS (default)** when any of these are true:
  - Only one night of poor sleep (score < 60 or short total) with HRV within ~15% of baseline and RHR within ~2 bpm of baseline.
  - No sleep data at all.
  - Sleep is normal.
- **ADJUSTED** only when **both** of these hold:
  - Two or more **consecutive** nights of poor sleep (score < 60, very short total, or high fragmentation), **and**
  - At least one corroborating signal: HRV >15% below baseline, RHR ≥3 bpm above baseline, or yesterday was a hard/long session.

When the decision is KEEP AS-IS but last night was sub-average, the Coach's Note **must include this exact sentence** (verbatim, matching the sleep sync check wording):

> Sleep was a little below your average last night. Listen to your body during the warmup and ease off if needed.

When the decision is ADJUSTED, the Decision section must briefly state which two-night pattern + corroborating metric triggered it.

To feed the trend check, also fetch the **last 7 nights** of sleep (`daily_metrics.sleep_score`, `sleep_duration_seconds`, deep/REM/awake minutes) and the **last 14 days** of `daily_metrics.hrv` and `resting_heart_rate` to compute baselines, and inject them into the user prompt as a small `SLEEP TREND` / `BASELINES` block. (Existing single-day fetch stays for "last night" detail.)

### 2. `src/pages/TrainingPlan.tsx` — Day Ahead dialog actions (lines ~2287–2308)

Replace the current two-button ADJUSTED state ("Apply Adjusted Workout" / "Keep Original") with three buttons matching the sleep sync check and the chatbot's day-action set:

- **Make it easier** — runs the existing `applyDayAdjustment()` path (surgical replace of the day's block from `dayAdjustResult`). Same behavior as today's "Apply Adjusted Workout".
- **Move it** — calls a new helper `moveDayAheadSession()` that mirrors the chatbot logic in `AIChatbot.tsx` `applyDayAction("move", …)`:
  1. Build a preview with `applyMove(content, dateUk)`.
  2. Use `detectRaceDateConflict(preview, raceDate)`; if conflict, open a small inline conflict prompt (same three sub-options the chatbot already shows: **Stick to race date (compress)** → `applyMoveCompressed`, **Move race date forward** → `applyMoveAndShiftRace`, **Skip this session** → `applySkip`).
  3. Otherwise apply the move, validate, persist to `training_plans`, register undo via `pushPlanUndo`, refresh in place.
- **Keep it** — dismiss the dialog (current `dismissDayAdjust()`), no plan change.

For the KEEP AS-IS branch, leave the single "Got it, let's go!" button as today — the soft awareness message now lives inside the AI response body.

To avoid duplicating logic, extract the move/skip/conflict block from `AIChatbot.tsx` into a shared helper (e.g. `src/lib/plan-move-actions.ts`) exposing:
- `previewAndDetectConflict(planContent, dateUk, raceDate)`
- `commitDayAction(planId, planContent, dateUk, action, raceDate)` returning `{ updatedContent, summary, newRaceDate? }`

Then both `AIChatbot.applyDayAction` and the new Day Ahead handler call it. This keeps the two entry points (chat vs. Day Ahead) functionally identical.

### 3. Wire-up details

- New state in `TrainingPlan.tsx`: `dayAdjustConflictPrompt: { dateUk, cascadeDays, overflowCount, shiftedRaceLabel } | null` to render the conflict sub-options inline inside the existing dialog (no second modal).
- Refresh plan content + `linkedActivities` after Move it/skip/compress so `PlanStatsBar` and `PlanDayList` re-render with the new schedule.
- Show a toast on success matching the chatbot's wording (`✅ {summary}`) so the two flows feel identical.

## Out of scope

- No schema changes.
- No new AI provider calls beyond the existing `day-adjust` request (the extra trend data is loaded server-side from existing tables).
- No changes to the post-plan analysis dialog or chatbot UI itself — only logic extraction.

## Files touched

- `supabase/functions/ai-coach/index.ts` — prompt + extra context fetches for `day-adjust`.
- `src/lib/plan-move-actions.ts` — new shared helper (extracted from `AIChatbot.applyDayAction`).
- `src/components/AIChatbot.tsx` — switch `applyDayAction` to call the shared helper (behavior unchanged).
- `src/pages/TrainingPlan.tsx` — Day Ahead dialog: three-button ADJUSTED state, conflict sub-prompt, refresh after action.
