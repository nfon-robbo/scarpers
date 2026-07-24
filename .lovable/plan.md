# Post-Benchmark Coach Interview

Replace the current 2-question BenchmarkPostQuestionsDialog with a branching post-benchmark interview: multi-select answers, follow-ups triggered by what we detect from the run itself, and an AI coach verdict stored on the benchmark row.

Verify every answer option in this spec against the existing CHECK constraints on benchmark_results before writing any code. Report any mismatch rather than working around it.

---

## THE QUESTION TREE

Two questions are single-choice (marked). All others are multi-select.

**Q1. How hard did this feel?** (single)

Easy | Moderate | Hard | Very Hard | Maximal

Use "Maximal", not "All-out". The rpe_response CHECK constraint allows exactly: Easy, Moderate, Hard, Very Hard, Maximal. Any other wording fails on insert.

**Q2. What held you back?** — only if Q1 is Easy or Moderate

Legs | Breathing | Motivation | Misjudged the pace | Cut it short | Old injury

**Q3. Could you have kept that pace going?** (single)

Easily | Another 15 minutes | Another 10 minutes | Another 5 minutes | No

These five values are CHECK-constrained. Use them verbatim.

**Q4. Want to redo it?** — only if Q3 is Easily

Yes, reschedule | No, use this result

If "Yes, reschedule", ask the athlete for the date. Do not hardcode a default of seven days.

**Q5. Your second half was slower — what happened?** — only if detection flags a slowdown

Went out too hard | Hills or terrain | Ran out of legs | Deliberate, felt strong early | Something interrupted me | Old injury

If the answer is "Deliberate, felt strong early" or "Hills or terrain", do not apply the SECOND_HALF_SLOWDOWN confidence deduction. The fade has an explanation that is not pacing failure.

**Q6. We spotted breaks during your effort — what were they?** — only if detection flags pauses

Traffic or crossings | Planned walk breaks | Needed to recover | Old injury | Something else

**Q7. Roughly how long were you stopped in total?** — only if Q6 includes Traffic or crossings

Under 30 seconds | 30 seconds to 1 minute | 1 to 2 minutes | Over 2 minutes

If "Over 2 minutes", record that the threshold pace is affected by stoppage and surface that in history. Do not switch the calculation to moving time — elapsed time remains the basis, as already specified.

**Q8. Anything unusual about the conditions?** — only if an HR stream is present

Nothing notable | Windy | Hot | Cold | Treadmill

This question exists to contextualise heart rate, not pace. Do not ask it when there is no HR stream.

**Q9. How do you record heart rate?** — asked once ever, then stored

Chest strap | Watch wrist sensor | Armband | I don't

Store on profiles as hr_sensor_type. Ask only when unset. Make it editable in settings.

### Question cap

Show at most five questions in one sitting, including follow-ups. If more qualify, drop Q8 first, then Q6 and Q7.

Every question is skippable. A skipped question stores null and applies no confidence deduction. Show questions one at a time, not as a single long form. Include a back button and progress indication.

### likely_submaximal

Unchanged: true if Q1 is Easy or Moderate, OR Q3 is Easily. Computed once and used for both the stored flag and the RPE_SUBMAXIMAL deduction, so they can never disagree.

---

## DETECTION

Pull whatever is available for the confirmed activity, in this order, stopping at the first signal:

1. Laps from activity_laps — split by elapsed time into first and second half, compare average pace.

2. Moving versus elapsed time on the activity row — a gap indicates stoppage.

3. GPS/pace stream — only fetched when both cheaper signals are silent. Sliding-window pace drift and long low-speed gaps.

If none yield a signal, Q5, Q6 and Q7 are not shown. Manual-entry benchmarks skip detection entirely and see only Q1 to Q4, Q8 if HR exists, and Q9.

### ONE SLOWDOWN THRESHOLD

Detection and the confidence deduction must use the same constant from BenchmarkConfig. Set it to 10%, matching the existing SECOND_HALF_SLOWDOWN deduction.

Do not use 4% for detection and 10% for scoring — that asks the athlete what went wrong with a 6% fade and then applies no deduction. If you believe 4% is the better detection threshold, say so and let me decide, but there must be exactly one number.

Stoppage detection threshold also goes in BenchmarkConfig. State the value you use.

---

## STORAGE

Anything that drives scoring, plan logic or history filtering gets its own column with a CHECK constraint. Do not put these in a jsonb blob — client-side shape enforcement is not enforcement, and these values need to be queryable.

Existing columns, keep as they are:

- rpe_response

- could_continue_response

- likely_submaximal

New columns, all nullable, all CHECK-constrained to the option lists above:

- held_back_reasons text[]

- slowdown_reason text

- breaks_reasons text[]

- stoppage_duration_band text

- conditions text[]

- injury_flagged boolean, default false

- redo_requested boolean, default false

On profiles:

- hr_sensor_type text, CHECK constrained, nullable

New jsonb column post_benchmark_interview holds only the coach verdict text and any future questions that do not affect scoring. It is not the storage location for the answers above.

benchmark_results has zero rows, so there is no backwards compatibility to preserve. Do not build compat shims.

---

## INJURY FLAG

If "Old injury" is selected on Q2, Q5 or Q6, set injury_flagged true on the row. Show it in benchmark history. After saving, prompt the athlete once asking whether they want to record more detail about it.

Do not let this answer be absorbed silently into the coach verdict. It is the one response that should surface on its own.

---

## CONFIDENCE DEDUCTIONS

Add to BenchmarkConfig, alongside the existing deductions:

- HR_SENSOR_WRIST: -10, applied when hr_sensor_type is "Watch wrist sensor" AND a threshold HR was calculated. Wrist optical heart rate is unreliable at threshold intensity, and threshold HR is the primary output of this test. No deduction for chest strap or armband.

Existing deductions are unchanged. Do not re-tune any of them.

The SECOND_HALF_SLOWDOWN deduction is suppressed when Q5 answers "Deliberate, felt strong early" or "Hills or terrain", per above.

---

## REDO ACTION

When Q4 is "Yes, reschedule":

- Ask the athlete for the new date. Do not hardcode an offset.

- Set the just-saved row to status 'discarded' and active false, with a note recording that the athlete requested a redo.

- Do NOT use status 'rejected'. That value means "this activity was not my benchmark" and is consumed by candidate detection. Add 'discarded' to the status CHECK constraint: scheduled | pending | confirmed | rejected | discarded.

- Insert a new benchmark_results row with status 'scheduled', the chosen date, the same protocol, training_plan_id null.

- Do NOT rewrite plan markdown or place any token. Benchmarks are standalone rows; the token machinery is being removed.

- Skip the pace recalculation and zone comparison dialogs — there is nothing to apply from a discarded result.

- Toast confirming the new date and advising easy running until then.

---

## COACH VERDICT

After save, call a new edge function benchmark-coach-verdict with the answers, likely_submaximal, the confidence deductions that applied, and the detection results.

Persona: an elite running coach with decades of experience training both Olympians and everyday runners. Direct, warm, no filler.

Output: 120 words maximum, three to five bullets, Markdown. Store in post_benchmark_interview. Render in BenchmarkHistory as an expandable "Coach's take" per row.

### The verdict does NOT feed plan generation

Do not inject the generated verdict into the ai-coach prompt. Passing one model's prose into another model's context loses the specifics and cannot be validated.

Instead, extend the benchmark context block in ai-coach to include the structured answers and detection flags directly: rpe_response, could_continue_response, held_back_reasons, slowdown_reason, breaks_reasons, conditions, injury_flagged, and the confidence band. The planner reasons from data, not from a summary of data.

### Model identifier

Confirm the model string resolves before shipping. Report the exact identifier you use and that a test call succeeded. If it fails, the interview must still save normally — the verdict is optional and its failure must never block or roll back the benchmark result.

---

## FILES

New:

- src/lib/benchmark-detection-signals.ts — pure detection functions for slowdown, breaks, and the gated stream fetch

- src/lib/benchmark-interview.ts — question tree, branching resolver, types

- src/components/BenchmarkInterviewDialog.tsx — multi-step dialog, replaces BenchmarkPostQuestionsDialog

- supabase/functions/benchmark-coach-verdict/index.ts

- src/lib/benchmark-redo.ts — discard and reschedule

Edited:

- src/components/BenchmarkConfirmCard.tsx — run detection before opening the dialog, route the redo path, gate pace and zone dialogs behind "not redone"

- src/lib/benchmark-persist.ts — persist the structured columns and the verdict

- src/components/BenchmarkHistory.tsx — render answers, injury flag, and Coach's take

- supabase/functions/ai-coach/index.ts — include structured answers in the benchmark context block

Delete BenchmarkPostQuestionsDialog once nothing references it.

---

## OUT OF SCOPE

- Do not modify apply-measured-zones.ts. It remains the sole writer to hr_zones.

- Do not modify the effort window identification logic, the Riegel calculation, or the zone band model.

- Do not re-tune any existing confidence deduction values.

- Do not add free-text fields anywhere in the interview.

- Do not touch Running IQ, nutrition, sleep, readiness, or walk/run filtering.

---

## VERIFICATION

Report actual values, not descriptions.

1. Every option in the tree validates against the live CHECK constraints. List any that did not and what you changed.

2. Synthetic result with a 12% second-half slowdown, detected breaks, HR present, and no stored sensor type: report exactly which questions fired, in order, and confirm the five-question cap held.

3. Same result with Q1 "Maximal" and Q3 "No": confirm likely_submaximal is false and no RPE_SUBMAXIMAL deduction applied.

4. Same result with Q1 "Easy": confirm likely_submaximal is true, the deduction applied, and Q2 fired.

5. Q5 answered "Hills or terrain": confirm the SECOND_HALF_SLOWDOWN deduction was suppressed. Show the score with and without.

6. hr_sensor_type "Watch wrist sensor" with a threshold HR present: confirm the -10 deduction applied. Show the score.

7. "Old injury" selected on Q2: confirm injury_flagged is true, it renders in history, and the follow-up prompt appeared.

8. Q4 "Yes, reschedule": confirm the original row is 'discarded' not 'rejected', a new 'scheduled' row exists on the date I chose, no plan markdown was modified, and the pace and zone dialogs were skipped.

9. Q9 asked only once — confirm it does not reappear on a second benchmark.

10. A failed verdict call still saves the interview and the benchmark result intact.

11. Confirm the same slowdown constant drives both detection and scoring, and state its value.