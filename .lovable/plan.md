## Problem

When you click **"✨ Apply suggested workout"** in the AI chatbot, the button doesn't apply your exact spec. It calls the `day-adjust` Edge Function a *second* time with the chat recommendation as a "COACH RECOMMENDATION TO APPLY" block. That prompt's "🚨 SURGICAL EDIT MODE" rules tell the LLM to *preserve* the original session type and "make the SMALLEST POSSIBLE change" — so when you asked to *replace* a VO2 max session, the model kept the VO2 max intervals and only nudged the title. Result: 6×2′ VO2 repeats survived; your race-pace block was discarded.

Re-rolling through the LLM at apply-time is the wrong architecture. The chatbot has already produced a structured workout in its reply. The Apply button should treat that reply as the source of truth and splice it in deterministically.

## Fix

Replace the "Apply suggested workout" handler so it parses the chatbot's most recent assistant message into a workout block and writes it straight into the plan — no second AI call.

### Files

1. **`src/lib/chat-recommendation-parser.ts`** (new)
   - `parseChatRecommendation(text, dateUk)` → `{ title, totalMin, segments: EditedSegment[], musicBpm? } | null`
   - Handles the two shapes the chatbot emits today:
     - **Numbered list** (`1. Warm-up • 5 min walk, 10 min easy jog • Z1-Z2 • 🎵 150-155 BPM; …`)
     - **Bullet/dash list** under a bold title
   - Recognises `intervals.icu`-style explicit specs ("Warm Up Walk — 05:00 — No pace", "Race Pace Block — 20:00 — 6:00 Pace (min/km)").
   - Normalises each row into the 5-column segment shape (`segment / duration / target / hrZone / notes`).
   - Drops any mobility/stretching/yoga rows (existing constraint).
   - Computes `totalMin` from the sum of segment durations when not explicit.

2. **`src/lib/plan-day-actions.ts`**
   - Add `applyChatRecommendationDirect(planContent, dateUk, parsed)` that:
     - Locates the day's raw block via the existing date-line regex used in other helpers.
     - Builds a fresh markdown block: bold date line + `**{title} (Total: {N}min)**` + 5-column segment table + optional `🎵 {bpm}` line.
     - Splices it into `planContent`, runs the existing `enforceAndLog` validator, returns the new content + `{ beforeTitle, afterTitle }`.

3. **`src/components/AIChatbot.tsx`** — change the Apply suggested workout path:
   - Pull the last assistant message text the user is responding to (already on the message that owns the action row).
   - Call `parseChatRecommendation(recommendationText, scope.dateUk)`.
   - On success: call `applyChatRecommendationDirect`, write to `training_plans.content`, push undo, call existing `logPlanEdit({ action: "edit", template: null, summary: "Applied chat recommendation: {title}", details: { source: "chatbot_suggestion_direct", … } })`, toast `"Workout replaced with {title}"`.
   - On parse failure (rare — recommendation isn't a structured workout): fall back to today's AI path **with a stronger directive** prepended to the COACH RECOMMENDATION block: `"REPLACE the entire session with the workout described below — ignore the surgical-edit 'preserve session type' rule, this is an explicit user-confirmed full replacement."` This stops the surgical-edit guard from clobbering an explicit replace.

4. **`supabase/functions/ai-coach/index.ts`** (small guard, only for the fallback)
   - In the day-adjust SURGICAL EDIT MODE section, add: *"EXCEPTION: if the recommendation block starts with `FULL REPLACEMENT:` then output the new session verbatim — do NOT preserve the original session type, title, or segments."*
   - This only fires in the fallback path; the happy path no longer touches the LLM.

### Why this fixes it

- The chatbot already produced exactly the workout you wanted. The bug was an unnecessary LLM round-trip that re-interpreted it through "surgical edit" rules.
- Skipping that round-trip means what you see in chat is bit-for-bit what lands in the plan.
- The fallback only runs when parsing genuinely fails, and it carries an explicit override so the AI can't ignore a full replacement request.

### Out of scope

- No changes to plan generation, intervals.icu sync, or any other Apply path (Skip / Move / Recovery Walk / Edit dialog).
- No new DB tables — reuses `plan_edit_log`.
- No UI changes besides what the button does on click.
