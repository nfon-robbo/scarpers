## Goal
Fix the active training plan markdown in the database, then add four post-generation validation rules that run on every write path (generation, adjust, easier, harder, apply suggestions, Day Ahead, auto-adapt).

## Part 1 — One-off database fix for plan `5f0faaf7…`

Edit `training_plans.content` for the active plan:

1. **Duplicate Week 2 headings**: the plan has three back-to-back `### **WEEK 2: …**` blocks (Intensity & Volume Ramp / Mechanical Reset / Intensity Introduction) above the single Monday 18/05 row. This is what's making "Monday 18 May" appear duplicated in the calendar view. Collapse to a single `### **WEEK 2** — *Week of 18/05/2026 – 24/05/2026*` heading.
2. **Monday 29/06 "duplicate"**: source only has one row, but the same week-heading issue may apply. Verify only one `### **Monday 29/06/2026**` remains after the fix; if a stray WEEK 8 dup exists, collapse it too.
3. **Friday 29/05/2026 — Long Run Progression**: prepend `Warm-up | 5 min | Easy jog` row; existing 10 min cool-down stays. Bump total 60 → 65 min.
4. **Friday 19/06/2026 — Easy Shakeout**: add `Warm-up | 5 min | Easy walk` and `Cool-down | 5 min | Walk` around the 40 min main set. Total 40 → 50 min.
5. **Monday 22/06/2026 — Easy Run**: add 5 min walk warm-up + 5 min walk cool-down. Total 30 → 40 min.
6. **Friday 26/06/2026 — Short & Easy**: add 5 min walk warm-up + 5 min walk cool-down. Total 25 → 35 min.
7. **Thursday 21/05/2026 — Extended Intervals**: not a scheduled day (Mon/Wed/Fri). Wed 20/05 and Fri 22/05 already have sessions, so **remove** the Thursday block entirely (don't merge — the existing Wed/Fri sessions are already substantial).

Done as a one-shot `UPDATE training_plans` via the insert tool.

## Part 2 — Permanent validation rules

Add a single shared validator with four checks. Run it on every save path, before persisting.

### `src/lib/plan-validation.ts` (extend)

Add four new exported functions, each returning `{ content, corrections[] }`:

- `dedupeDates(markdown)` — Rule 1. Walk `### **<Day> DD/MM/YYYY**` headings; if a date repeats, keep the first occurrence's block and drop subsequent ones (and drop duplicated `### **WEEK N**` headings that share the same week range).
- `enforceWarmupCooldown(markdown)` — Rule 2. For every day block that has a segment table whose rows include any of `Main Set | Interval | Threshold | Tempo | Steady | VO2 | Hill | Fartlek | Strides | Long Run | Race Pace`, ensure first row is `Warm-up` (≥5 min) and last row is `Cool-down` (≥5 min). If missing, inject `| Warm-up | 5 min | Easy walk | |` / `| Cool-down | 5 min | Walk | |` and bump the heading total.
- `enforceScheduledDays(markdown, trainingDays)` — Rule 3. Parse `training_days` (e.g. `['Mon','Wed','Fri']`). If a session falls on another weekday **and** it is not labelled "Rest Day" or "RACE DAY", drop the block. Log every removal. (Race day + rest day stay.)
- `recomputeSessionTotals` already exists — Rule 4 is already done, keep it as the final step.

Public wrapper `validatePlanForSave(markdown, { trainingDays, raceDateIso, source })` runs all five (dedupe → schedule → warm-up/cool-down → existing warm-up minimums → recompute totals → `validatePlanReachesRaceDay`) and returns `{ content, corrections, blockingErrors }`. Console-logs every correction with the source label.

### Wire-up

Replace existing `recomputeAndLog` + `enforceAndLog` call sites with the new `validatePlanForSave`:

- `src/pages/TrainingPlan.tsx` — `savePlan()` and the race-day continuation flow. Pass `plan.training_days` and `plan.race_date`.
- `supabase/functions/ai-coach/index.ts` — every branch that writes back to `training_plans.content`: `plan-generate`, `plan-adjust`, `plan-easier`, `plan-harder`, `plan-apply`, `day-ahead` surgical-edit save, and any other type that mutates `content`. Port the same four checks into the edge function (mirroring the existing port pattern for `recomputeSessionTotals`). Read `training_days` and `race_date` from the loaded plan row.
- `supabase/functions/plan-auto-adapt/index.ts` — same; already has totals + warm-up min, add dedupe + scheduled-day + warm-up/cool-down injection.

### Non-goals

- No schema changes (training_days already on `training_plans`).
- No UI changes — `PlanDayList` already renders from the corrected markdown.
- No new prompt rules added to the AI system message; validators are deterministic post-processing only (the AI prompt already says these things, validators are the safety net).

## Files touched

- `src/lib/plan-validation.ts` (extend)
- `src/pages/TrainingPlan.tsx` (call site)
- `supabase/functions/ai-coach/index.ts` (port + call sites)
- `supabase/functions/plan-auto-adapt/index.ts` (port + call site)
- One `UPDATE training_plans` via insert tool for the active plan fix.

## Verification

After implementation: re-fetch the active plan from DB, eyeball the seven fixed sessions, and confirm console logs show zero corrections on a clean re-save (idempotent).