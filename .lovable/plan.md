
## Goal
Give every workout in every plan a unified action menu so users can skip, move, swap with a templated alternative, or fully edit the session — with each change logged so the AI coach can see why the plan diverged.

## Scope
All workouts across all surfaces that render a plan session card today:
- `src/components/PlanDayList.tsx` (List view on `/training-plan`)
- `src/components/PlanCalendarView.tsx` (Month view)
- Workout detail dialog inside `PlanDayList`
- AIChatbot adjust-session row (already has Skip / Move / Recovery — extend with new entry points)

## New / changed files

1. **`src/lib/plan-day-actions.ts`** — extend with:
   - `applyReplaceWithTemplate(planContent, dateUk, template, opts)` for the 7 alternatives (Easy Run, Tempo, Race-Pace, Intervals, Long Run, Recovery Walk, Rest).
   - `applyEditWorkout(planContent, dateUk, edited)` that rewrites a single day block from a structured `EditedWorkout` model (title, segments[], notes, BPM).
   - `applyMoveSessionToDate(planContent, dateUk, isoTarget)` (move to a *specific* date chosen in a date picker — current `applyMoveSession` only moves to next training day).
   - Builders: `buildEasyRunBlock`, `buildTempoBlock`, `buildRacePaceBlock`, `buildIntervalsBlock`, `buildLongRunBlock`, `buildRecoveryWalkBlock`, `buildRestBlock`. Each takes the date + params and returns markdown matching the existing 5-column table format the validators expect.

2. **`src/lib/plan-edit-log.ts`** (new) — persists a change-history list keyed by plan id:
   - `logPlanEdit(planId, entry)` → inserts into a new `plan_edit_log` table (one row per change: `plan_id`, `user_id`, `date_uk`, `action`, `before_title`, `after_title`, `summary`, `details jsonb`, `created_at`).
   - `fetchPlanEditLog(planId, limit)` for the AI chatbot context builder.

3. **DB migration** (`plan_edit_log` table + RLS: users CRUD their own rows).

4. **`src/components/WorkoutEditDialog.tsx`** (new) — the "Edit/Replace Workout" UI:
   - **Action list** at the top: Skip, Move to…, Replace with recovery walk, Replace with alternative ▾, Edit workout details.
   - **Move to…** opens a shadcn Calendar popover (date picker).
   - **Replace with alternative** opens a dropdown of the 7 templates; each template reveals its own param form (duration / pace / structure).
   - **Edit workout details** switches the dialog body to a full structured editor:
     - Title input
     - Segments table (add/remove rows): segment name, duration, pace target, HR zone, notes
     - Coaching notes textarea
     - BPM suggestion input
   - Save calls the relevant `apply…` helper, then persists the new plan content + logs the edit + triggers existing post-save flow (revalidate, refresh activities, sync to Intervals if user opts in).

5. **Wire-up in `PlanDayList.tsx` and `PlanCalendarView.tsx`**:
   - Add a small "Edit / Replace" button (Pencil icon) on each workout card and inside the workout detail dialog.
   - Clicking opens `WorkoutEditDialog` with the workout + plan content.
   - Lifted via two new props on `PlanDayList` / `PlanCalendarView`: `onEditWorkout(dateUk)` and `planContent`.

6. **`src/pages/TrainingPlan.tsx`**:
   - New handler `handleEditWorkout(dateUk, change)` that:
     - Pushes current content onto undo stack (existing `pushUndoEntry`).
     - Updates `training_plans.content` (and `race_date` if a date moved past race day, reusing existing conflict-resolution helpers).
     - Calls `logPlanEdit(...)` with a concise summary.
     - Triggers existing post-edit refreshes (`refreshLinkedActivities`, plan re-parse, optional Intervals re-sync banner).
   - Passes `planContent` + `onEditWorkout` down to `PlanDayList` and `PlanCalendarView`.

7. **AI chatbot context** (`supabase/functions/ai-coach/index.ts` and `src/components/AIChatbot.tsx`):
   - When building the user-context payload for chat, include the last ~20 plan edits from `plan_edit_log` so the model can reference *why* the plan diverged.

## Validation & safety
- All template builders emit markdown that passes existing `enforceAndLog` / `recomputeAndLog` validation (warm-up, cool-down, no mobility rows, correct `(Total: Nmin)`).
- `applyEditWorkout` runs the validator before returning.
- Each apply helper goes through the same undo/redo plumbing already used for Skip / Move.
- Race-day conflict: if "Move to…" lands on or past race day, reuse `detectRaceDateConflict` + the existing compressed / shift-race dialog flow.

## Out of scope (explicitly not built)
- Bulk multi-day edits.
- AI rewrite of the edited session (the structured editor is deterministic; users can still ask the chatbot to redesign).
- A separate revision-history viewer UI — log is consumed by the AI coach only for now.

## Migration
```sql
CREATE TABLE public.plan_edit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  plan_id uuid not null,
  date_uk text not null,
  action text not null,           -- skip | move | replace_recovery | replace_template | edit
  template text,                  -- easy_run | tempo | race_pace | intervals | long_run | recovery_walk | rest | null
  before_title text,
  after_title text,
  summary text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
ALTER TABLE public.plan_edit_log ENABLE ROW LEVEL SECURITY;
-- standard owner CRUD policies
CREATE INDEX plan_edit_log_plan_id_created_idx ON public.plan_edit_log (plan_id, created_at DESC);
```
