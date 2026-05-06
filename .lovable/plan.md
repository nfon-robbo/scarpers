# Add manual sections to a workout (Intervals-safe)

Let users append their own steps (warm-up, rep, cool-down, or custom) to any workout from the detail dialog, and have those steps flow through to Intervals.icu when they export.

## What the user sees

In the workout detail dialog (the popup with numbered steps), a new **"+ Add step"** button appears below the last step. Tapping it opens a small inline form:

- **Type**: Warm-up / Rep / Cool-down / Custom
- **Label** (auto-filled from type, editable — e.g. "Easy jog", "1 km @ tempo")
- **Duration** (mm:ss)
- **Pace** (m:ss /km, optional — hidden for warm-up/cool-down, matching existing behaviour)

Save adds the step to the bottom of the numbered list. Each user-added step shows a small **"Custom"** badge and a trash icon to remove it. The existing tap-to-edit on duration/pace works on them too.

The list-view `~Xmin` summary updates to include the added time (race-day still shows only the race effort, per the fix just made).

## Where it plugs in

- **`src/components/PlanDayList.tsx`** — the dialog (lines 553–650) iterates `expandWorkoutSteps(...)`. Render `[...expandedSteps, ...customSteps]` and add the "+ Add step" affordance + inline `AddStepForm` (co-located, like `EditableStat`).
- **Storage** — reuse the existing `localStorage` pattern. Add `plan-custom-steps`:
  ```ts
  // { [workoutKey]: Array<{ id, kind: 'warmup'|'rep'|'cooldown'|'custom', label, duration, pace? }> }
  ```
  Same `workoutKey(w)` (date + title) so steps stick to the right day.
- **Duration summary** — `extractDuration` adds custom-step seconds to the displayed `~Xmin` (skipped on race-day).

## Intervals.icu integration (the important part)

The current export builds an `~~~intervals` block from `expandWorkoutSteps`. To carry custom steps through:

1. **Single source of truth at export time.** Add a small helper `getEffectiveSteps(workout)` that returns `[...expandedSteps, ...customSteps]`. Both the detail dialog and the Intervals export call this — guaranteeing what the user sees is what they export.
2. **Same syntax, no new fields.** Custom steps render with the existing Intervals syntax already used elsewhere in the codebase:
   - Warm-up / cool-down → `Xmin Z2` (or `Z1` for cool-down) — no pace, matches how the AI plans render them today.
   - Rep / custom with pace → `Xmin Pace m:ss` — exactly the format `expandWorkoutSteps` already emits.
   - Rep / custom without pace → `Xmin Z2` fallback.
3. **No schema or markdown changes.** `training_plans.content` is never modified; custom steps live only in `localStorage`. The bulk-upsert payload to Intervals stays structurally identical — just longer.
4. **Verified before shipping.** Quick check in `src/lib/plan-export.ts` (and the intervals encoder) to confirm appended steps round-trip cleanly: each line is one of `Xmin Z[1-5]` or `Xmin Pace m:ss/km`, which are the formats Intervals already accepts in this app.

## Out of scope

- No backend writes; no edits to `training_plans.content`.
- No reordering between AI steps and custom steps in v1 — custom steps render last (matches "I added a cool-down" mental model).
- No editing of the AI step list itself (already handled by the existing override system).

## Technical notes

- New small component `AddStepForm` co-located in `PlanDayList.tsx`.
- Defaults: warm-up → 10:00 no pace, cool-down → 10:00 no pace, rep → 01:00 @ 5:00, custom → blank.
- Custom rows reuse the same row markup (`Footprints` / `PersonStanding` icon, `EditableStat` for duration/pace) so visuals stay consistent.
- Export call sites (`plan-export.ts`, intervals sync edge function caller) get switched from `expandWorkoutSteps(...)` to `getEffectiveSteps(...)` in the same one-line change.
