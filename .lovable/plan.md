## Short answer

No — the "Assess Day Ahead" path does **not** currently look at how long it's been since your last run. The layoff/return-to-running logic only runs in the **plan generation** branch of `ai-coach` (around line 1975), not in the day-adjust branch that powers Assess Day Ahead. So a recommendation made after a ~month off would have treated you as if you were fully training.

## Fix plan

Add a "days since last run" signal to the Day Ahead prompt and a hard rule that forces an easier, ramp-back recommendation when the layoff is meaningful.

### 1. Compute layoff in the day-adjust branch
In `supabase/functions/ai-coach/index.ts`, inside the day-adjust path (before the system prompt is assembled, near the existing `todayActivityContext` / metrics blocks ~line 820–900):

- Query the most recent run from `activities` (single row, `order start_time desc limit 1`, filter to running types).
- Compute `daysSinceLastRun` (default to a large number if none).
- Compute `runsLast14d` count for context.

### 2. Inject a `LAYOFF CONTEXT` block into the prompt
Always include the numbers so the LLM can see them:

```text
LAYOFF CONTEXT:
- Days since last run: {n}
- Runs in last 14 days: {m}
```

### 3. Add a mandatory ramp-back rule (tiered)
Add to the day-adjust rules block (next to the existing TRAINING-LOAD VELOCITY rule):

- **7–13 days off** → mention the gap in the Coach's Note; if today's planned session is hard (tempo/intervals/threshold/VO2/hill/long), Decision MUST be ADJUSTED to an easy Z2 run of similar-or-shorter duration.
- **14–27 days off** → Decision MUST be ADJUSTED. Replace with an easy Z2 run capped at ~30–40 min, conversational pace only. No quality work.
- **28+ days off (your case)** → Decision MUST be ADJUSTED. Replace with a **walk/run interval** session (e.g. 5 × 2 min run / 1 min walk, Z1–Z2 only, ~20–25 min total). Coach's Note must say verbatim: `⚠️ You haven't run in {n} days — easing back in with walk/run intervals to protect tendons and rebuild aerobic base before resuming structured training.`

These mirror the thresholds already used by plan generation (`isReturning` when `daysSinceLastRun > 56`) but are tighter for day-to-day adjustment, which is the safer default after any extended break.

### 4. No UI changes required
The output still flows through the existing Day Ahead markdown renderer; only the decision content changes.

### 5. Verification
- Update `supabase/functions/ai-coach/day-adjust.test.ts` with cases for 0, 10, 20, and 30 days off to lock in the rule.
- Re-run `bunx vitest run supabase/functions/ai-coach/day-adjust.test.ts`.
- Deploy the function.

### Out of scope
- Recomputing or retroactively changing the recommendation you already received today.
- Touching plan generation, readiness scoring, or auto-adaptation — they already handle layoffs.
