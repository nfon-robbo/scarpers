## Phase 3 — Wire advanced sleep metrics into AI Analysis

Enrich the `ai-coach` Edge Function so the AI Analysis (and every other analysis-type prompt that shares this context) sees the Phase 1+2 sleep columns: `spo2_avg`, `spo2_lowest`, `respiration_avg`, `breathing_pattern`, `skin_temp_deviation`, `restless_count`, `hrv_7d_trend`, `body_battery_change`.

### Scope
Single file: `supabase/functions/ai-coach/index.ts`. No DB changes, no client changes. Backward compatible — when columns are NULL, output is unchanged.

### Changes

**1. Extend `metricsSummary` (around L460)**
The query already does `select("*")`, so no query change is needed. Add the new fields to the mapped summary so they land in `metricsContext` JSON:

```ts
const metricsSummary = metrics.map((m) => ({
  date: m.date,
  resting_hr: m.resting_heart_rate ? Math.round(m.resting_heart_rate) : null,
  hrv: m.hrv ? Math.round(m.hrv) : null,
  sleep_hours: m.sleep_duration_seconds ? (m.sleep_duration_seconds / 3600).toFixed(1) : null,
  stress: m.stress_score,
  steps: m.steps,
  weight: m.weight,
  // NEW — advanced sleep metrics (omit nulls so prompt stays compact)
  spo2_avg: m.spo2_avg ?? null,
  spo2_lowest: m.spo2_lowest ?? null,
  respiration_avg: m.respiration_avg ?? null,
  breathing_pattern: m.breathing_pattern ?? null,
  skin_temp_deviation: m.skin_temp_deviation ?? null,
  restless_count: m.restless_count ?? null,
  hrv_7d_trend: m.hrv_7d_trend ?? null,
  body_battery_change: m.body_battery_change ?? null,
}));
```

**2. Add a compact "Advanced Sleep Health" block to `metricsContext`**
After the existing `metricsContext = ...JSON...` line, append a small human-readable section that filters to nights with at least one advanced field. Keeps the model focused on signal, not nulls.

```
Advanced Sleep Health (nights with respiratory/restlessness data):
2026-05-25: SpO₂ 97% (low 94%), breathing balanced, 15 brpm, 28 restless, skin +0.3°C, HRV trend balanced, battery +42
2026-05-24: SpO₂ 91% (low 86%), breathing many, 35 restless, skin +1.8°C, HRV trend unbalanced
```

**3. Extend the analysis system prompt (`## 😴 Sleep & Recovery`, ~L1381)**
Append guidance so the model uses the new fields. Append (do not replace) these bullets:

- When advanced sleep metrics are present, also analyse:
  - **Respiratory health**: SpO₂ avg, lowest SpO₂, respiration rate, breathing pattern. Flag SpO₂ avg <92% or lowest <88% with "⚠️ Low blood oxygen — consider sleep apnea screening". Flag breathing pattern "Many" as disruption.
  - **Restlessness**: >80 events = "High fragmentation — recovery compromised"; <40 with balanced breathing and SpO₂ ≥95 = "Excellent respiratory recovery".
  - **Skin temperature**: |deviation| >1.5°C suggests illness/stress; correlate with readiness drops and poor next-day sessions ("early illness warning").
  - **HRV 7d trend**: "unbalanced" combined with high restlessness = declining recovery trajectory; recommend prioritising rest.
  - **Body battery change**: persistent negative deltas indicate chronic drain.
- Cross-reference these markers with performance: e.g. skin temp spike on the day before a poor session = illness onset explanation.
- Feed concrete findings into `## 💡 Actionable Recommendations` (medical screening for persistent low SpO₂, delay hard sessions while skin temp elevated, etc.).

**4. Deploy & smoke-test**
- Deploy `ai-coach` via the edge-function deploy tool.
- Curl `/ai-coach` with `{ "type": "analysis" }` as the logged-in preview user; confirm the streamed Markdown's Sleep & Recovery section references SpO₂ / breathing / skin temp for the 25/05/2026 night and that no errors appear for nights where advanced columns are NULL.
- Check `ai-coach` logs for runtime errors.

### Out of scope (separate follow-ups already on the plan)
- `HealthAlerts.tsx` UI component.
- Sleep mini-stats strip in `SleepCalendar` popup.
- `docs/algorithms/sleep-score.md` and `readiness.md` updates.
- Same enrichment for `android-coach` / `readiness-advice` prompts (can mirror this pattern later if desired).
