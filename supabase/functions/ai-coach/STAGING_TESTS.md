# Day Ahead Assessment — Manual Staging Checklist

Run these scenarios against the deployed `ai-coach` Edge Function before
shipping changes to the day-adjust gating. The unit suite in
`day-adjust.test.ts` covers the pure logic; this checklist verifies that the
LLM honours the prompt rules end-to-end.

Use the `supabase--curl_edge_functions` tool with `path: "/ai-coach"`,
`method: "POST"`, and the body shown below. Replace `today_workout` with a
recent real plan row when possible.

> ⚠️ LLM output is non-deterministic. Treat each "expected" line as
> required substrings that MUST appear in the streamed response.

---

## 1. Single bad night + HRV −12% → SOFT ADJUSTED

Pre-seed (or pick a user where): last 7 nights = `[55/6h, 75/8h, 75/8h, ...]`,
today's HRV ~12% below 14-day median.

Body:
```json
{ "type": "day-adjust", "target_date": "2026-05-22", "today_workout": "Easy 40min Z2" }
```

Expected in response:
- `Decision: SOFT ADJUSTED`
- "one suboptimal night"
- Workout structure preserved (same title), pace reduced 10–15 s/km OR extra 5 min warm-up.

---

## 2. Two bad nights + HRV −18% → ADJUSTED

Pre-seed: last 7 nights `[55/6h, 50/6.5h, 75/8h, ...]`, HRV ~18% below median.

Expected:
- `Decision: ADJUSTED`
- Reason cites "2 poor nights" + HRV figure.

---

## 3. Load velocity → ADJUSTED (hard → hard on poor sleep)

Pre-seed: yesterday = 65 min run @ 88% max HR (or training_load > 150), today's plan = intervals/tempo, last night score 58 / ~6.5h.

Body:
```json
{ "type": "day-adjust", "target_date": "2026-05-22", "today_workout": "5x800m intervals @ 5k pace" }
```

Expected:
- `Decision: ADJUSTED`
- "Two consecutive hard sessions on suboptimal recovery"
- Recommended workout replaced with easy Z2 run.

---

## 4. Five consecutive poor nights → 5+ warning

Pre-seed: 5 nights all `score ≤ 55, duration < 7h`.

Expected in Coach's Note (verbatim):
> ⚠️ Sleep has been poor for 5+ nights. Prioritise rest and recovery — training is secondary right now. Consider consulting a doctor if this continues.

---

## 5. Seven consecutive poor nights → mandatory rest

Pre-seed: 7 nights all poor.

Expected:
- `Decision: ADJUSTED`
- Recommended Workout is a **Rest Day** table.
- Coach's Note contains verbatim: `⚠️ MANDATORY REST — seven consecutive poor nights indicates you need medical attention, not training.`

---

## 6. Today rest day, assessing tomorrow → prepend

Body:
```json
{
  "type": "day-adjust",
  "target_date": "2026-05-22",
  "today_workout": "5km easy",
  "today_date_uk": "Thursday 21 May 2026",
  "target_is_not_today": true
}
```

Expected response begins with:
```
🛌 Today (Thursday 21 May 2026) is a scheduled rest day.
Assessing tomorrow's workout (Friday 22 May 2026)...
```
…before the `## 🌙 Sleep & Recovery Assessment` heading.

---

## 7. Cadence average ≈155 spm → rotating cue

Pre-seed: last 20 runs average cadence < 160 spm.

Expected:
- Coach's Note contains ONE of the `CADENCE_CUES` strings verbatim.
- Run the request 3–5 times; verify at least 2 distinct cues appear across runs (confirms randomisation).

---

## How to run quickly

```ts
// pseudo
await supabase.functions.invoke("ai-coach", {
  body: { type: "day-adjust", target_date: "...", today_workout: "...", /* ... */ }
});
```

Tick each scenario off in your PR description before merging.

---

## 8. Today's-activity awareness

### 8a. Completed scheduled workout → short-circuit

Pre-seed: an activity today at 07:00, ~matching the scheduled workout's distance and duration (±20%).

Expected response:
- Begins with `✅ Today's workout already completed`
- Contains a trailer `<!-- DAY_ADJUST_STATUS: WORKOUT_ALREADY_COMPLETED activity_id=... -->`
- No `Decision:` line, no LLM-generated assessment sections.
- Client dialog shows "View activity" + "Got it, let's go!" only.

### 8b. Unplanned 5 km easy at 07:00, scheduled tempo at 17:00

Expected:
- Normal assessment runs.
- Coach's Note contains verbatim: `⚠️ You've already run 5.0km today. If tonight's session feels too hard, skip it — you've already done significant training.`

### 8c. 10 km morning + 8 km lunch, intervals scheduled

Expected:
- `Decision: ADJUSTED`
- Recommended Workout replaced by a Rest Day table.
- Coach's Note contains verbatim: `⚠️ OVERRIDE: You've already trained 18.0km / <minutes>min today. Replacing tonight's workout with Rest Day to prevent overtraining.`

### 8d. No activities today → regression guard

Expected: response identical in shape to baseline (no today-activity context, no extra warning).

---

## 9. Short-workout match floor (improvement #2)

Verifies that the absolute-tolerance floor prevents short warm-ups / shake-outs
from being misidentified as the planned session.

### 9a. Planned 3km, completed 2.0km easy → should NOT short-circuit
Expected: assessment proceeds normally (EXTRA_ACTIVITY or NONE), NOT
`✅ Today's workout already completed`. Reason should contain "exceeds floor".

### 9b. Planned 3km, completed 2.9km → SHOULD short-circuit
Expected: `WORKOUT_ALREADY_COMPLETED` trailer, single fixed message.

### 9c. Planned 90min, completed 78min → SHOULD short-circuit (±13%, floor not applied for long).

## 10. Detected-activity chip (improvement #4)

Trigger: complete an unplanned 5km run, then click Assess Day Ahead.

Expected:
- First SSE chunk contains `<!-- DAY_ADJUST_DETECTED: name="5.0km run (...min)" started="HH:MM" count=1 ... -->`.
- Dialog renders a chip "Detected: 5.0km run (...min) at HH:MM" above the streaming Markdown.
- Marker is stripped from the rendered output.

## 11. 30-minute assessment cache (improvement #1)

Trigger: click Assess Day Ahead, wait for result, close dialog, click again
within 30 min with no new activity synced.

Expected:
- Second click skips the LLM (no `ai-coach:day-adjust` log entry within ~200 ms).
- Dialog opens at phase `done` and shows the cached result + chip instantly.
- After applying an adjustment OR syncing a new activity, the next click
  re-runs the LLM (cache invalidated by Apply / new activity count).

## 12. Assessment lock

Trigger: click Assess Day Ahead twice in quick succession (or trigger
`adjustNextWorkout` while an assessment is mid-stream).

Expected:
- Second invocation shows toast "Assessment already in progress" and does not
  start a parallel LLM stream.
- Lock auto-clears on `onDone`, `onError`, cache hit, or unexpected throw.
