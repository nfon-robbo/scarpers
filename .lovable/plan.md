## Problem

On `/dashboard`, the workout review dialog auto-opens for today's completed activity. Currently it's suppressed only if:
- A row exists in `workout_reviews` for that activity, OR
- `sessionStorage` flag `workoutReviewShown:<activity_id>` is set.

If the user closes the dialog without submitting a review, the flag is only in `sessionStorage`, so the next browser session (new tab, refresh after session expiry, mobile reopen) re-prompts. The user wants: once an activity has been shown/handled, never auto-prompt again.

## Fix

In `src/pages/Dashboard.tsx` (lines ~636–677):

1. Switch the "already shown" flag from `sessionStorage` to `localStorage` so it persists across sessions/devices-per-browser.
2. Use the same key (`workoutReviewShown:<activity_id>`) in both the initial effect and the `workout-auto-linked` listener.
3. Keep the existing check for an existing `workout_reviews` row (still the strongest signal across devices).

That's it — no other files change. The "Tap for review" entry point in `PlanOverview`/`TrainingPlan` remains so the user can still open the review manually if they want.

## Technical detail

```ts
// before
if (sessionStorage.getItem(shownKey) === "1") return;
sessionStorage.setItem(shownKey, "1");

// after
if (localStorage.getItem(shownKey) === "1") return;
localStorage.setItem(shownKey, "1");
```

Applied in both the auto-open effect and the `workout-auto-linked` handler.
