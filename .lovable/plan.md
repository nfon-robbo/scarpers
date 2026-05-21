Batch 1 + Assessment Lock — Assess Day Ahead

Scope: implement improvements #1, #2, #4 plus the assessment lock. Defer #3 and #5. Skip #6. All changes are additive — no change to gating logic, escalation, LLM prompt, or yesterday handling.

1. Tighten short-workout matching (improvement #2)

File: supabase/functions/ai-coach/day-adjust-logic.ts

In matchScheduledWorkout, add an absolute floor on top of the existing ±20% relative check so a 3 km shakeout no longer false-matches a 2.5 km warm-up.

Constants: 

MATCH_FLOOR = { distanceKm: 0.75, durationMin: 5 }

SHORT_THRESHOLD = { distanceKm: 7.5, durationMin: 50 }

Logic for each signal:

For distance:

- If signals.distanceKm >= SHORT_THRESHOLD.distanceKm:

  Pass if |activity.distanceKm - signals.distanceKm| <= signals.distanceKm * 0.20

- If signals.distanceKm < SHORT_THRESHOLD.distanceKm (short workout):

  Pass if |Δ| <= MATCH_FLOOR.distanceKm (must be within 0.75km regardless of percentage)

For duration (same pattern):

- If signals.durationMin >= SHORT_THRESHOLD.durationMin:

  Pass if |activity.durationMin - signals.durationMin| <= signals.durationMin * 0.20

- If signals.durationMin < SHORT_THRESHOLD.durationMin (short workout):

  Pass if |Δ| <= MATCH_FLOOR.durationMin (must be within 5min regardless of percentage)

Rationale: 

- Long workouts (>7.5km or >50min): ±20% is reasonable (e.g., 20km ±4km = 16-24km range)

- Short workouts (<7.5km or <50min): absolute tolerance prevents false matches (e.g., 3km must be 2.25-3.75km, not 2.4-3.6km which would be ±20%)

Update reason strings to indicate which rule failed ("distance delta 0.8km exceeds floor for short workout" vs "distance delta 4.5km exceeds 20% for planned 20km").

Add unit tests in day-adjust.test.ts:

- 3 km planned vs 2.5 km activity → no match (delta 0.5km but 2.5/3 = 83%, would pass ±20% but fails floor)

- 3 km planned vs 2.9 km activity → match (delta 0.1km, within floor)

- 20 km planned vs 17 km activity → match (delta 3km = 15%, passes ±20%, floor doesn't apply)

- 30 min planned vs 22 min activity → no match (delta 8min exceeds 5min floor)

- 90 min planned vs 78 min activity → match (delta 12min = 13%, passes ±20%, floor doesn't apply)

2. Detected-activity chip (improvement #4)

Goal: before the LLM streams, show a small chip in the dialog naming the activity the edge function detected, so the recommendation feels grounded.

Edge function (supabase/functions/ai-coach/index.ts):

When today's activities exist and status is EXTRA_ACTIVITY (chip is redundant for WORKOUT_ALREADY_COMPLETED since the full message names the activity, and unnecessary for NONE), prepend a hidden SSE trailer before any other content:

<!-- DAY_ADJUST_DETECTED: name="10.2 km easy run" started="07:14" count=1 totalKm=10.2 totalMin=58 -->

Emit it as the first streamed chunk so the client sees it before LLM tokens.

Client (src/pages/TrainingPlan.tsx):

- New state dayAdjustDetected: { label: string; startedAt: string; count: number } | null.

- In assessDayAhead.onDelta, parse the trailer once (before stripping it for rendering), set state, and continue.

- In the dialog body (above the streaming Markdown, line ~2638), render a compact chip when set:

  * "Detected: {label} at {startedAt}" with a small Activity icon.

  * Themed with existing tokens (bg-muted/40 text-muted-foreground border border-border rounded-full px-3 py-1 text-xs).

  * Reset chip state on each new assessment and on dialog close.

  * Strip DAY_ADJUST_DETECTED from displayed Markdown the same way DAY_ADJUST_STATUS is stripped.

3. 30-minute assessment cache (improvement #1)

Client only. Avoids re-running the LLM when the user re-clicks within 30 min and nothing material changed.

File: src/pages/TrainingPlan.tsx

- Module-level Map<string, { result: string; detected: ... | null; completedActivityId: string | null; at: number }> keyed by ${[user.id](http://user.id)}|${targetDateStr}|${todayActivityCount}.

- Activity count source: read activities row count for the target ISO day via a lightweight Supabase query (select id count with head: true) inside assessDayAhead before the LLM call. Cheap, single round-trip.

- TTL: 30 min. On cache hit, skip streamAICoach entirely: set dayAdjustResult, dayAdjustDetected, dayAdjustCompletedActivityId, jump phase to done, and open the dialog.

- Cache write happens in onDone.

- Invalidate the cache entry when the user clicks Apply (since the plan changed) and on tab focus only if a new activity appeared (cheap re-count vs cached count).

4. Assessment lock (additional fix)

Client only. Prevents two simultaneous assessments.

File: src/pages/TrainingPlan.tsx

- Reuse the existing dayAdjusting state as the lock — it's already set true at the start of assessDayAhead and reset in onDone/onError/cache hits.

- At the very top of assessDayAhead:

if (dayAdjusting) {

  toast({ title: "Assessment already in progress", description: "Please wait for the current assessment to finish." });

  return;

}

- Guarantee the flag clears in all exit paths:

  * existing onDone ✓

  * existing onError ✓

  * early return when no upcoming workout (already returns before setting true ✓)

  * early return when session expired (already clears ✓)

  * new: wrap the streamAICoach call so an unexpected throw also resets dayAdjusting and closes the dialog (try/catch around the call).

  * Also gate adjustNextWorkout the same way (it shares the same dialog and dayAdjusting state).

The existing button disabled={...|| dayAdjusting} already prevents double-click from the UI; the toast guard catches programmatic / nav-state triggers (adjustNextWorkout auto-apply via location state).

Files touched

- supabase/functions/ai-coach/day-adjust-logic.ts — match-floor logic

- supabase/functions/ai-coach/day-adjust.test.ts — new tests for the floor

- supabase/functions/ai-coach/index.ts — emit DAY_ADJUST_DETECTED trailer for EXTRA_ACTIVITY

- src/pages/TrainingPlan.tsx — detected chip, cache, lock guard

- supabase/functions/ai-coach/STAGING_[TESTS.md](http://TESTS.md) — add 3 scenarios (short-workout false-positive avoided; chip appears for extra activity; cache hit skips LLM within 30 min)

Out of scope

- Decision codes in trailer (#3) — defer.

- HRV z-score (#5) — defer.

- Emoji consistency (#6) — skipped.

- No DB migrations, no LLM prompt changes, no changes to escalation/gating, no Apply/Sync flow changes.

Verification

- Run supabase--test_edge_functions after edits — all existing tests must still pass plus new short-workout tests.

- Manual: in preview, click Assess Day Ahead twice rapidly → second click shows lock toast. Re-click within 30 min → instant result (cache). Add an unplanned morning run via Strava sync → detected chip appears.