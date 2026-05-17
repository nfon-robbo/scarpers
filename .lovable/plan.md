# Make Apply / Easier / Harder rewrites future-only

## Goal

When the user clicks **Apply Suggestions / Make Easier / Make Harder** after a progress review, the regenerated plan must keep every workout dated **before today** exactly as it was. The AI only rewrites workouts from **today onward**.

The progress-review text itself is unchanged — it still analyses planned vs actual across the whole plan.

## How the plan markdown is structured

Day blocks look like:

```
### **Friday 15/05/2026** — Easy run (Total: 30min)
| Segment | Duration | Target | Notes |
| ... table rows ... |
```

Date is parseable as DD/MM/YYYY from the heading. There is also a preamble (Season Strategy Overview, week summaries) before the first day heading.

## Implementation

### 1. New util `src/lib/plan-split.ts`

```ts
splitPlanByDate(markdown, todayISO): {
  preservedPast: string;   // preamble + every day block whose date < today
  futureToAdjust: string;  // day blocks whose date >= today
  splitWorked: boolean;    // false if no datable headings found
}
```

- Tokenise the markdown into a preamble + an ordered list of day blocks (a block starts at a `### **…DD/MM/YYYY**…` line and runs until the next such line or EOF).
- Parse each block's date; bucket past vs today/future.
- Reassemble. If no date headings parse, return `splitWorked: false` and the caller falls back to current behaviour.

Unit test: `src/lib/plan-split.test.ts` covering all-past, all-future, mixed, preamble preserved, no-date fallback.

### 2. `applyAdjustment` in `src/pages/TrainingPlan.tsx`

Before calling `streamAICoach`:

```ts
const todayISO = toLocalISODate(new Date());
const { preservedPast, futureToAdjust, splitWorked } =
  splitPlanByDate(originalPlanBeforeReview, todayISO);
```

Then:

- If `splitWorked`, send `currentPlan: futureToAdjust` and a new flag `preservePast: true` (plus `planStartFromDate: todayISO`) to the edge function. While streaming, display `preservedPast + "\n\n" + accumulated` as `content` so the user always sees their full plan with past sessions intact.
- On `onDone`, save `preservedPast + "\n\n" + accumulated` (not just `accumulated`).
- If `!splitWorked`, fall back to current behaviour (send whole plan, replace whole plan).

### 3. `streamAICoach` payload (`src/lib/ai-stream.ts`)

Add optional fields to the request body: `preservePast?: boolean`, `planStartFromDate?: string`. No other changes.

### 4. Edge function `supabase/functions/ai-coach/index.ts`

In the `isPlanAdjust` branch, destructure the new fields and, when `preserve_past === true`:

- Change the wording from "COMPLETE REVISED training plan for the remaining weeks" to:

  > Generate ONLY the workouts from **{planStartFromDate UK-formatted} onward**. Do NOT output any workouts dated before {planStartFromDate}. Do NOT output the Season Strategy Overview again — it will be preserved from the original plan. Start your response directly with the first weekly heading for the week containing {planStartFromDate}.

- The user prompt's "ORIGINAL TRAINING PLAN" section becomes the **future-only** slice (`current_plan` already is when `preserve_past` is set), labelled "REMAINING TRAINING PLAN (today onward)".
- Keep all other format rules (UK dates, tables, BPM, etc).

When `preserve_past` is falsy, the existing prompt and behaviour stay exactly as today.

### 5. Undo / save

`savePlan(...)` already takes `prevContent: originalPlanBeforeReview` for the undo entry — keep passing the full original plan so undo restores everything correctly. Only the new saved content changes (preserved past + AI future).

## Out of scope (intentionally)

- `plan-review` prompt — unchanged. It still summarises planned vs actual across the whole plan; the user explicitly wants only the rewrite to be future-only.
- Auto-adapt (`plan-auto-adapt`) — unchanged.
- Day-ahead surgical edits — already future-only by nature.

## Acceptance check

1. Build a plan with today = a Wednesday in week 3.
2. Click Review Progress → Make Easier.
3. After regeneration: every day-heading with date < today is byte-identical to the original; everything from today onward reflects an easier load.
4. Undo restores the full original plan.
