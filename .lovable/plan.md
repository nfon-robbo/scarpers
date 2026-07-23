# Fitness Benchmark Feature

Do NOT ask me which benchmark type to offer or present a menu of options back to me. The decisions are all below.

Points A, B and C must be investigated and reported back BEFORE you write any code. Do not proceed past them on an assumption.

---

# A. PRE-BUILD INVESTIGATION — REPORT BACK FIRST

## A1. Locating the effort inside the activity

Threshold HR must be averaged over minutes 10 to 30 of the 30 minute effort. To do that you must first identify which portion of a synced activity IS the 30 minute effort.

A completed benchmark activity is approximately 45 minutes long: 5 minute warm-up, 30 minute effort, 10 minute cool-down. There is currently nothing in this app that tells you where the effort begins.

The benchmark is scheduled as a plan workout, so it is pushed to [intervals.icu](http://intervals.icu) and on to Garmin as a structured workout with discrete steps. The resulting activity should therefore carry lap or interval boundaries matching those steps.

Investigate what lap, interval or step data is actually available on synced activities in this app, across both Strava and Health Connect paths. Tell me exactly what you find, with field names.

Then propose how to locate the 30 minute effort, including an explicit fallback for activities with no usable lap data — an athlete who ran it unstructured, or entered it manually.

Do not guess at where the effort starts. A wrong window here produces a wrong threshold HR silently, and every zone in the app is then wrong.

## A2. HR zone source of truth

Do not assume downstream consumers already read zones from a central source. Search the codebase for every place athlete HR zones are read, written or hard-coded, and list them for me with file paths.

If zones currently live somewhere other than the table you intend to create, do NOT create a parallel table. Tell me what you found and propose a migration path leaving exactly one source of truth.

## A3. Auto-detection duration window

The full benchmark activity is approximately 45 minutes, not 30. Any match rule built around a 30 minute duration will never fire. Tell me the matching window you intend to use before implementing it.

---

# PURPOSE

Two objectives, heart rate being the higher priority:

1. Replace the athlete's age-based HR zones with zones calculated from a measured Threshold Heart Rate.

2. Establish an accurate Threshold Pace driving pace targets, AI plan generation and [intervals.icu](http://intervals.icu) sync.

The benchmark must never prevent an athlete starting a training plan.

---

# DEFAULT BENCHMARK

Every athlete is assigned the 30 Minute Threshold Benchmark by default, regardless of experience level. It works for beginners through advanced runners, can be completed by walk/run athletes, self-paces naturally, has no failure state, and is the only benchmark producing a Threshold Heart Rate.

Structure:

- 5 minute easy warm-up

- 30 minute threshold effort

- 10 minute easy cool-down

Walk breaks are permitted if required.

Do NOT describe the effort as "run as hard as possible". Use this instruction verbatim:

"Run at the hardest pace you believe you can maintain evenly for the full 30 minutes. You should finish feeling you gave almost everything, but not having sprinted the first few minutes."

---

# OPTIONAL BENCHMARKS

Below the assigned benchmark, a de-emphasised secondary text link: "Use a different benchmark".

It opens a dialog offering a 3 km Time Trial and a 5 km Time Trial. Each: 5 minute warm-up, distance completed as fast as can be sustained, 10 minute cool-down.

Display this warning verbatim:

"This benchmark estimates running pace only. It cannot calculate threshold heart rate or rebuild your heart-rate zones."

These must never be the default path.

---

# BENCHMARK WORKOUT STRUCTURE

The benchmark is pushed to [intervals.icu](http://intervals.icu) like any other plan workout, as three steps: 5 minute easy warm-up, 30 minute effort, 10 minute easy cool-down.

No step carries a pace target. The 30 minute effort is a self-paced maximal test and a pace target would defeat its purpose. Warm-up and cool-down already carry no pace target under existing rules.

Give the effort step an explicit, distinctive name so it is identifiable both on the watch and in the resulting activity's lap data. This name is what the effort-window logic from A1 should key off wherever lap data is available.

---

# RESULT CAPTURE

## Automatic detection

Detect completed benchmark activities from synced Garmin or Strava activities within 48 hours of the scheduled benchmark date.

Match on total activity duration including warm-up and cool-down, using the window agreed in A3, plus workout type running. For 3K and 5K trials, match on distance within 10%.

Before accepting, display "Was this your benchmark run?" and require confirmation.

## Manual entry

30 minute benchmark: capture distance covered.

3K / 5K: capture finish time.

Manual entries have no HR stream. Handle them under the no-HR rules below rather than failing.

---

# POST-BENCHMARK QUESTIONS

Immediately after a benchmark is accepted, ask:

"How hard did this feel?" — Easy, Moderate, Hard, Very Hard, Maximal.

"Could you have continued?" — Easily, Another 15 minutes, Another 10 minutes, Another 5 minutes, No.

Store both against the benchmark record and expose them on the athlete profile.

If the athlete answers Easy, Moderate or Easily, mark the benchmark "Likely Submaximal" and display that flag in history.

---

# RAW DATA TO STORE

Store raw data separately from derived calculations. Raw values are never mutated after insert; recalculations write only to derived columns.

benchmark_type, benchmark_date, scheduled_date, distance, duration, average_pace, average_cadence, hr_stream_available, gps_confidence, capture_method, rpe_response, could_continue_response, effort_window_source (how the effort window was identified — lap data, fallback, or manual).

All constants live in a single BenchmarkConfig object.

---

# CALCULATIONS

## 30 minute benchmark

Threshold HR, if heart-rate data exists: average heart rate over ONLY the final 20 minutes of the 30 minute effort. Minutes 0 to 10 of the effort are excluded, as are warm-up and cool-down entirely.

Threshold pace: elapsed time divided by distance covered, across the full 30 minute effort. Elapsed time, not moving time — walk breaks are part of the benchmark. Do not smooth pace. Do not apply correction factors.

Predicted 5K: Riegel equation, exponent 1.06, from the distance covered in 30 minutes to 5000 metres.

## 3K and 5K time trials

predicted_5k_time = trial time multiplied by (5000 divided by trial distance) raised to the power 1.06. For a 5K trial this returns the trial time itself.

estimated_threshold_pace = predicted_5k_time divided by 5, expressed as seconds per kilometre.

Do not estimate Threshold HR. Do not rebuild HR zones.

## No heart-rate data

Record the pace result, leave zones untouched, and tell the athlete their zones could not be updated and why.

---

# HEART RATE ZONES

When Threshold HR exists, recalculate all five zones as percentages of it, replacing the age-based values. Percentages live in BenchmarkConfig. Defaults, contiguous with no gaps:

Zone 1: below 85%

Zone 2: 85% up to but not including 90%

Zone 3: 90% up to but not including 95%

Zone 4: 95% up to and including 102%

Zone 5: above 102%

Before applying, display existing zones and new zones side by side with bpm boundaries, and require confirmation. If any boundary shifts by more than 15 bpm, display "Large zone change detected" and explain that threshold testing has produced a significantly different estimate from the previous age-based calculation.

Confirmed zones flow into session HR targets, AI plan generation, readiness display, [intervals.icu](http://intervals.icu) sync, and anything else consuming athlete HR zones — via the single source of truth established in A2.

---

# BENCHMARK CONFIDENCE

Start at 100. Deductions, all held in BenchmarkConfig:

-30 no HR stream

-20 GPS confidence Low or anomalies detected

-20 second half pace more than 10% slower than first half

-15 cadence data unavailable

-15 athlete answered Easy, Moderate or Easily

Above 70 High. 40 to 70 Medium. Below 40 Low.

Store the applied deductions so the explanation UI can render them verbatim. Display the score in history. If Low, list which deductions occurred and recommend repeating the benchmark.

---

# BENCHMARK VALIDITY

Low-confidence benchmarks are stored and displayed exactly like any other.

Confirmation is already required for ALL pace recalculations and ALL zone changes, at every confidence level. Do NOT build an automatic-apply path anywhere.

---

# GPS CONFIDENCE

Store High, Medium or Low, inferred from the activity's position and pace streams: GPS spikes, unrealistic pace jumps, missing location data, large route anomalies. Default High if no issues are detected.

Do NOT assume Strava or Garmin exposes a ready-made GPS accuracy field, and do not invent a field name. If you find an actual documented field in the data you are receiving, report exactly which field and where it came from, and I will decide whether to use it.

---

# PRE-BENCHMARK PACE SEEDING

Never generate plans on generic defaults where athlete history exists. Seed in this order:

1. Fastest continuous 5 km from the previous 90 days.

2. Average pace of the last five easy runs, adjusted conservatively.

3. Conservative defaults, only if no usable history exists.

Label all seeded pacing "Provisional Pace" everywhere it surfaces, until a benchmark replaces it.

---

# PLAN GENERATION

Generate immediately. Never block plan creation.

Schedule the benchmark as the FINAL workout of Week 1. Never first. If the generator places it elsewhere, move it.

When results arrive: recalculate every remaining workout, display exactly what changed, require confirmation before applying.

If skipped: continue on provisional pacing, show a dismissible reminder banner only. Never a blocking modal.

---

# [INTERVALS.ICU](http://INTERVALS.ICU)

When threshold pace is set or changes, write it to the athlete's Run sport settings as threshold_pace in metres per second.

The hard-coded 3.03 m/s fallback in supabase/functions/intervals-sync/index.ts stays only for athletes with neither benchmark nor seedable history. A real value always takes precedence.

On any threshold pace or zone change, re-sync all future workouts through the existing path. Existing rules unchanged: warm-ups, cool-downs and recovery steps carry no pace target; workout pace targets remain a range of plus or minus 15 seconds per kilometre.

---

# RE-BENCHMARKING

Prompt for a repeat of the same benchmark type 6 weeks after a recorded benchmark.

Never overwrite. Append to history. Display date, benchmark type, distance, duration, threshold HR, threshold pace, predicted 5K, confidence score and the Likely Submaximal flag.

---

# OUT OF SCOPE

Do not build: recovery profile, HRV analysis, resting HR monitoring, training tolerance calculations, VDOT, additional race prediction models, additional benchmark types, social or sharing features, leaderboards.

Do not change: Running IQ, nutrition, sleep, readiness calculations, walk/run filtering logic. Existing walk/run flags may be read but not modified.

---

# VERIFICATION

Build, then verify against the implementation. Report the ACTUAL returned values alongside the expected ones — not a description of what the code should do.

1. Every athlete profile, including walk/run and zero-history athletes, receives the 30 Minute Threshold Benchmark by default.

2. All benchmark types show a 5 minute warm-up and 10 minute cool-down.

3. The override dialog offers only 3K and 5K and displays the HR warning.

4. Threshold HR is averaged over the final 20 minutes only. Test with a synthetic stream where the first 10 minutes average is deliberately different from the last 20, and show both figures to prove the first 10 were excluded.

5. Effort-window identification works on an activity with lap data and falls back correctly on one without. Show which path was taken in each case.

6. A 30 minute benchmark covering 4.2 km returns a threshold pace of 7:09/km. Show the returned value.

7. The same benchmark returns a predicted 5K of approximately 36 minutes 5 seconds using exponent 1.06. Show the value and the exponent used.

8. A Threshold HR of 165 bpm produces approximately: Zone 1 below 140, Zone 2 140 to 148, Zone 3 149 to 156, Zone 4 157 to 168, Zone 5 above 168. Show all five computed boundaries.

9. Zone boundaries are contiguous with no unassigned bpm values between zones.

10. The zone comparison appears before any change, and zones do not change without confirmation.

11. A benchmark with no HR data records a pace result, leaves zones untouched, and tells the athlete why.

12. Confidence fixture with no HR stream, a 12% second-half slowdown, cadence present, GPS High and a non-submaximal RPE returns 50 and Medium. State every input in the fixture explicitly.

13. A second fixture identical to the above but with cadence also missing returns 35 and Low.

14. RPE and could-continue responses are stored and visible in history.

15. Answering "Easily" marks the benchmark Likely Submaximal.

16. Plans created before benchmarking use seeded historical pacing labelled Provisional Pace, not generic defaults.

17. The benchmark is scheduled as the final workout of Week 1.

18. The benchmark workout pushes to [intervals.icu](http://intervals.icu) with three steps and no pace target on any of them.

19. Skipping the benchmark blocks nothing and shows only a dismissible reminder.

20. Threshold pace reaches [intervals.icu](http://intervals.icu) Run settings in metres per second and is visible there.

21. A second benchmark appends to history rather than replacing the first.

22. No automatic-apply path exists for pace or zone changes at any confidence level. Confirm by code search as well as tests.