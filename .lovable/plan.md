
## Goal
Three AI coaching surfaces ignore the plan's pause window and keep recommending workouts. Make each of them pause-aware so the AI matches the UI contract.

There is no separate `day-adjust` edge function — Day-Ahead is handled inside `supabase/functions/ai-coach/index.ts` under `type === "day-adjust"`. Readiness coaching is the same file under `type === "analysis"`. The third surface is `supabase/functions/plan-auto-adapt/index.ts`.

## Changes

### 1. `supabase/functions/plan-auto-adapt/index.ts`
- Extend the `training_plans` select around line 274 to also pull `paused_at`, `paused_until`, `pause_reason`.
- Right after the existing "already adapted today" and "taper" guards, add a pause guard:
  ```ts
  if (plan.paused_at && plan.paused_until) {
    const now = Date.now();
    const start = new Date(plan.paused_at).getTime();
    const end = new Date(plan.paused_until).getTime();
    if (now >= start && now < end) {
      return new Response(JSON.stringify({ ok: false, reason: "plan_paused" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
  }
  ```
- No toast / UI changes — the caller already treats `ok: false` as a silent no-op.

### 2. `supabase/functions/ai-coach/index.ts` — Day-Ahead (`type === "day-adjust"`)
- At the top of the `if (type === "day-adjust")` block (around line 627), fetch the active plan's pause fields and short-circuit if the target date sits inside the window. Stream a fixed Markdown block back over SSE (matching the existing `SCHEDULED_WORKOUT_COMPLETED` short-circuit pattern just below, so the client renders it without an LLM call):
  ```ts
  const { data: pausePlan } = await supabase
    .from("training_plans")
    .select("paused_at, paused_until, pause_reason")
    .eq("user_id", user.id)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pausePlan?.paused_at && pausePlan?.paused_until) {
    const t = new Date(targetDateStr).getTime();
    const s = new Date(pausePlan.paused_at).setHours(0,0,0,0);
    const e = new Date(pausePlan.paused_until).setHours(0,0,0,0);
    if (t >= s && t < e) {
      // return SSE stream with a fixed markdown body — see fixed-stream helper below
    }
  }
  ```
- Body of the fixed response (Bebas-style headings already used elsewhere in this branch):
  > ## 🛌 Plan paused
  >
  > Your plan is paused until **{paused_until DD/MM/YYYY}**. No scheduled workout for {target date}.
  >
  > Rest, or do an easy activity of your choice — walk, gentle spin, mobility. We'll pick the plan back up automatically when the pause ends.

### 3. `supabase/functions/ai-coach/index.ts` — Readiness (`type === "analysis"`)
- At the start of the `else if (type === "analysis")` branch (line ~1402), do the same pause lookup. If today is inside the pause window, replace the prompt-building / LLM call with a fixed Markdown body and stream it back:
  > ## 🛌 Plan paused
  >
  > Plan paused until **{paused_until DD/MM/YYYY}**.
  >
  > - Prioritise sleep and easy mobility
  > - Stay hydrated, eat normally
  > - Light walks or a gentle spin are fine if you feel like it
  >
  > Readiness scoring continues in the background. We'll resume coaching when the plan resumes.

### Shared helper
Add one small helper near the top of `ai-coach/index.ts` to write a fixed SSE response in the same shape the client already parses (mirroring the existing `SCHEDULED_WORKOUT_COMPLETED` block around line 714):

```ts
function streamFixedMarkdown(md: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: md })}\n\n`));
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}
```
(If the existing short-circuit uses a slightly different SSE shape, reuse that exact shape verbatim instead — I'll match it when implementing so the client parses correctly.)

## Out of scope
- No client/UI changes.
- No DB migrations.
- No changes to readiness snapshot generation, auto-sync, or Intervals.icu sync.
- Workout-review, plan-review, training-plan generation are unaffected — pause shouldn't block reviewing past work or generating a new plan.

## Verification
- Manually call each edge function with a paused plan in DB and confirm:
  - `plan-auto-adapt` returns `{ ok: false, reason: "plan_paused" }`.
  - `ai-coach` Day-Ahead streams the fixed "Plan paused" markdown.
  - `ai-coach` readiness analysis streams the fixed recovery markdown.
- With pause cleared, all three behave exactly as before.
