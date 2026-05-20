## Race Time Predictor — Chatbot Feature

Adds an instant race-time estimate to the AI chatbot, using data Scarpers already has. No new UI — predictions appear inline in chat replies whenever the user asks "what time can I run…", "am I on track for sub-X", etc.

### What the user gets

When the chatbot detects a race-time question (regex + intent keywords like *predict, estimate, sub-, finish, target time, what time, how fast*), the reply leads with a three-tier prediction block:

```
🎯 Target: 29:30–30:30 (6:00/km)
💪 Stretch: 28:30–29:30 (if you nail race-pace block on 24/06)
✅ Conservative: 30:30–31:30

Based on: easy pace 7:15/km · VO2max 42 · week 4 of 8 · 82% adherence
Confidence: MEDIUM — need more race-pace data
Key validation: 20-min race-pace block on 24/06/2026
```

Edge cases:
- **<3 completed workouts in last 21 days** → "I need 2–3 completed sessions to give a reliable estimate. Your plan targets [goal] — let's see how the first sessions feel."
- **Last readiness <50 or active injury flag in athlete_context** → append "⚠️ Assumes healthy race-day execution; recent readiness/injury signals could move this."

### Prediction logic (server-side, in ai-coach edge function)

A new helper `generateRaceTimePrediction(ctx)` runs before the chat system prompt is built and injects a `RACE_TIME_PREDICTION` block the model is instructed to use verbatim if the user asked a prediction question.

Inputs pulled from already-loaded context (no new tables):
1. **Easy pace** — median pace of last 10 runs flagged easy (HR avg ≤ Z2 cap or pace > tempo threshold) from `activities`.
2. **Tempo / race-pace pace** — fastest sustained 10–20 min block from last 14 days of `activities` (computed from existing pace data; falls back to fastest avg_speed run ≥15 min).
3. **VO2 max** — latest non-null `daily_metrics.vo2_max`.
4. **Plan progression** — `(today − training_plans.start_date) / total weeks`, plus `race_distance` and `goal_time`.
5. **Adherence** — completed non-rest sessions / scheduled-to-date (reuses `computePlanStats` logic, ported to Deno or duplicated minimally).
6. **Readiness trend** — mean of last 7 `readiness_snapshots.score`.

Calculation (in order of preference, first available wins as the *primary* estimate; others become sanity bounds):

- **VO2max → race time** via Daniels/Cameron table:
  - 5K: t_min = 29.54 + 5.000663·D − 0.007546·D² where D = race distance km; pace scaled by VO2max factor `v = 29.54 + 5.000663·D − 0.007546·D²` adjusted by VO2max. For 5K: 35→37:00, 42→29:30, 50→23:30 (linear interp between anchor points).
  - 10K, half, full: apply Riegel `T2 = T1 · (D2/D1)^1.06` from the 5K estimate.
- **Easy pace → race pace**: subtract 60–90 s/km (60s for 5K, 75s for 10K, 90s for half/full). Convert to time over race distance.
- **Tempo pace → race pace**: subtract 10–20 s/km (5K), 5–10 s/km (10K), +0–5 s/km (half), +15–25 s/km (full).

Blend the available estimates (weighted: tempo 0.5, VO2max 0.3, easy 0.2). Apply:
- **Progression factor**: + min(weeks_completed × 0.0125, 0.08) improvement (≈5% per 4 weeks, capped at 8%).
- **Adherence penalty**: if adherence < 70%, multiply predicted time by 1 + (0.7 − adherence) × 0.33 (so 60% → +3.3%, 40% → +10%).
- **Readiness modifier**: mean readiness <55 → +2%; >80 → −1%.

Output three tiers from the blended `T`:
- Conservative: `T × 1.04`
- Target: `T`
- Stretch: `T × 0.97`

Pace shown = target_time / race_distance_km, rendered in user's distance unit.

### Confidence levels

- **HIGH**: ≥1 tempo or race-pace interval session (segment table has interval/tempo/threshold keywords + matching activity in last 14 days) AND ≥6 completed runs in last 21 days.
- **MEDIUM**: ≥4 completed easy runs in last 21 days, no intensity session, OR VO2max present.
- **LOW**: <4 completed runs in last 21 days, or plan started <3 weeks ago.

Key validation date = next planned session in `training_plans.content` whose title matches `/tempo|race pace|threshold|interval|time trial/i`.

### Caching

New table `race_time_predictions` (user_id, race_distance, prediction jsonb, computed_at). On chat request, reuse cached row if:
- `computed_at` within 7 days, AND
- no `activities.created_at` > `computed_at` for this user.

Otherwise recompute and upsert. Cache invalidation is implicit through the activity-timestamp check — no triggers needed.

### Files to change

- `supabase/functions/ai-coach/index.ts` — new helper `generateRaceTimePrediction`; detect prediction-intent in `chatMessages` (regex on a short keyword set); inject `RACE_TIME_PREDICTION` block into the chat system prompt with strict instructions ("if user asked about race time, lead the reply with this block verbatim, then add one short coaching sentence").
- `supabase/migrations/<ts>_race_time_predictions.sql` — new table + RLS (`auth.uid() = user_id` for all four CRUD policies).
- `mem://features/race-time-predictor` + index entry.

### Out of scope

- No new chat UI component, no new page, no chart.
- No new external data source (Garmin connect already feeds `daily_metrics.vo2_max`).
- Prediction only triggers in `type === "chat"`; not surfaced in plan generation or workout review.
