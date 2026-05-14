## Goal

Stop the system silently rewriting the current week when readiness is low. Instead, surface a banner and let the user choose. Also give a one-tap path to revert the 13/05 adaptation that swapped your intervals to easy runs.

## Changes

1. **Dashboard auto-adapt flow (`src/pages/Dashboard.tsx`)**
   - When `evaluateAdaptation()` returns `direction: "down"`, no longer call the edge function automatically. Instead set `adaptEval` so the banner renders (mirrors how `"up"` already behaves).
   - Respect a per-day dismissal so the banner doesn't re-appear all day if you ignore it.

2. **Banner supports both directions (`src/components/PlanAdaptationBanner.tsx`)**
   - Add a `direction: "up" | "down"` prop.
   - **Down copy:** title "Ease this week?", body "Readiness has been low for 2 days. We can drop intensity to ~85% and swap intervals for easy runs this week only." Buttons: **Ease this week** / **Keep as planned** / dismiss X.
   - **Up copy:** unchanged.
   - On accept: call `plan-auto-adapt` with the chosen mode, push undo entry, toast with "View" + "Undo" actions.

3. **Per-day dismissal helpers (`src/lib/plan-adaptation.ts`)**
   - Add `isDownwardDismissedToday(userId)` / `dismissDownwardToday(userId)` mirroring the existing upward helpers.
   - Skip showing the down banner if dismissed today.

4. **Restore the 13/05 adaptation (one-off, surfaced in Training Plan page)**
   - On `/training-plan`, if `last_adapted_at` is within the last 7 days **and** there's a matching entry in `plan-undo-history`, show a small inline strip: *"This week was auto-adjusted on DD/MM/YYYY (recovery). Restore original?"* with a Restore button that swaps `content` back to the previous version (uses existing `pushUndoEntry` / undo history).
   - Strip auto-clears once the user dismisses or restores.

5. **Edge function (`supabase/functions/plan-auto-adapt/index.ts`)**
   - No behavioural change. It still does the surgical edit when invoked. We're just no longer invoking it without consent.

6. **Memory update**
   - Update `mem://features/training-plans/auto-adaptation` to reflect: down adaptation is now **opt-in via banner** (was auto). Up adaptation unchanged.

## Out of scope

- Trigger thresholds (`READINESS_DOWN_THRESHOLD = 55`, 2 consecutive days) stay as-is — only the *application* becomes opt-in.
- The Day-Ahead popup and chatbot rationalisations are unrelated and untouched.

## Notes

- The 13/05 adaptation is already in the database (`last_adaptation_reason: readiness_low_2d`). The Restore strip in step 4 is the recovery path for that specific event; from now on, you'll see the banner first and nothing changes without your tap.
