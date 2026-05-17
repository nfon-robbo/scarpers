# Fix: "Review Progress" wipes the workouts

## What's actually happening

`reviewProgress()` in `src/pages/TrainingPlan.tsx` does:

1. `setContent("")` — clears the plan markdown.
2. Streams the AI review (prose with headings like "📊 Progress Summary", "✅ What Went Well"…) into `content` via `onDelta`.
3. Renders Apply / Easier / Harder / **Keep current plan** buttons.

Because the calendar, day list and PlanOverview all parse workouts out of `content`, when `content` is review prose instead of a workout table the UI correctly shows **zero workouts**. Nothing is deleted in the database — `originalPlanBeforeReview` is held in state, and "Keep current plan" restores it. But it looks alarming and you lose the ability to see the plan while reading the review.

## Fix

Keep the plan visible. Stream the review into a **separate panel / dialog** instead of into `content`.

### Changes in `src/pages/TrainingPlan.tsx`

1. **Remove the destructive writes in `reviewProgress`:**
   - Delete `setContent("")` and `setLoading(true)`.
   - Stop streaming review text into `setContent`. Stream into a new `reviewStreaming` state instead.
   - Keep `originalPlanBeforeReview` only as a snapshot for the adjust step (no UI restore needed since we never touched `content`).

2. **New UI: Review panel / dialog**
   - Add a `Sheet` (or `Dialog`) that opens automatically when `reviewing || reviewResult` is truthy.
   - Body: live-streamed markdown review (re-use `MarkdownRenderer`).
   - Footer actions when streaming finishes:
     - **Apply suggestions** → `applyAdjustment("apply")`
     - **Make it easier** → `applyAdjustment("easier")`
     - **Make it harder** → `applyAdjustment("harder")`
     - **Close** → just dismiss the panel (replaces "Keep current plan"; nothing to restore).
   - While streaming, show a spinner and disable the action buttons.

3. **`applyAdjustment` stays mostly the same** but:
   - It still snapshots `originalPlanBeforeReview` (already in state from step 1) and passes it as `currentPlan` to the `plan-adjust` stream.
   - It now needs to clear the plan view during regeneration because it is rewriting the plan — that's the legitimate case for `setContent("")` + `setLoading(true)`.
   - On done: save via `savePlan(..., { inPlace: true, undoLabel: "plan adjustment", prevContent: originalPlanBeforeReview })` (unchanged) and close the review panel.

4. **`keepCurrentPlan`** can be deleted — there's nothing to restore because we never overwrote `content`.

5. **Button label**: keep "Review Progress" wording on the trigger button; just make sure the spinner state ties to `reviewing` only (not `loading`).

## Technical details

- State to add: `const [reviewStreaming, setReviewStreaming] = useState("");` plus reuse existing `reviewResult`, `reviewing`, `originalPlanBeforeReview`.
- Sheet open condition: `open={reviewing || !!reviewResult}` with `onOpenChange` clearing `reviewResult`, `reviewStreaming`, `originalPlanBeforeReview` when closed.
- No edge-function changes — the `plan-review` and `plan-adjust` prompts in `supabase/functions/ai-coach/index.ts` stay as-is.
- No database changes.

## Result

Clicking **Review Progress** opens a side panel that streams the coach's review while the plan stays fully visible behind it. The user can then choose Apply / Easier / Harder to actually rewrite the plan, or close the panel to dismiss the review with no change.
