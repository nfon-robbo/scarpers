## Editable sleep on Insights

Make the **Sleep — Google Fit & Health Connect** panel editable so you can add or override any night manually.

### What I need from you per night
- Date (DD/MM/YYYY)
- Deep, REM, Light, Awake — each as `HH:MM`

Total is derived from Deep + REM + Light. Nothing else required.

### UX changes to `src/components/insights/SleepSourcesPanel.tsx`
- **Add night** button in the card header → opens a dialog with: date picker + 4 HH:MM inputs.
- Each existing row gets a small **Edit** icon. Manual rows also get a **Delete** icon. Editing a Google Fit row just creates a `manual` override for that date (Google Fit row stays visible alongside).
- Dialog validates: date required, at least one of Deep/REM/Light > 0.
- A third source label "Manual" is shown when the row came from manual entry.

### Where the data lands
1. **`sleep_stages`** — delete any existing `source='manual'` rows for that user+date, then insert up to four rows (`deep`, `rem`, `light`, `awake`) with `source='manual'` and `duration_seconds` from the HH:MM inputs. The panel already reads from this table; I'll widen its source filter to include `'manual'`.
2. **`daily_metrics`** — upsert the same date with `sleep_duration_seconds`, `deep_sleep_minutes`, `rem_sleep_minutes`, `light_sleep_minutes`, `awake_during_night_minutes`. This is the table Readiness scoring and the 365-day wellness calendar read from, so manual nights feed those too.

### Not changing
- No schema changes — both tables already have every column needed.
- No edge function — pure client writes, RLS already restricts to `auth.uid() = user_id`.
- Google Fit / Health Connect sync, readiness logic, calendar rendering all untouched.

### Risk
- If Google Fit later syncs the same date, both rows will appear side-by-side in the panel (one "Google Fit", one "Manual"). The wellness calendar / Readiness will use whichever value was written last to `daily_metrics` — usually that's fine, but worth knowing.
