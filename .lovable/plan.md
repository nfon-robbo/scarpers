## Goal

Android users with Garmin watches get fully automatic sleep import (Deep/REM/Light/Awake + duration) via Health Connect, with a universal screenshot fallback for everyone else. iPhone bridge deferred.

The good news from exploring the code: `syncHealthConnect` in `src/lib/health-connect.ts` already reads `SleepSession` and writes both `sleep_stages` rows and `daily_metrics` totals — the plumbing is done. What's missing is UI/UX surfacing and docs.

## Changes

### 1. HealthConnectCard — surface sleep correctly
`src/components/HealthConnectCard.tsx`

- Update the card copy: remove "sleep stages coming soon" — they're already pulled.
- Change the description to: "Sync sleep stages, resting HR, steps and active calories from Garmin Connect (via Health Connect)."
- Use the `sleepCount` already returned by `syncHealthConnect` in the success toast: `"X days updated · Y sleep segments"`.
- Add a short helper line under the buttons: "Tip: open Garmin Connect → Settings → Health Connect → enable Sleep to share Garmin sleep data." (link icon, no external link needed.)

### 2. Wellness tab — one-tap screenshot uploader
`src/components/insights/SleepSourcesPanel.tsx` (+ usage stays in `WellnessTab.tsx`)

The screenshot → AI parse flow already exists, but it's buried inside the "Edit night" dialog. Promote it:

- Add a primary "Upload sleep screenshot" button in the panel header next to the existing "Add manually" button.
- Clicking it opens the same hidden `<input type=file>` already wired to `parse-garmin-sleep`, then opens the edit dialog pre-filled with today's date and the parsed vitals.
- Copy: "Works with Garmin, Whoop, Oura, Fitbit screenshots — we'll auto-fill stages + vitals."

No edge function changes, no schema changes.

### 3. Setup documentation
New file: `docs/integrations/garmin-android-sleep.md`

Three short sections:
- **One-time setup** — Install Health Connect from Play Store → open Garmin Connect → Menu → Settings → Health Connect → toggle on Sleep (+ Heart Rate, Steps, Active Calories) → in Scarpers tap "Grant access" then "Sync now".
- **What syncs automatically** — sleep stages, duration, resting HR, steps, active calories. Pulls last 7 days each run; nightly auto-sync handles daily refresh.
- **iPhone users / Garmin without Android** — use the "Upload sleep screenshot" button on Wellness as a fallback (Phase 2 native iPhone bridge deferred).

Also add a one-line pointer from `README.md` to this doc under existing integration notes.

## Out of scope (Phase 2)

- Apple Health → Scarpers bridge (Health Auto Export webhook + edge function). Revisit only when iPhone users request it.
- Changes to `parse-garmin-sleep` edge function, `google-fit-sleep`, or any DB schema.

## Technical notes

- `READ_TYPES` in `src/lib/health-connect.ts` already includes `SleepSession`; stage mapping (`HC_STAGE_MAP`), per-night `sleep_stages` writes scoped to `source: 'health_connect'`, and `daily_metrics` rollup are all implemented. No edits to that file are needed unless QA reveals a gap.
- The screenshot upload reuses the existing `supabase.functions.invoke("parse-garmin-sleep", { body: { imageDataUrl } })` call and the existing `applyVitalsToForm` → dialog flow.
- Sleep score will recompute automatically via the existing `daily_metrics` write path (same shape `google-fit-sleep` uses).
