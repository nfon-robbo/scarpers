## Goal

Make the training plan adapt automatically week-to-week based on readiness trends — both downward (auto-apply rest) and upward (offer optional bump).

## Triggers

**Downward (auto-apply):**

- Readiness < 55 for 2+ consecutive days using `readiness_snapshots` latest daily score. Only trigger if actual readings exist for both days — do not trigger on null or missing data.
- Action: rewrite remaining sessions in the current week (today → Sunday) to reduce intensity.

**Upward (offer only):**

- Readiness ≥ 80 AND Running IQ trend positive (current > 7-day avg) for 3+ consecutive days.
- Action: surface a one-tap "Bump intensity" prompt — user accepts or dismisses. No auto-apply.

## Adaptation rules (down)

For each remaining session in the current week's markdown table:

- Interval / threshold / tempo / VO2 sessions → swap for **Easy run** at same day, duration ×0.85.
- Long run → keep type, duration ×0.85, drop any embedded surges.
- Easy / recovery runs → duration ×0.85 (min 20 min), no type change.
- Rest days untouched.
- Round durations to nearest 5 min.

Then notify:

> "We've adjusted this week's plan based on your recovery. Get some rest and come back stronger."

## Adaptation rules (up, on accept)

- Add +5–10% duration to one quality session this week.
- Upgrade one easy run to a steady/strides session (small bump only — never invent a new VO2/threshold).
- Long run unchanged.
- Confirm with toast: "Plan bumped — go get it."

## Where it lives

### 1. New Edge Function: `plan-auto-adapt`

- Inputs: `user_id`, `mode` ('down' | 'up').
- Fetches latest 5 days of `readiness_snapshots` + `running_iq_snapshots`.
- Loads active (non-archived) `training_plans` row.
- Uses Lovable AI Gateway (`google/gemini-2.5-flash`) with strict prompt: receive markdown table + week range + mode, return the modified markdown table only, preserving [Intervals.icu](http://Intervals.icu) syntax and existing rules from `mem://features/training-plans`.
- Persists with an audit row in `plan-undo-history` so the user can revert.
- Returns the updated plan content + a short summary.

### 2. Trigger logic

- New helper `src/lib/plan-adaptation.ts`:
  - `evaluateAdaptation(snapshots, iqSnapshots)` → `{ direction: 'down' | 'up' | null, reason }`.
  - Only evaluates when actual readiness readings exist for the relevant days — skip if any day in the window has a null score.
  - Reads from the same data already loaded on Dashboard / TrainingPlan.
- Called on:
  - `Dashboard` mount (once per session, debounced by date-stamp in localStorage `lastAdaptCheck:<userId>:<yyyy-mm-dd>`).
  - `TrainingPlan` mount.
- 'down' → invoke function immediately, then show sonner toast with the message above + link "View changes".
- 'up' → show a dismissible card on Dashboard (above HeroPlanCard) with Accept / Not now. Accept → invoke function in 'up' mode.

### 3. UI

- New component `src/components/PlanAdaptationBanner.tsx` for the upward offer (glassmorphism card matching theme).
- Reuse sonner toast for downward notification.
- Both link to `/training-plan` with the week highlighted.
- New adaptation history log visible to the user — a simple timeline on the Training Plan page showing entries such as "Monday 12 May — plan reduced due to low recovery" with a one-tap revert button per entry. Builds transparency and gives users a reason to check the app daily.

### 4. Safeguards

- Skip if no active plan, or if plan was already adapted today (track `last_adapted_at` — see schema).
- Skip if user is in taper/race week (last 2 weeks of plan).
- Skip if readiness data is missing or null for any day in the trigger window.
- Always write previous content to undo history before overwriting.

## Schema change

Add to `training_plans`:

- `last_adapted_at timestamptz null`
- `last_adaptation_reason text null` ('readiness_low_2d', 'readiness_high_3d_accepted')

Add to `plan-undo-history`:

- `adaptation_reason text null`
- `adapted_at timestamptz null`
- `summary text null`

No RLS changes needed (existing user_id policies cover it).

## Out of scope

- Auto-rewriting future weeks (only the current week's remaining days).
- Touching race week / taper.
- Changing the existing manual "Day Ahead" flow — it stays as-is.

## Files to create / edit

- `supabase/migrations/<ts>_plan_adaptation.sql` — add columns to training_plans and plan-undo-history.
- `supabase/functions/plan-auto-adapt/index.ts` — new edge function.
- `src/lib/plan-adaptation.ts` — trigger evaluation helper with null data safeguard.
- `src/components/PlanAdaptationBanner.tsx` — upward offer UI.
- `src/components/AdaptationHistory.tsx` — new timeline component with revert buttons.
- `src/pages/Dashboard.tsx` — wire up check + banner.
- `src/pages/TrainingPlan.tsx` — wire up check + adaptation history log.
- `mem://features/training-plans/auto-adaptation` — new memory + index update.