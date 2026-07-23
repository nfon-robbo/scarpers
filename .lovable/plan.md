Group 3, corrected. Do step 0 first and report before writing any migration.

---

STEP 0 — READ THE LIVE SCHEMA BEFORE PROPOSING ANY COLUMN

Your plan proposes adding benchmark_results.protocol and benchmark_results.confidence_deductions, and asks whether protocol is stored. Both were in the Step 4 corrective migration you reported as shipped: benchmark_protocol NOT NULL CHECK (30min|3k_tt|5k_tt), and confidence_deductions jsonb. Your Step 5 test output also showed scoreConfidence already returning deductions.

You also use three column names that contradict earlier reports: protocol vs benchmark_protocol, training_plans.plan_text vs plan_markdown, effort_window_distance_m vs effort_distance_m.

Query information_schema.columns for public.benchmark_results, [public.hr](http://public.hr)_zones, [public.training](http://public.training)_plans and public.profiles. Report the actual column list for each. Then tell me which of your proposed additions are genuinely missing.

Do not add a column that already exists under another name. If benchmark_protocol exists, use it — do not create protocol alongside it.

No backfill is needed anywhere: benchmark_results has zero rows, as you confirmed. Remove the "backfill from effort_window_source" step — effort_window_source is lap|derived|manual and carries no protocol information.

---

1. HISTORY VIEW

Source: benchmark_results WHERE status = 'confirmed'. Pending and rejected rows never appear in history.

Order by benchmark_date DESC, not scheduled_date — scheduled_date is nullable for standalone benchmarks, benchmark_date is not.

Columns: date, benchmark type, distance, duration, threshold HR (em-dash when null), threshold pace, predicted 5K, confidence score and band, Likely Submaximal chip.

When band is Low, expand to show which deductions applied and recommend repeating the benchmark. Read the stored confidence_deductions — do not recompute at render time, or the history stops being append-only the moment a constant changes.

Verify the RLS policy set on benchmark_results includes SELECT for authenticated, scoped to auth.uid().

---

2. [INTERVALS.ICU](http://INTERVALS.ICU) THRESHOLD PACE — REUSE THE EXISTING WRITER

Do NOT create an intervals-push-threshold edge function. supabase/functions/intervals-sync/index.ts already writes threshold_pace to the athlete's Run sport settings — that is where the 3.03 m/s fallback lives. A second function writing the same field is a duplicate writer, and we have already spent this build eliminating one set of those.

Extend the existing path instead: when a confirmed benchmark exists, intervals-sync sends the real threshold_pace in m/s (1000 / threshold_pace_s_per_km). The 3.03 fallback applies only when no confirmed benchmark and no seedable history exist.

Read that function first and tell me what endpoint and payload shape it currently uses before changing it. I am not confident from memory what the correct sport-settings endpoint is, and the working code is the authority, not either of our recollections.

Confirm the value that would be sent for a threshold pace of 4:30/km. I make that 3.70 m/s — check against your implementation.

---

3. PACE RECALCULATION

Two things missing from your plan.

3a. DEFINE THE DERIVATION EXPLICITLY

"Existing seeding math (provisional-pace scaling ratios)" is not a specification. The provisional seeder adds a 60 s cushion to a 5 km race pace, which is a different calculation from deriving session paces from threshold pace.

State the ratio from threshold pace to each session type — easy, long, tempo, race pace — as named constants in BenchmarkConfig. Show me the values before you build, so I can sanity-check them against how the sessions actually feel.

Note these ratios are training conventions, not measured physiology, and I am treating them as tunable rather than correct. That is why they belong in config.

3b. RE-SYNC AFTER APPLYING

The spec requires that after pace targets change, affected future workouts are re-pushed to [intervals.icu](http://intervals.icu) through the existing sync path. Your plan stops at rewriting the markdown. Add the re-sync.

Existing sync rules unchanged: pace targets are a ±15 s/km range, warm-up, cool-down and recovery steps carry no pace target.

3c. PROTECT THE BENCHMARK TOKEN

The recalc rewrites plan markdown. Any [benchmark:30min] token in that markdown must survive the rewrite intact. Confirm this, and add a test.

3d. CONFIRM THE COLUMN NAME

You wrote training_plans.plan_text. Earlier you reported plan_markdown. Use whichever actually exists.

Diff dialog, Apply/Cancel, and plan_edit_log entry with reason 'benchmark_pace_recalc': all approved as described. Independence from the zone dialog in both directions: approved.

---

4. SIX WEEK RE-BENCHMARK PROMPT

Do NOT add profiles.pending_standalone_benchmark jsonb. That would be a third store for a scheduled benchmark, alongside the markdown token and benchmark_results. It also holds only one pending benchmark and is not queryable.

Use benchmark_results instead. A scheduled standalone benchmark is a row with training_plan_id NULL, scheduled_date set, benchmark_protocol set, activity_id NULL, and status 'scheduled'.

That requires adding 'scheduled' to the status CHECK constraint: scheduled | pending | confirmed | rejected. Tell me if that breaks anything currently reading status — I expect not, since there are zero rows.

Detection then treats a scheduled standalone row exactly as it treats a plan-scheduled benchmark, and the partial unique index on (user_id) WHERE active AND status='confirmed' is unaffected.

Everything else in item 4 approved: due banner from next_benchmark_due, links into the plan when one is active, standalone scheduler when not.

---

5. END-TO-END SYNTHETIC TEST

Approved, with specific assertions. Insert a synthetic confirmed row: 30 minute protocol, LTHR 165, threshold pace 4:30/km, distance and duration consistent with that pace.

Assert and report actual values:

- History renders the row with all fields populated and correct.

- Zone comparison shows old versus new. At LTHR 165 the new zones must read Z1 ≤140, Z2 141-148, Z3 149-156, Z4 157-168, Z5 ≥169, matching the canonical resolver.

- Whether the 15 bpm large-change callout fires against my current zones, and the actual delta.

- The list of affected sessions, with dates and names — not a count.

- The pace recalc diff table, with real old and new targets.

- The due-prompt banner in both states: active plan and no active plan.

- A Low-confidence row renders its deductions and the repeat recommendation.

Screenshots to /tmp/browser/group3/. Report the real diffs the tests produced, not descriptions of them.

---

Report step 0 first and stop. Then build