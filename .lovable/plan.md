## Goal

Stop the chatbot from recalculating session duration by summing segment times and from inventing pace figures. It must quote the exact values written in the plan markdown for the specific session being discussed.

## Change

Single edit to `supabase/functions/ai-coach/index.ts`, in the `type === "chat"` branch system prompt (around line 568, alongside the existing `PLAN LOOKUP` block).

Add a new mandatory rules block: **`SESSION VALUE FIDELITY (MANDATORY)`** with these rules:

1. **Duration**: use the duration stated in the session heading or session-total line of the plan markdown verbatim. Never recompute duration by summing the time/distance of segments in the table — that always produces a different number to the stated total.
2. **Pace targets**: use only the pace values printed in that session's own segment table. If a segment has no pace column, describe effort from the HR zone, RPE, or notes column instead. Never invent or estimate a pace figure that isn't written in that session's table.
3. **No contradictions**: never state a duration, pace, distance, or HR zone for a session that disagrees with what is written in the plan markdown for that exact date. If the plan and the user's question conflict, quote the plan and flag the discrepancy.
4. **When values are missing**: if the plan markdown does not contain a duration or pace for the session, say "the plan doesn't specify a [duration/pace] for this session" rather than guessing.

Block is inserted after the existing `PLAN LOOKUP` block and before `RECOMMENDATION ACTIONS` so it is read before the model composes its answer.

## Out of scope

- No changes to plan generation, plan adjustment, or any write-back path.
- No changes to client code, parsers, or schemas.
- No new context fields — the plan markdown is already injected; this only constrains how the model uses it.

## Verification

Redeploy the function and ask the chatbot about a session whose stated total (e.g. 60 min) differs from the sum of its segments (e.g. 55 min). Confirm the reply uses 60 min. Ask about a session whose table has no pace column and confirm the reply describes effort by HR zone / notes rather than quoting a pace.

## Files

- `supabase/functions/ai-coach/index.ts` — append `SESSION VALUE FIDELITY` block in the chat-branch system prompt.
