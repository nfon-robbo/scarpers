**Goal**

Teach the AI Analysis report (the type === "analysis" branch in ai-coach) to recommend strides and structured speed work when appropriate, and to suppress them when recovery is poor.

**Scope**

- One file: supabase/functions/ai-coach/index.ts, system prompt at lines ~1399–1440 only.
- No client/UI changes. No data model changes. No new edge function.
- Other prompt branches (chat, day-adjust, plan-review, plan-generate, etc.) untouched.

**Changes**

1. Add a new "Speed Development" subsection inside Execution Analysis

After the existing Execution Analysis paragraph, add guidance instructing the model to:

- Detect pace plateau (multiple recent runs at similar pace, no improvement) and flag it.
- Detect "established aerobic base" (≥3 weeks consistent easy running, 7-day avg readiness ≥60) and flag readiness for speed work.
- Detect low cadence / form-efficiency concerns and tie them to strides.

2. Extend Actionable Recommendations rules

Append a "Speed Development Guidance" block to the system prompt with these rules the model must follow when emitting bullets under the Sport-Specific group:

- Strides recipe — 4–6 × 20s at ~90% effort, 30s standing/walking recovery, appended to an easy run, up to 2× per week (e.g. Tue/Thu). Benefits: form, leg power, running economy, fast-mechanics retention.
- Structured intervals recipe — 1× per week max, only after ≥3 weeks of consistent easy base AND stable readiness ≥60. Options: 6×3min at 5K effort, 2min easy jog OR 5×1K at 5K–10K effort, 2min easy jog. Replace an easy run, do not add volume. **Pace target calculation:**
  - First choice: Use predicted 5K pace from race predictor (if available in recent analysis)
  - Second choice: Current tempo pace - 30-45s/km
  - Fallback: Easy pace - 90s/km
  - Always express as a range (±15s/km) for safety
  - Example output: "Target 6:15-6:45/km for 3min intervals (based on your tempo pace of 7:00/km)"
- Progression rule — always recommend strides first; only graduate to structured intervals once strides have been tolerated for 2+ weeks.

3. Gating rules (suppression)

Add a hard "DO NOT recommend speed work when" block:

- 7-day avg readiness < 50
- recent sleep score < 60 (last 3 nights avg)
- HRV 7d trend declining
- yesterday's load high AND today's planned effort already elevated
- injury signals present in athlete context

When suppressed, the model must instead say: "Stick with easy running until readiness improves — defer strides/intervals."

4. Output formatting

- New bullets land under existing ## 💡 Actionable Recommendations → Sport-Specific group.
- Respect existing brevity rule (3–5 bullets total across all categories). Speed recs replace, not extend, the cap.
- Keep the strict no-mobility/no-yoga rule that already governs workout output (these recs are coaching prose, not plan rows, so unaffected).

**Out of scope (explicitly NOT in this change)**

- Plan generation prompt (plan-generate) — not editing the actual training plan markdown.
- Auto-adapt rules (plan-auto-adapt) — upward adaptation already adds strides; not touching.
- Chatbot prompt — not editing.
- No new memory file; constraints live in the prompt itself.

**Verification**

After deploy, request an AI Analysis from Dashboard for the active test user and confirm:

1. Strides recommended when pace is flat in last 3+ easy runs.
2. Structured 6×3min / 5×1K suggested only when readiness 7d avg ≥60 and base ≥3 weeks consistent.
3. Speed work suppressed (with the "stick with easy" line) when readiness <50 or sleep <60.
4. Pace targets in the bullet reference the user's actual tempo/race predictor pace from the data block, calculated as: race pace (first choice) OR tempo - 30-45s/km (second choice) OR easy - 90s/km (fallback).