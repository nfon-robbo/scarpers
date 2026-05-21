## Day Ahead Assessment — 8 Improvements

All work lives in **`supabase/functions/ai-coach/index.ts`** (the `day-adjust` branch around lines 457–650 + system prompt at 562–605) and a small client-side parser tweak in **`src/pages/TrainingPlan.tsx`** (lines 1318 and 1384).

### 1. Median baselines (HRV + RHR)
Replace the mean reducer at lines 517–518 with a `median()` helper applied to `hrvValues` and `rhrValues`. Relabel the trend block: `BASELINES (last 14d median)` instead of `avg`. More robust to 2–3 outlier nights.

### 2. Explicit "hard" / "long" workout thresholds
In the day-adjust branch, when fetching yesterday's activities also compute a `yesterdayLoad` object:

- **Hard** = `(duration_seconds > 3600 && avg_heart_rate >= 0.85 * estimatedMaxHr)` OR `training_load > 150` OR `≥20 min in Z4/Z5` (derived from raw_data HR samples if present, else skipped).
- **Long** = `duration_seconds > 5400`.

Inject `YESTERDAY LOAD: hard=true|false, long=true|false, reason=...` into the prompt context, and update the system prompt's corroborating-signal bullet to reference these explicit flags instead of "hard/long".

### 3. Refined poor-night definition
Change `POOR(n)` predicate (around line 522) from `score < 60 || duration < 6h` to:

```
POOR = (score < 60 && durationHours < 7) || score < 50
```

Update the SLEEP TREND label string and the system-prompt rule (line 582) to match.

### 4. New SOFT ADJUSTED decision tier
Add a third decision class between KEEP AS-IS and ADJUSTED.

System-prompt rules (replacing the current gating block):

- **ADJUSTED** — consecutive poor ≥ 2 + corroborating signal (existing rules + #6 below).
- **SOFT ADJUSTED** — exactly 1 poor night AND (HRV 10–15% below median OR RHR +2 bpm above median). Keep workout structure, but either reduce target pace by 10–15 s/km OR add an extended 5 min warm-up with a "scale back if it doesn't ease" note. Output line: `✅ Decision: SOFT ADJUSTED — one suboptimal night with slightly elevated fatigue markers`.
- **KEEP AS-IS** — everything else.

Client-side (`TrainingPlan.tsx`):
- Line 1318/1384: expand regex to `/Decision:\s*(ADJUSTED|SOFT ADJUSTED)/i` so the surgical plan replacement and "modified" badge fire for both adjustment tiers.

### 5. Rotating cadence cues
Define a `CADENCE_CUES` array (5–6 entries: metronome playlist, "hot coals", shorter stride 10%, quick light feet, "land under your hips", "count 3-2-1 footfalls per second") in the edge function. When `avgCadence < 160`, pick one via `Math.floor(Math.random() * CADENCE_CUES.length)` and inject as `CADENCE CUE FOR TODAY: "<cue>"` into the prompt with an instruction that the Coach's Note must use that exact cue.

### 6. Training-load velocity check
Add to the system-prompt gating: if `YESTERDAY LOAD.hard === true` AND today's planned workout type matches `/tempo|interval|threshold|race pace|vo2/i` AND last night was poor (even with only mild HRV/RHR deviation), force **ADJUSTED** and swap the hard session for an easy Z2 run. Decision reason text: "Two consecutive hard sessions on suboptimal recovery risks overtraining."

Today's-workout type detection: parse the `today_workout` markdown for those keywords in JS and pass `TODAY PLANNED INTENSITY: hard|easy|rest` into the prompt.

### 7. Chronic poor-sleep escalation
Use the existing `consecutivePoor` counter to inject one of these into the prompt as `ESCALATION:` (and require the Coach's Note to include the line verbatim):

- 3 nights → "Third poor night in a row — identify what's disrupting your sleep (stress, caffeine, screen time)."
- 5 nights → "⚠️ Sleep has been poor for 5+ nights. Prioritise rest and recovery — training is secondary right now. Consider consulting a doctor if this continues."
- 7+ nights → System prompt MUST output Decision: ADJUSTED with the recommended workout replaced by a Rest Day table, plus "⚠️ MANDATORY REST — seven consecutive poor nights indicates you need medical attention, not training." Implemented as a hard rule in the prompt + a deterministic check in the edge function that prepends the rest-day block to the streamed output if the model deviates is **out of scope** (prompt-only enforcement is sufficient).

### 8. Rest-day clarity prepend
When the client walks forward from today (rest day or completed) to the next workout, send a new flag `target_is_not_today: true` plus `today_date_uk` to the edge function. In the system prompt, when this flag is set, require the response to begin with:

```
🛌 Today ({today_date_uk}) is a scheduled rest day.
Assessing tomorrow's workout ({target_date_uk})...
```

Client change in `TrainingPlan.tsx` (around the day-adjust streamAICoach call near line 1280–1320): pass the new fields. Add the matching optional fields to `streamAICoach` in `src/lib/ai-stream.ts`.

---

### Technical notes

- All changes are additive; existing KEEP AS-IS / ADJUSTED behaviour is preserved.
- No DB migrations, no new tables, no new secrets.
- The SOFT ADJUSTED tier needs both the prompt change AND the client regex update to render correctly — they ship together.
- Median helper is ~5 lines, pure JS.
- Cadence cue randomisation happens server-side per request, so the user sees variety naturally.

### Files touched

- `supabase/functions/ai-coach/index.ts` (day-adjust branch + system prompt)
- `src/pages/TrainingPlan.tsx` (regex + new payload fields)
- `src/lib/ai-stream.ts` (two new optional fields on the `day-adjust` payload)

### Out of scope

- Refactoring the system prompt structure beyond the gating block.
- Persisting cadence-cue history (random rotation is good enough for now).
- Adding a new decision type to any DB column — SOFT ADJUSTED lives only in the response text.
