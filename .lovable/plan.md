Day Ahead Assessment - Required Improvements

CURRENT FLOW (working correctly):

1. Client selects target workout (today's session or next non-rest if today is rest/completed)

2. Edge function pulls: sleep, biometrics, yesterday's activities, 14-day trends, cadence data, athlete context

3. Gating rule: Default KEEP AS-IS unless (consecutive poor nights ≥2 AND corroborating signal)

4. Returns structured assessment with decision + recommended workout + coach's note

5. If ADJUSTED, client surgically edits plan and auto-syncs to [intervals.icu](http://intervals.icu)

IMPROVEMENTS NEEDED:

1. BASELINE CALCULATION STABILITY

Current: 14-day mean for HRV and RHR baselines

Problem: Outliers (2-3 bad nights) drag baseline down, reducing sensitivity

Fix: Use MEDIAN instead of MEAN for 14-day HRV and RHR baselines - more robust to outliers

CRITICAL: Median function must handle edge cases:

- Empty array → return null or 0 (don't crash)

- Single value [50] → return 50

- Two values [50, 60] → return 55 (average of middle two)

- Array with nulls [50, null, 60, null, 70] → filter nulls first, then calculate median

This prevents crashes when users have incomplete data (new accounts, missing Garmin sync)

2. "HARD WORKOUT" CORROBORATION DEFINITION

Current: "Yesterday was hard/long" is vague

Problem: Unclear what triggers this corroboration signal

Fix: Define explicit thresholds in edge function:

- Hard = (duration >60min AND avg_hr ≥85% max) OR (training_load >150) OR (≥20min in Z4/Z5)

- Long = duration >90min regardless of intensity

Document this in the system prompt so AI knows when to cite it

3. POOR NIGHT SCORING LOGIC

Current: score <60 OR <6 hours (treats them as equal weight)

Problem: 5.5h at score 75 (short but efficient) triggers same as 7h at score 55 (long but fragmented)

Fix: Refine poor night definition:

- Poor night = (score <60 AND duration <7h) OR score <50

This distinguishes short-but-efficient from long-but-terrible sleep

4. SOFT ADJUSTMENT TIER FOR SINGLE BAD NIGHTS

Current: Single bad night with normal HRV/RHR → KEEP AS-IS + generic ease-off note

Problem: No actionable workout modification, just verbal suggestion

Fix: Add SOFT ADJUSTED tier between KEEP AS-IS and ADJUSTED:

- Triggers on: 1 poor night + (HRV 10-15% below baseline OR RHR +2 bpm)

- Modification: Keep workout structure, but reduce target pace by 10-15 sec/km OR add "Extra 5min warmup - monitor how you feel, scale back if needed"

- Output: "✅ Decision: SOFT ADJUSTED — one suboptimal night with slightly elevated fatigue markers"

This gives runners permission to ease off without feeling like they failed the plan

5. ACTIONABLE CADENCE COACHING

Current: Coach's Note flags if cadence <160 spm, says "aim for 170-180"

Problem: No guidance on HOW to increase cadence

Fix: When cadence is flagged, include ONE concrete cue:

- "Try a 170 BPM metronome playlist today (search 'running 170 bpm' on Spotify)"

- "Focus on quicker foot turnover - imagine running on hot coals"

- "Shorten your stride 10% while maintaining the same speed - your feet should feel lighter"

Rotate these cues so users get variety, not the same advice every time

6. TRAINING LOAD VELOCITY CHECK

Current: Gating only checks sleep + HRV/RHR

Problem: Back-to-back hard days (Tue tempo + Wed intervals) can accumulate fatigue before HRV/RHR degrade enough to trigger adjustment

Fix: Add training load velocity rule:

- IF yesterday's session was hard (per definition above)

- AND today is also scheduled hard (tempo/intervals/race pace)

- AND last night was poor (even if HRV/RHR only slightly off)

- THEN recommend ADJUSTED (swap hard session for easy run)

Reasoning: "Two consecutive hard sessions on suboptimal recovery risks overtraining"

7. CHRONIC POOR SLEEP ESCALATION

Current: Adjustment triggers after 2 nights, but no escalation logic for 3, 4, 5+ nights

Problem: User might keep training on poor sleep indefinitely

Fix: Escalate Coach's Note based on consecutive poor nights:

- Night 3: "Third poor night in a row - identify what's disrupting your sleep (stress, caffeine, screen time)"

- Night 5: "⚠️ Sleep has been poor for 5+ nights. Prioritize rest and recovery - training is secondary right now. Consider consulting a doctor if this continues."

- Night 7+: Force workout to Rest Day regardless of other metrics + "⚠️ MANDATORY REST - seven consecutive poor nights indicates you need medical attention, not training"

8. REST DAY CLARITY

Current: If today is rest day, assessment walks forward to next workout

Problem: User clicks "Assess Day Ahead" on Monday (rest day), sees "Planned Workout: Tuesday 22 May" without context

Fix: If today is a rest day, prepend output with:

"🛌 Today (Monday 21 May) is a scheduled rest day.

Assessing tomorrow's workout (Tuesday 22 May)..."

This prevents confusion about which day is being assessed

IMPLEMENTATION:

All work in supabase/functions/ai-coach/index.ts (day-adjust branch + system prompt) and small client-side changes in src/pages/TrainingPlan.tsx and src/lib/ai-stream.ts.

Key changes:

- Replace mean with median for baselines (with edge case handling)

- Add explicit hard/long workout classification

- Refine poor night predicate

- Implement SOFT ADJUSTED decision tier (requires both prompt change AND client regex update)

- Build cadence cue rotation (5-6 cues, random selection)

- Add training load velocity check to gating rules

- Add chronic poor sleep escalation (3/5/7+ night handling)

- Add rest day clarity prepend when target_is_not_today=true

TEST COVERAGE REQUIRED:

Create test suite in supabase/functions/ai-coach/day-adjust.test.ts covering:

Layer 1 - Pure logic unit tests (deterministic):

- Poor night predicate: (55, 6h)→poor; (58, 7.5h)→not poor; (48, 8h)→poor

- Median calculation: odd/even arrays, single value, outlier robustness

- Median edge cases (CRITICAL): 

  * Empty array [] → return null or 0, don't crash

  * Single value [50] → return 50

  * Two values [50, 60] → return 55 (average of middle two)

  * Array with nulls [50, null, 60, null, 70] → filter nulls first, return median(50,60,70)=60

- Yesterday load classifier: duration/HR/load thresholds

- Today intensity detection: tempo/interval/easy/rest keywords

- Cadence cue rotation: verify all 5-6 cues reachable, no duplicates

- Escalation tiers: 2 nights→null; 3→warning; 5→medical advice; 7→mandatory rest

- Load velocity force-adjust: combinations of yesterday hard + today hard + poor night

Layer 2 - Prompt assembly integration tests:

- Scenario 1 (1 poor + HRV -12%): prompt includes SOFT ADJUSTED rule

- Scenario 2 (2 poor + HRV -18%): prompt includes standard ADJUSTED rule

- Scenario 3 (load velocity): prompt contains yesterday hard + today hard + velocity rule

- Scenario 4 (5 nights): prompt contains 5-night escalation verbatim

- Scenario 5 (7 nights): prompt contains mandatory rest instruction

- Scenario 6 (rest day): prompt includes prepend template when target_is_not_today=true

- Scenario 7 (cadence 155): prompt contains random cadence cue + instruction

Layer 3 - Manual staging checklist:

Create STAGING_[TESTS.md](http://TESTS.md) with curl payloads for manual pre-deploy verification of actual LLM output.

Files to create/edit:

- NEW: supabase/functions/ai-coach/day-adjust-logic.ts (extracted helpers including robust median function)

- NEW: supabase/functions/ai-coach/day-adjust.test.ts (Layers 1+2, ~25 assertions)

- NEW: supabase/functions/ai-coach/STAGING_[TESTS.md](http://TESTS.md) (Layer 3 manual)

- EDIT: supabase/functions/ai-coach/index.ts (import helpers, no behavior change)

- EDIT: src/pages/TrainingPlan.tsx (regex + new payload fields)

- EDIT: src/lib/ai-stream.ts (new optional fields)

Run tests with: supabase--test_edge_functions with {"functions": ["ai-coach"]}

Expected: ~25-30 assertions, all passing in <1 second

These improvements maintain conservative gating while catching edge cases and providing more actionable guidance.