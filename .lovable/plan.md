## What's actually happening

**Body Battery is NOT synced from Garmin or Intervals.icu.** It's a Scarpers-only metric computed locally in `src/lib/body-battery.ts` from:
- Last night's sleep (hours, deep %, REM %, HRV vs baseline) → starting charge on wake
- Hours since wake × accelerating passive drain rate (3 → 6 pts/hr)
- Today's activities × intensity load → activity drain
- Constant ambient drain (0.5/hr)

There is no `body_battery` column in `daily_metrics`. `intervals-wellness` syncs sleep, HRV, RHR, steps, weight — never Body Battery. So "Garmin sync" can't be the cause.

### Why it looks "stuck at 31%"

I confirmed in the DB that `readiness_snapshots` IS still updating — your user has 15+ snapshots between 17:00 and 19:12 UTC today, score bouncing 28–35. The number is moving, just very slowly because:

1. At hour-awake > 12, passive drain is only ~5/hr; add 0.5 ambient.
2. The value is clamped to a floor of 5 in the 48h chart and 0 in the live calc — once you're low and not exercising, the curve visually flattens.
3. The 48h dialog only emits one point per whole hour (`t % 3600_000 === 0`), so the "now" tail appears as a flat horizontal segment until the next hour bucket lands.
4. The tooltip "At 15:00 → 31% → −5 drained this hour" is the value at the hovered hour, not the live value. The legend "Now: 31%" is the truth value from `computeBodyBattery()` and matches.

So nothing is broken in the data pipeline. What's wrong is the **UX makes a slowly-moving, model-driven value look frozen**, and the messaging implies it's a live Garmin reading.

## Plan

### 1. Make the live value visibly tick
`src/components/BodyBattery48hDialog.tsx`
- After the hourly loop, append an extra `HourPoint` at "now" using `truthResult.percent` (currently the truth value is only stamped onto the last whole-hour bucket, which is why the line appears to end at xx:00 and flatline).
- Add the actual current clock label (e.g. `19:42`) as that final point so the tooltip and right edge of the chart match "Now: X%".

### 2. Show last-computed timestamp + recompute control
`src/components/BodyBattery48hDialog.tsx` (header area, near "WHAT'S HAPPENING")
- Add a small "Updated HH:mm" line driven by `Date.now()` at compute time.
- Add a "Recompute" icon button that re-runs the effect (currently only runs on `open` / `readinessData` change). Useful when the user has been on the page for hours.

### 3. Auto-refresh on a timer while dialog is open
`src/components/BodyBattery48hDialog.tsx`
- Add a `setInterval` (5 min) while `open` is true to re-run the compute effect, so leaving the dialog open shows the value drifting downward instead of frozen.

### 4. Clarify the metric source
`src/components/BodyBattery48hDialog.tsx` (subtitle, and `ReadinessWidget` battery card tooltip)
- Reword the subtitle from the current hourly-phase description to something like:
  > Modelled from your sleep, time awake and today's activity. Not a live Garmin reading — refreshes hourly from your data.
- Prevents the exact confusion in this ticket (user expects a live watch metric).

### 5. Floor + colour at very low values
`src/lib/body-battery.ts` (and dialog floor)
- Current floor in the dialog is 5%, live model floors at 0. Align both to 5 so the chart never visually "bottoms out below the line".
- In the dialog, when the latest bucket is < 25 for > 2 consecutive hours and no activity has happened, show a "Reserve mode — drain has slowed" badge so the flat tail is explained.

### Out of scope
- Pulling a real Garmin Body Battery via Intervals.icu (Intervals' wellness API does not expose it; would require Garmin Connect IQ / Health API, which the project explicitly avoids — see core memory "No direct Garmin API").
- Changing the underlying readiness algorithm.

### Technical notes
- The hourly cron `readiness-hourly-snapshot` is healthy (rows landing every hour for both users) — no edge-function fix needed.
- `daily_metrics` has no Body Battery column and shouldn't — keep it derived.
- `BodyBattery48hDialog` already calls `computeBodyBattery()` as the single source of truth (line 282); we're just surfacing that value more honestly.