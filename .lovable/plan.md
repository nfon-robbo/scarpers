Fix: AI Gateway Timeout Handling

Problem

When the AI gateway hangs (Gemini overload, edge function 150s timeout), streamAICoach never resolves — the UI spins forever with no way to recover. Just broke during the live demo.

Solution — Two Layers

Layer 1: Library timeout in src/lib/ai-stream.ts

Add a 140-second client-side watchdog inside streamAICoach:

- Start a setTimeout(140_000) immediately when the function is invoked.

- On fire: abort the fetch via AbortController, call onError("AI gateway timed out. This usually resolves quickly — tap Retry."), and mark a settled flag so the normal stream loop becomes a no-op if bytes arrive late.

- Clear the timer in every exit path: successful onDone (both [DONE] and end-of-stream), onError, and the outer catch.

- Use the existing AbortController plumbing — pass signal into fetch; on AbortError, suppress the generic "Stream failed" toast (we already called onError with the timeout message).

- Also detect explicit upstream timeout: if resp.status === 504 or 408, surface the same friendly timeout message instead of Error 504.

No signature changes except one new optional parameter: accept featureName?: string for telemetry (see below). All four call sites continue to work unchanged (featureName defaults to undefined). The 140s value lives as a module constant STREAM_TIMEOUT_MS for easy tuning.

Telemetry for timeout tracking:

When a timeout occurs, log to console:

console.warn('[AI_TIMEOUT]', { feature: featureName || 'unknown', duration: elapsed, timestamp: [Date.now](http://Date.now)() })

This helps identify:

- Which features timeout most often

- Whether 140s is the right threshold

- If timeouts cluster at certain times (Gemini overload patterns)

Console only for now - can ship to PostHog/Sentry later without touching call sites again.

Layer 2: Retry UX per call site

The library guarantees onError always fires. Each surface needs a Retry affordance instead of leaving a dead spinner.

src/pages/TrainingPlan.tsx (Day Ahead + Adjust Next Workout)

- Add dayAdjustError: string | null and lastDayAdjustArgs ref (snapshot of the args passed to streamAICoach).

- In the existing onError handlers for assessDayAhead and adjustNextWorkout: clear dayAdjusting, set dayAdjustError, fire toast.error(err), keep the dialog open.

- In the dialog body, when dayAdjustError is set and not streaming, render a centred error card with the message + a Retry button that re-invokes the same handler using the cached args. Do not auto-close.

- Clear dayAdjustError when a new assessment starts or the dialog closes.

- Pass featureName to streamAICoach: "day-adjust" for assessDayAhead, "adjust-next" for adjustNextWorkout.

src/components/WorkoutReviewDialog.tsx (review + coach)

- Replace the current "Unable to generate…" placeholder text with an inline error block containing the message and a Retry button bound to a retryReview() / retryCoach() helper that re-runs the original streamAICoach call. Track reviewError / coachError state.

- Pass featureName to streamAICoach: "review" for workout review, "coach" for coach's note.

src/components/AIChatbot.tsx

- The two streaming calls already append an error message to the chat. Augment the assistant error bubble with an inline Retry button (small ghost button under the ⚠️ … line) that re-sends the last user prompt. Track lastChatRequest in state for retry.

- Pass featureName to streamAICoach: "chat".

src/components/insights/AnalysisTab.tsx

- Add analysisError state. On onError, stop the spinner, show the error text + Retry button that re-calls the same streamAICoach.

- Pass featureName to streamAICoach: "analysis".

Toast copy

Single source of truth in ai-stream.ts:

"AI gateway timed out. This usually resolves quickly."

Each call site fires toast.error(err) from its existing onError path — no new toast logic in the surfaces.

Out of scope

- No changes to the edge function itself (timeouts there are a separate ticket).

- No cache changes — the existing 30-min Day-Ahead cache already only writes on onDone, so timeouts correctly leave the cache empty for a clean retry.

- No changes to LLM prompts, decision codes, or HRV scoring (Batch 2 remains deferred).

Verification

- Manual: temporarily set STREAM_TIMEOUT_MS = 2000, trigger each surface (Day Ahead, Adjust Next, Workout Review, Coach's Note, AI Chat, Analysis tab) and confirm: spinner stops, toast appears, Retry button shown, Retry re-runs the call. Revert constant.

- Confirm successful completions still call onDone exactly once and the timer is cleared (no late onError after success).

- Check console logs show [AI_TIMEOUT] entries with correct feature names during the 2s timeout test.

- Existing edge-function test suite is unaffected — no server changes.

Files to edit

- src/lib/ai-stream.ts — timeout + AbortController + 504/408 mapping + telemetry logging + optional featureName param

- src/pages/TrainingPlan.tsx — error state + Retry for Day Ahead and Adjust Next Workout + pass featureName

- src/components/WorkoutReviewDialog.tsx — error state + Retry for review and coach + pass featureName

- src/components/AIChatbot.tsx — inline Retry on error bubbles + pass featureName

- src/components/insights/AnalysisTab.tsx — error state + Retry + pass featureName