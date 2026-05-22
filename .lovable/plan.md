Scope (phase 1 — basic pause/resume)

Implements items 1–3 from the brief, plus the database schema. Item 4 gives users a choice between shifting the race date or keeping it fixed (with intelligent resume point). Item 5 (Garmin / [Intervals.icu](http://Intervals.icu) workout deletion + re-sync on resume) is deferred to phase 2 to keep this ship-able.

The user is told clearly in both the pause and resume confirmations how their race date and plan structure will be affected.

Database

New migration adds four columns to [public.training](http://public.training)_plans:

- paused_at TIMESTAMPTZ NULL

- paused_until TIMESTAMPTZ NULL

- pause_reason TEXT NULL (free text; UI offers Holiday / Illness / Injury / Other)

- race_date_mode TEXT NULL ('fixed' | 'shift')

No RLS changes needed — the existing auth.uid() = user_id policies cover these columns. After migration runs, Supabase types regenerate automatically and the page reads them.

New component: PlanPauseDialog.tsx

Single dialog with two modes driven by current pause state.

Pause mode (when paused_at is null):

- Start date: defaults to today, calendar picker.

- End date: defaults to today + 7d, calendar picker, must be > start.

- Reason chips: Holiday / Illness / Injury / Other (writes to pause_reason).

- Race date handling (NEW): Two radio options with live preview:

  ● Keep race date fixed (DEFAULT)

    Race stays: 6 Jul 2026

    Plan will compress to fit

    Resume at: Week 4 (recovery week recommended)

    ⚠️ Week 3 skipped to maintain race date

    

  ○ Shift race date forward

    Race moves: 6 Jul → 13 Jul (+7 days)

    Full plan preserved, all weeks shift

- Preview block updates based on selected option:

  * Fixed: "Resume at Week 4 on Mon 29 May. Race day stays 06 Jul (5 weeks remaining). Week 3 skipped."

  * Shift: "Plan resumes Mon 29 May. Race day moves from 06 Jul → 13 Jul (+7 days)."

- Confirm writes paused_at, paused_until, pause_reason, and race_date_mode. No date shift on pause — workouts in the pause window are simply hidden behind the banner and don't count as "missed".

Resume mode (when paused_at is not null and user clicks Resume):

Three radio options (shown only if race_date_mode was 'shift'; if 'fixed', auto-selects intelligent resume point):

- Skip to next week (recommended) — shifts all workouts from paused_at onward forward so the next scheduled session lands on the Monday after paused_until. If race_date_mode was 'fixed', automatically jumps to the most appropriate week given remaining time to race.

- Repeat last completed week — same shift, but the week before paused_at is duplicated and inserted at the new resume point.

- Continue from paused week — shifts workouts forward by exactly the pause duration (start of paused week resumes on resume date).

Preview: shows new race day (if shifted) or confirmed fixed race day, and the week/date where training resumes.

Confirm clears paused_at / paused_until / pause_reason / race_date_mode, rewrites content via the appropriate helper (shift or intelligent resume), and updates training_plans.race_date and start_date if they moved.

Race date handling logic:

FIXED RACE DATE MODE:

- Calculate: pauseDays = paused_until - paused_at

- Calculate: daysToRace = race_date - paused_until  

- Calculate: weeksRemaining = floor(daysToRace / 7)

- Determine intelligent resume point using new helper intelligentResumePoint(currentWeek, weeksRemaining, totalPlanWeeks):

  * If paused during Weeks 1-3 (base building) → resume at Week 4 (recovery week)

  * If paused during Week 4 (recovery) → resume at Week 5 (speed building)

  * If paused during Weeks 5-6 (speed/race pace) → resume at same week (critical phase)

  * If paused during Weeks 7-8 (taper) → resume at Week 7 (skip minimal)

- Show clear messaging: "Week 3 skipped to keep race date fixed at 6 Jul"

- Race date remains unchanged in database

- Skipped weeks are noted in pause metadata for user reference

SHIFT RACE DATE MODE:

- All workouts shift forward by pauseDays using existing shiftPlanDates helper

- race_date shifts forward by pauseDays

- start_date shifts forward by pauseDays  

- Full 8-week plan structure preserved

- All weeks remain intact

Phase 1 uses the existing shiftPlanDates(markdown, deltaDays) in TrainingPlan.tsx — we extract it into src/lib/plan-utils.ts so the dialog can call it. Add new helper intelligentResumePoint(currentWeek, weeksRemaining, totalWeeks) that calculates which week to resume at when race date is fixed. The "repeat last week" variant additionally splices the previous week's table rows in.

UI integration in src/pages/TrainingPlan.tsx

- Load paused_at, paused_until, pause_reason, race_date_mode alongside the existing plan fetch and store in component state.

- Add a <Button variant="secondary">⏸️ Pause Plan</Button> next to the existing date popover in the headerAction slot passed to PlanOverview. When paused, the same button becomes ▶️ Resume Training.

- Above PlanOverview, when paused, render a new <PlanPausedBanner>:

  * Amber/warning surface, lock icon, headline "Plan paused until DD MMM yyyy"

  * Shows: "Race date: [fixed at 6 Jul | moved to 13 Jul]" based on race_date_mode

  * Optional reason chip (Holiday/Illness/Injury), "Resume now" button on the right.

- Pass isPaused down to PlanOverview / PlanDayList / RaceEstimateTabs:

  * PlanOverview already shows "Today's workout" — when paused, replace that block with a muted "Paused — recovery time" card and stop computing "missed" markers (skip the isBefore(today) strike-through for dates inside the pause window).

  * RaceEstimateTabs — gate the auto-recalculate trigger; when paused, render the last prediction with a small "Paused" pill and skip the racePredictRefresh re-fetch.

- Dashboard.tsx (/dashboard) — read the same fields and show the banner there too so the user sees it on the home screen with race date mode clearly indicated.

Manual activity logging continues to work because the activities tables and Upload page are independent of plan state.

Out of scope (phase 2 follow-up, will land in a separate change)

- Advanced intelligent compression with workout criticality analysis (phase 1 uses simple week-based resume logic).

- Deleting future workouts from Garmin / [Intervals.icu](http://Intervals.icu) on pause and re-syncing on resume (item 5). Today the user must run their normal sync after resume; the resume confirmation toast will mention this.

Files touched

- supabase/migrations/<timestamp>_add_plan_pause.sql — add 4 nullable columns (including race_date_mode).

- src/lib/plan-utils.ts — new file; export shiftPlanDates, intelligentResumePoint(currentWeek, weeksRemaining, totalWeeks), duplicateWeek(date) helpers extracted from TrainingPlan.tsx.

- src/components/PlanPauseDialog.tsx — new dialog component with race date choice (fixed vs shift), live preview, and mode-appropriate resume options.

- src/components/PlanPausedBanner.tsx — new banner component showing pause status and race date mode.

- src/pages/TrainingPlan.tsx — load pause state including race_date_mode, render banner, wire pause/resume button into headerAction, gate "missed" logic when paused.

- src/pages/Dashboard.tsx — render the same banner when the active plan is paused.

- src/components/PlanOverview.tsx — accept an isPaused prop; when true, skip the "today's workout" block and don't render strike-through on past dates inside the pause window.

- src/components/RaceEstimateTabs.tsx — accept isPaused; show "Paused" pill and skip auto-refresh.