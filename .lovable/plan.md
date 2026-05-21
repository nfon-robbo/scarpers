Add Today's Activity Check to Assess Day Ahead

Closes the blind spot where Assess Day Ahead ignores activities already logged on the target date (morning runs, completed scheduled workouts, double-days).

1. Edge function — fetch + classify today's activities

File: supabase/functions/ai-coach/index.ts (day-adjust branch, after the existing yesterday block ~line 489)

After targetDateStr is computed, also query activities for the target date (not always "today" — respects the rest-day walk-forward):

SELECT activity_id, activity_type, distance_meters, duration_seconds,

       avg_heart_rate, max_heart_rate, training_load, start_time, raw_data

FROM activities

WHERE user_id = <auth uid from JWT>

  AND start_time >= <targetDateStr>T00:00:00+00

  AND start_time <  <targetDateStr+1>T00:00:00+00

  AND distance_meters >= 500

  AND duration_seconds >= 60

ORDER BY start_time DESC

LIMIT 5

(Uses the existing service-role supabase client + [user.id](http://user.id); timezone window kept as ISO day — matches how yesterday is queried today. UK-DST drift is acceptable; documented in code comment.)

Pull activity name from raw_[data.name](http://data.name) / raw_data.title / raw_data.activity_name (fallback to activity_type).

Classification (per activity, in order)

For each row, call a new helper matchScheduledWorkout(activity, plannedWorkoutText) (see §2):

a. SCHEDULED_WORKOUT_COMPLETED — distance within ±20% AND duration within ±20% AND activity_type compatible with the planned discipline, OR fuzzy name match against title keywords in today_workout.

b. Else EXTRA_ACTIVITY.

Aggregate across the day:

totalDistanceKm, totalDurationMin, count, scheduledMatched: boolean.

2. Pure helpers

File: supabase/functions/ai-coach/day-adjust-logic.ts

Add:

- extractWorkoutSignals(plannedWorkoutText) → { distanceKm?: number, durationMin?: number, keywords: string[], discipline: 'run'|'bike'|'swim'|'other' }. Regex-based, mirrors the existing intensity detector.

- matchScheduledWorkout(activity, signals) → { matched: boolean, reason: string }. Within ±20% on each present signal; keyword overlap counts as a soft match.

- classifyTodayActivities(activities, plannedWorkoutText) → { status: 'SCHEDULED_WORKOUT_COMPLETED'|'EXTRA_ACTIVITY'|'NONE', totals, matchedActivity?, others[] }.

- Constant EXTREME_DAY_VOLUME = { minutes: 90, km: 15 } and isExtremeAccumulatedVolume(totals).

3. Branch the edge function response

After classification:

SCHEDULED_WORKOUT_COMPLETED → short-circuit before calling the LLM. Stream a fixed Markdown block as if it were the LLM output (so existing SSE client code works unchanged):

✅ Today's workout already completed

You completed **{name}** at {HH:mm}:

- Distance: {x.x} km

- Duration: {mm:ss}

- Avg HR: {bpm} bpm

Great work — no adjustment needed. See you tomorrow for {next workout title}.

Include a machine-readable trailer line so the client can detect it deterministically:

<!-- DAY_ADJUST_STATUS: WORKOUT_ALREADY_COMPLETED activity_id={uuid} -->

"Next workout" is looked up from current_plan if available; otherwise omit that line.

EXTRA_ACTIVITY (single) → append a new section to the user prompt (after YESTERDAY context):

TODAY'S TRAINING (already completed before this assessment):

- 1 activity: {type} {x.x}km / {mm}min @ {bpm}bpm (started {HH:mm})

- Status: EXTRA_ACTIVITY (not the scheduled workout)

And append a mandatory system-prompt rule:

You MUST include this warning verbatim in Coach's Note: "⚠️ You've already run {x.x}km today. If tonight's session feels too hard, skip it — you've already done significant training."

EXTRA_ACTIVITY (multiple) / accumulated:

- Prompt context lists all activities + totals.

- If isExtremeAccumulatedVolume(totals) → set a flag forceRestDay = true and inject a system rule:

Decision MUST be ADJUSTED. Replace the recommended workout with a Rest Day table. Coach's Note must include: "⚠️ OVERRIDE: You've already trained {x}km / {y}min today. Replacing tonight's workout with Rest Day to prevent overtraining."

NONE → no change to current behaviour.

4. Client handling

File: src/pages/TrainingPlan.tsx (around assessDayAhead, ~line 1320 in onDone)

- In onDelta, additionally test for the trailer DAY_ADJUST_STATUS: WORKOUT_ALREADY_COMPLETED and capture activity_id.

- New state: dayAdjustCompletedActivityId: string | null.

- In the dialog rendering (existing day-adjust dialog component):

  * When status = completed: hide "Apply Changes" and "Sync to Garmin" buttons; show a "View Activity" button that routes to /activities (or the existing activity detail dialog, matching how completed-workout cards already navigate).

  * setDayAdjustIsModified(false) remains, so no plan diff is attempted.

5. Tests

File: supabase/functions/ai-coach/day-adjust.test.ts

Add unit tests for the new helpers:

- extractWorkoutSignals("Tempo 8km @ 4:30/km") → distance 8, discipline 'run', keywords include 'tempo'.

- matchScheduledWorkout: 8.4km/35min vs planned 8km/34min → matched. 5km easy vs planned 5×800m tempo → not matched.

- classifyTodayActivities with no rows → NONE; with one matched → SCHEDULED_WORKOUT_COMPLETED; with one unmatched 5km → EXTRA_ACTIVITY; with 10km + 8km → EXTRA_ACTIVITY + isExtremeAccumulatedVolume === true.

File: supabase/functions/ai-coach/STAGING_[TESTS.md](http://TESTS.md)

Add 4 scenarios:

- Completed scheduled workout at 07:00, assess 14:00 → "already completed" block + trailer.

- Unplanned 5km easy at 07:00, assess scheduled tempo → warning verbatim in Coach's Note.

- 10km morning + 8km lunch, assess intervals → forced ADJUSTED with Rest Day override.

- No activities today → identical output to current behaviour (regression guard).

CRITICAL EDGE CASE HANDLING:

When fetching today's activities, the query uses start_time for the date boundary. This means:

- An activity that started yesterday at 23:50 and ended today at 00:10 will NOT appear in today's results (correct - it's yesterday's training)

- An activity that started today at 23:50 and ends tomorrow at 00:10 WILL appear in today's results (correct - it's today's training)

This start_time-based logic matches how activities are normally bucketed by day in the app and prevents double-counting overnight activities.

EXTREME_DAY_VOLUME thresholds rationale:

- 90 minutes total = ~12-15km for most runners = approaching half-marathon training volume in one day

- 15km total = regardless of pace, this is significant accumulated distance

Either threshold alone triggers the override because both indicate high training stress that makes an additional evening workout unsafe.

Out of scope

- No DB migrations (uses existing activities columns).

- No changes to yesterday's logic, gating thresholds, or escalation tiers.

- No changes to adjustNextWorkout flow (that already targets a future date with no completed activities possible).

Files touched

- supabase/functions/ai-coach/index.ts

- supabase/functions/ai-coach/day-adjust-logic.ts

- supabase/functions/ai-coach/day-adjust.test.ts

- supabase/functions/ai-coach/STAGING_[TESTS.md](http://TESTS.md)

- src/pages/TrainingPlan.tsx