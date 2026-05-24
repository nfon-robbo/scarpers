# Create algorithm documentation

&nbsp;

Create /docs/algorithms/ with four markdown files. Source of truth = the actual code (your spec values will be adjusted where they differ — see notes below). Same style across all four: numbered sections, markdown tables, formula code blocks, worked examples with real numbers, "Where it's consumed" section, file/function refs, and short "Why?" callouts on key decisions.

&nbsp;

Files

&nbsp;

sleep-score.md — written first, becomes the template.

&nbsp;

Source: src/lib/sleep-score.ts (calculateSleepScore, scoreLabel).

&nbsp;

Sections: Inputs · Two scoring paths (fallback duration-only vs full stages) · Component breakdown (Duration 25 · Deep 30 · REM 20 · Efficiency 15 · Light-heavy penalty −10) · Final assembly & clamp · Label thresholds · Worked example (e.g. 7h45 sleep, 18% deep, 22% REM, 91% eff → ~88) · Where consumed (SleepCalendar, readiness.ts, sleep-insight edge fn, AIChatbot).

&nbsp;

body-battery.md

&nbsp;

Source: src/lib/body-battery.ts (computeBodyBattery, initialBatteryFromSleep, passiveDrainRate, totalPassiveDrain, activityDrain).

&nbsp;

Sections per your outline, but values match code:

&nbsp;

- Starting charge = base 45 + duration (≤40) + deep bonus (≤12) + REM bonus (≤8) + HRV vs baseline (±10) + sleep-debt (±5). Floor 10, ceiling 100. (Your spec's "9 pts/hr × deep_minutes" formula isn't what the code does — I'll document the actual stepwise table.)

&nbsp;

- Passive drain bands: 0–4h → 2/hr, 4–8h → 3/hr, 8–12h → 4/hr, 12h+ → 5/hr (integrated hour-by-hour). (Your spec said 1–8h→2/hr; code says 0–4h→2, 4–8h→3. Documenting code.)

&nbsp;

- Activity drain = intensityLoad × 0.05 pts per activity, summed.

&nbsp;

- Status bands: Charged ≥70 · Steady ≥40 · Low ≥20 · Drained <20. Floor 5.

&nbsp;

- Worked example (95% start → 14h awake → 1h hard run): show passive integration ~46pts + activity ~10pts → ~39%.

&nbsp;

- Where consumed: BodyBattery48hDialog.tsx, readiness.ts (as a penalty, not a positive weight), readiness-hourly-snapshot edge fn.

&nbsp;

- Note: there is no formal "Reserve Mode" in code — I'll document the Drained status instead and flag that "Reserve Mode" isn't implemented.

&nbsp;

readiness.md

&nbsp;

Source: src/lib/readiness.ts (computeReadiness).

&nbsp;

Actual weights (not the ones in your spec):

&nbsp;

| Factor | Weight |

|--------|--------|

| Sleep Quality | 34% |

| HRV vs baseline | 23% |

| Yesterday's Load | 16% |

| Deep Sleep % | 15% |

| Resting HR vs baseline | 12% |

&nbsp;

Plus EOD-only modifiers (additive ±): Recovery clock, 3-day Sleep Debt, Training Monotony (7d/28d), Today's Effort, Body Battery penalty (max −25). Morning mode skips modifiers.

&nbsp;

Sections: Inputs · Mode (morning vs eod) · Each factor's scoring curve (with the exact thresholds from code, e.g. sleep aggressive curve s≥80 raw, ≥60 ×0.75, ≥50 ×0.65, else ×0.55; HRV pct bands; RHR diff bands; deep% bands; yesterday-load bands) · Modifier formulas · Composite assembly (baseScore = Σ(factor×weight), then + modifiers + batteryPenalty, clamp 5–100) · Label thresholds (taken from ReadinessWidget) · Carry-forward behavior (note where it lives — readiness-hourly-snapshot / widget logic; I'll verify in the file before writing) · Worked example · Where consumed (ReadinessWidget, Dashboard, edge fn).

&nbsp;

I'll flag where your spec's "7-factor 34/18/16/13/12/4/3" diverges from the implemented 5-factor + modifiers model.

&nbsp;

race-predictor.md

&nbsp;

Source: supabase/functions/race-predict/index.ts.

&nbsp;

IMPORTANT: This function was recently refactored (May 2026). Document the CURRENT implementation with all recent fixes.

&nbsp;

Current weights (after May 2026 fixes): VO2 max 60% · Tempo 30% · Easy 10%

&nbsp;

Sections:

&nbsp;

1. Inputs

   - Activities from past 56 days

   - VO2 max from past 14 days  

   - Readiness scores from past 7 days

   - Training plan data (if available)

&nbsp;

2. Activity Filtering (Walk/Run Contamination Removal)

   Exclude activities that match ANY of these criteria:

   - Title matches regex: /walk|interval|fartlek/i

   - Average pace > 8:30/km (too slow to be running)

   - Lap variance coefficient of variation (CV) > 0.30 (inconsistent effort)

   - Heart rate < 100 bpm for >10% of total duration

   - Recent activities: prefer past 21 days, extend to 56 days if insufficient data

&nbsp;

3. Run Segment Extraction (NEW - May 2026)

   - Data source: gps_track field in raw_data JSON

   - Speed threshold: ≥ 7.0 km/h (NOTE: Garmin stores speed in km/h, not m/s)

   - Minimum viable run time: 8 minutes total extracted running

   - Validation: extracted average pace must be < 8:30/km

   - Purpose: Extract clean running segments from walk/run interval workouts

   - This prevents walk breaks from contaminating tempo pace calculations

&nbsp;

4. Pace Extraction

   - Easy pace: median pace from activities with HR ≤ 150 bpm, pace between 4:00-9:00/km

   - Tempo pace: fastest sustained run ≥15 min from past 14 days

     * If activity contains walk breaks: use run segment extraction

     * Extract only portions where speed ≥ 7.0 km/h

     * Calculate average pace from extracted segments only

   - Both categories use run segment extraction to eliminate walk contamination

&nbsp;

5. VO2 Max → 5K Pace Conversion

   - Table-based lookup (e.g., VO2 38 → 5:35/km for 5K)

   - Riegel formula for distance extrapolation to other race distances

   - Reference: VO2 max to race pace tables (standard running physiology)

&nbsp;

6. Weighted Prediction Formula (UPDATED May 2026)

   Three-component weighted average:

   - VO2 max baseline: 60% weight (increased from 30%)

     * Direct lookup from VO2 → pace table

   - Extracted tempo pace: 30% weight (unchanged)

     * Conversion: tempo_pace - 65 s/km → estimated race pace

     * Rationale: tempo is ~10-15 s/km slower than 5K race pace

   - Easy pace: 10% weight (unchanged)

     * Conversion: easy_pace - 90 s/km → estimated race pace

     * Rationale: easy is ~1:30/km slower than race pace

   Final prediction = (VO2_component × 0.60) + (tempo_component × 0.30) + (easy_component × 0.10)

   Then multiply by distance to get total time.

&nbsp;

7. Pace Range Requirement (Garmin/Intervals.icu Sync)

   - Problem: Single pace values fail silently on Garmin watches

   - Solution: All pace targets must be ranges

   - Format: center_pace ± 15 s/km

   - Example: 6:00/km → range of 5:45-6:15/km

   - threshold_pace requirement: 

     * Must exist on athlete's Run sport settings in Intervals.icu

     * If missing, Edge Function PUTs threshold_pace: 3.03 m/s before creating workout

     * Without this, Garmin drops ALL pace targets from synced workouts

&nbsp;

8. Sanity Cap (NEW - May 2026)

   - Safety check: if prediction > 1.4× VO2-only baseline → reject and use VO2-only

   - Purpose: Prevent absurd predictions from contaminated or erroneous data

   - Example: VO2 38 gives baseline ~33:34 for 5K

     * Sanity cap: 33:34 × 1.4 = 47:08

     * Any prediction >47:08 is replaced with 33:34 (VO2-only estimate)

&nbsp;

9. Adjustments

   - Plan completion taper: up to −8% time reduction for weeks completed

   - Adherence penalty: if plan completion <70%, add penalty

   - Mean readiness adjustment: ±1-2% based on 7-day average readiness score

   - These are secondary adjustments applied AFTER the weighted prediction

&nbsp;

10. Confidence Tiers

    - HIGH: Recent tempo data (<7 days), VO2 max current, 5+ qualifying runs

    - MEDIUM: Tempo 7-14 days old, 3-4 qualifying runs

    - LOW: Stale data (>14 days), <3 qualifying runs, or missing components

&nbsp;

11. History Deduplication

    - Skip recalculation if identical prediction exists within past 6 hours

    - Prevents spam from multiple page loads or pause/resume actions

    - Only user-triggered manual recalculation or new activity sync should force update

&nbsp;

12. Graceful Degradation

    - Returns "insufficient data" response if <3 qualifying runs in past 21 days

    - Returns VO2-only baseline if tempo/easy data unavailable

    - Never crashes or returns null - always provides best available estimate

&nbsp;

13. Worked Example

    User profile:

    - VO2 max: 38

    - Recent tempo: 7:29/km (extracted from walk/run interval workout using run segments)

    - Recent easy: 8:00/km

    - Target: 5K race

    Component calculations:

    - VO2 baseline (60%): VO2 38 → 5:35/km → 33:34 for 5K

    - Tempo component (30%): 7:29/km - 65s = 6:24/km → 32:02 for 5K

    - Easy component (10%): 8:00/km - 90s = 6:30/km → 32:30 for 5K

    Weighted average:

    (33:34 × 0.60) + (32:02 × 0.30) + (32:30 × 0.10) = 32:57

    Final prediction: 32:57 for 5K (6:38/km pace)

    Sanity check: 32:57 < 47:08 (1.4× baseline) ✓ PASS

    Goal comparison: Target 30:00, currently 3:09 slower

&nbsp;

14. Where Consumed

    - RaceEstimateTabs.tsx (main gauge display, current prediction)

    - RacePredictionGraph.tsx (historical progress chart, trend line)

    - RaceTimeEstimate.tsx (summary card with goal comparison)

    - AIChatbot race prediction intent (AI assistant queries)

    - supabase/functions/intervals-sync (for creating workouts with pace targets)

&nbsp;

15. Recent Fixes & Evolution (May 2026)

    Critical improvements that fixed major prediction bugs:

    - Run segment extraction from GPS tracks (7.0 km/h speed threshold)

      * Problem: Walk/run interval workouts averaged walk breaks into tempo pace

      * Example: 10 min run + 5 min walk = 7:29/km average (wrong)

      * Solution: Extract only running segments → 6:30/km true running pace

    - Walk/run activity filtering

      * Exclude activities with "walk", "interval", "fartlek" in title

      * Prevents contamination of pace calculations

    - VO2 max weighting increased: 30% → 60%

      * Old bug: User with VO2 42 predicted 47:27 for 5K (absurd)

      * Root cause: Contaminated tempo data weighted too heavily (50%)

      * Fix: Trust VO2 max more (60%), tempo less (30%)

      * Result: Same user now predicts 32:57 (realistic)

    - Pace range enforcement for Garmin sync

      * Single values fail silently on watch

      * Must use ±15s/km ranges

    - Sanity cap implementation

      * Prevents predictions >1.4× VO2 baseline

      * Catches data quality issues before they reach user

    - threshold_pace auto-creation

      * Intervals.icu requires threshold_pace on Run sport

      * Function now PUTs 3.03 m/s if missing

      * Without this, ALL pace targets disappear from Garmin workouts

&nbsp;

16. Known Limitations

    - Requires minimum 3 qualifying runs in 21 days

    - Cannot predict for distances >marathon (Riegel formula breaks down)

    - Assumes consistent training - sudden fitness changes lag by 7-14 days

    - GPS accuracy affects run segment extraction quality

    - Weather/terrain not factored (assumes similar conditions to training)

&nbsp;

Reference functions: 

- supabase/functions/race-predict/index.ts

  * extractRunSegments() - GPS track parsing

  * predictRaceTime() - main prediction logic

  * POST handler - orchestration and validation

&nbsp;

Formatting (applied to all four)

&nbsp;

- Numbered top-level sections, ### for sub-blocks.

- Markdown tables for every threshold band.

- Formulas in fenced code blocks.

- "Why?" italic callouts on non-obvious choices (e.g. why deep% is weighted heaviest; why HRV missing is a mild penalty not catastrophic; why race predictor weights tempo > VO2 was WRONG and VO2 > tempo is correct).

- Final "Where it's consumed" bullet list with file.tsx + function name.

- UK date format if any dates appear.

&nbsp;

Order

&nbsp;

sleep-score.md → body-battery.md → readiness.md → race-predictor.md.

&nbsp;

No code changes outside /docs/algorithms/.