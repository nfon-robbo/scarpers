## Problem

Plan generation for `type === "training-plan"` stops at 5 June even though `training_plans.race_date` is months later. The prompt already includes the race date and a "MANDATORY WORKOUT DATES" list, but the model still truncates — the root cause is the **output token cap of the default model** (`google/gemini-3-flash-preview` via Lovable AI Gateway, ~8k–16k output tokens). A multi-month plan with full markdown tables for every session blows past that ceiling, so the stream ends mid-plan.

The current `maxTokens: 64000` request is ignored by the gateway model's hard cap, and there is no continuation/retry — if the model stops short, the truncated plan is what the user gets.

## Fix

### 1. `supabase/functions/ai-coach/index.ts` — plan generation call

- For `type === "training-plan"` only, route the call to a higher-capacity model with a larger output window: `lovableModel: "google/gemini-2.5-pro"` (Gemini Pro supports up to ~64k output tokens through the gateway; Flash preview does not). Leave all other `type`s on the existing default.
- Keep `maxTokens: 64000`.
- Strengthen the race-day instruction at the top of `planLengthInstruction` (lines ~1014–1020). Add a single, explicit sentence in the exact format the user asked for, using already-computed values:

  ```
  RACE DAY {raceDayName} {raceDateUKLong}, goal {raceLabel} in {goal_time} at {racePace}/km
  ```

  (`raceDateUKLong` = e.g. "3 July 2026"; reuse existing `raceDayName`, `raceLabel`, `goal_time`, `racePace`.) Restate it in both the system prompt prelude and immediately before the required-dates block so the model cannot miss it.
- Remove any wording that suggests the plan can stop at a week boundary — the existing "do NOT round down to a clean week boundary" stays; no per-week or per-session count caps exist today, so nothing to remove there.

### 2. Server-side continuation loop (the real fix for truncation)

Even with a bigger model, very long plans (24+ weeks) can still bump the ceiling. Add a continuation pass so the user always gets a plan that reaches race day.

In `index.ts`, for `type === "training-plan"` only:

- Switch this branch from pass-through streaming to **buffered streaming**:
  1. Call `callAI({ stream: true, … })` and read the SSE deltas into a string `fullText` while simultaneously re-emitting each delta to the client (so the user still sees live typing).
  2. After the upstream `[DONE]`, parse `fullText` for the **last `YYYY-MM-DD` date** that appears in a markdown heading or row.
  3. If that last date is **earlier than `race_date`**, issue a follow-up `callAI` (non-streaming or streaming, same model, `maxTokens: 64000`) with a continuation prompt:

     > "The plan above stopped at {lastDate}. Continue the plan from {lastDate + 1 day} through {race_date} ({raceDayName}, {raceDateUKLong}) inclusive, using the exact same markdown format, the same training-day schedule ({daysStr}), and the same pace/HR anchors. Output ONLY the new days — do not repeat earlier weeks. The final entry MUST be the race itself: '🏁 RACE DAY — {raceLabel}' on {race_date}."

     Pass the original plan back as assistant context plus the original `systemPrompt` so periodisation continuity is preserved.
  4. Append the continuation tokens to the client stream as additional SSE `data:` frames, then send `data: [DONE]`.
  5. Loop up to **3 continuation passes** as a safety net; abort the loop early once the last detected date ≥ `race_date`.

- Keep all other `type`s on the existing zero-buffer pass-through path so chat/day-adjust/etc. latency is unaffected.

### 3. Validation

- Manually trigger a plan regeneration on the live `/training-plan` page for the active plan (race date after 5 June).
- Tail `supabase--edge_function_logs` for `ai-coach` and confirm:
  - `label: ai-coach:training-plan` resolves to `google/gemini-2.5-pro`.
  - Continuation log lines fire only when the first pass truncates.
- Confirm the persisted `training_plans.content` ends with a row dated `race_date` and labelled `🏁 RACE DAY — {distance}`.

## Files touched

- `supabase/functions/ai-coach/index.ts` — model override + strengthened race-day line + buffered-stream continuation loop for `training-plan`.

## Out of scope

- No client changes (`src/lib/ai-stream.ts`, `TrainingPlan.tsx`) — the SSE contract is unchanged.
- No schema changes.
- No changes to other `type`s (chat, day-adjust, workout-review, plan-review, plan-adjust, post-plan-analysis, analysis).
