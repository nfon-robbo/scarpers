Findings

* RaceTimeEstimate.tsx does contain extraction code, but it only looks at raw_data.gps_track, not laps.

* supabase/functions/race-predict/index.ts does not contain segment extraction, and the current UI does not appear to call that function.

* The actual Garmin activity payloads have no raw_data.laps and no raw_data.records.

* They do have raw_data.gps_track with fields: speed, elapsed_time, distance_meters, heart_rate, cadence, lat/lng, etc.

* The extraction is likely failing because the code assumes speed is in m/s, but stored Garmin speeds are in km/h. Example: median speeds around 5.6, max around 9.1; using the current >= 2.0 m/s threshold treats too much walking/jogging incorrectly and the final pace/duration gates can reject the output.

* One linked walk/run activity has only ~2 minutes above 7 km/h, so it should show a useful failure reason rather than silently disappearing.

Plan

1. Update src/components/RaceTimeEstimate.tsx extraction to support the actual Garmin gps_track structure.

   * Treat speed as km/h when values look like Garmin export data (median <20 indicates km/h not m/s).

   * Use distance deltas from distance_meters as the source of truth for segment distances.

   * Extract run-only segments using running threshold: speed >= 7.0 km/h (8:34/km pace ceiling).

   * Walking threshold: speed < 7.0 km/h.

   * Minimum viable segment for debugging visibility: ≥2 minutes / ≥200m.

   * Minimum for actual estimate: ≥8 minutes total run time across all segments.

   * Pace validation after extraction: extracted run pace must be <8:30/km to be used.

2. Add temporary visible debug output in the breakdown.

   * Show: attempted extraction count, succeeded count, failed count.

   * For each failed candidate, show a short reason such as:

      * no gps_track

      * run segment too short (<8min total)

      * pace outside accepted range (>8:30/km)

      * distance/timing missing

   * Include extracted run pace and duration when successful.

   * Example: "Run segments: 12min @ 7:15/km extracted from 3 walk/run sessions"

3. Fix the immediate prediction fallback.

   * If the athlete is clearly in walk/run phase (excluded_count >= 3 and clean_count <= 1) and VO2 max exists, use VO2 max at 100% rather than blending in contaminated clean pace.

   * Show a note: Based on VO2 max 38 only — run segment extraction in development.

   * This should move the 5K estimate back toward the VO2-based value (33:34) instead of ~35:26.

4. Align the backend race predictor for consistency.

   * Add the same extraction helper to supabase/functions/race-predict/index.ts.

   * Extend activity selection to include raw_data.

   * Avoid rejecting walk/run workouts entirely when run segments can be extracted.

   * Keep function logs minimal and targeted so we can inspect extraction attempts if the backend function is used later.

5. Validate after implementation.

   * Re-check the UI breakdown on /training-plan.

   * Confirm it no longer says 3 walk/run or interval sessions excluded without explanation.

   * Confirm it shows extraction attempts and either recovered run segments or clear failure reasons.

   * Confirm the estimate uses VO2-only fallback during this walk/run phase when extraction is not reliable enough.

Expected result after implementation:

For user with VO2 max 38 doing walk/run intervals (4×3min @ 7:15/km):

BEFORE (current):

- Prediction: 35:26

- Breakdown: "3 walk/run sessions excluded, 1 clean run (contaminated)"

AFTER (with extraction):

- Prediction: 32:30-34:00

- Breakdown:

  * VO2 max 38: 33:34 (60%)

  * Run segments extracted: 12min @ 7:15/km from 3 walk/run sessions (30%)

  * Easy pace from extracted segments (10%)

  * Debug: Extraction attempted on 3 activities, succeeded: 3, failed: 0

OR if extraction fails:

- Prediction: 33:34

- Breakdown:

  * VO2 max 38: 33:34 (100%)

  * Based on VO2 max only — run segments too short for reliable extraction

  * Debug: Extraction attempted on 3 activities, succeeded: 0, failed: 3

    - Activity 1: run segment 2min (need ≥8min)

    - Activity 2: run segment 3min (need ≥8min)

    - Activity 3: no gps_track data

This gives accurate prediction matching fitness level, with full transparency about what data was used.