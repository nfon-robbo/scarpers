## Goal

Make sure that every statistic captured from a FIT file is visible in the Activity detail dialog — both as readable text **and** as charts wherever a time-series exists in `raw_data.gps_track`.

The parser already stores the full FIT `session` object in `activities.raw_data` and per-record samples in `raw_data.gps_track` (heart rate, speed, cadence, power, altitude, temperature, plus any other record fields). Today the dialog shows most session-level numbers and 5 charts (HR, Speed, Elevation, Cadence, Power, HR zones, splits). Several fields that Garmin/FIT files commonly include are either hidden inside the "All Data" tab or never plotted.

## Changes

### 1. `src/components/ActivityDetailDialog.tsx` — new "Running Dynamics" + "Advanced" sections in Overview

Add Stat cards (only render when the value exists in `data.raw_data`) for:

- **Running dynamics**: avg ground contact time (`avg_stance_time`), GCT balance (`avg_stance_time_balance`), vertical oscillation (`avg_vertical_oscillation`), vertical ratio (`avg_vertical_ratio`), avg stride length (`avg_stride_length` or `avg_step_length`), total strides (`total_strides`).
- **Power detail**: normalized power (`normalized_power` / `avg_power`), intensity factor (`intensity_factor`), training stress score (`training_stress_score`), total work (`total_work` in kJ), L/R balance (`left_right_balance`), avg/max torque effectiveness, pedal smoothness (cycling).
- **Temperature**: avg / max / min temperature (compute min/max from `gps_track[].temperature` if not in session).
- **HR detail**: min HR (compute from track if not in session), HR drift (first-half vs second-half avg).
- **Speed detail**: avg moving speed vs avg overall, time moving vs time elapsed (`total_timer_time` vs `total_elapsed_time`).
- **Lap count** (`num_laps`), **device** (`device_info` make/model if present).

All of these read from `data.raw_data.*` and use the existing `Stat` component, so they auto-hide when missing.

### 2. `src/components/ActivityCharts.tsx` — extra charts

Extend the per-point series built in `analysis` to also include `temperature`, `vertical_oscillation`, `stance_time`, `stride_length` (read from each `gps_track` point — `parseFitBuffer` already maps these via the raw record but currently only writes a fixed subset; see step 3).

Then conditionally render one card per series (same pattern as Cadence/Power):

- **Temperature over time** — area chart, °C/°F via `useUnits`.
- **Stride length over time** — line chart (m).
- **Vertical oscillation** — line chart (cm).
- **Ground contact time** — line chart (ms).
- **HR vs Pace scatter** — recharts `ScatterChart` correlating speed and HR per sample (efficiency view).
- **Power zone distribution** — bar chart computed from sample powers when power exists, using FTP from `raw_data.functional_threshold_power` if present, else 75% of max power.
- **Splits chart upgrade** — overlay per-km elevation gain bars alongside the existing time bars.

Each new chart only renders when at least ~10 samples have that field.

### 3. `src/lib/fit-parser.ts` — pass through the extra per-record fields

In the `gpsTrack.push({...})` block, also forward (when present on the FIT record): `temperature`, `vertical_oscillation`, `stance_time`, `stance_time_balance`, `step_length` / `stride_length`, `vertical_ratio`. These are standard fields fit-file-parser exposes; they're currently dropped.

Update the `GpsPoint` interface accordingly. No DB migration needed — `raw_data` is JSONB.

### 4. "All Data" tab polish (existing `raw` tab)

- Group fields (Session / Device / User Profile / Other) by simple key-prefix heuristics.
- Format known unit-bearing keys (anything ending in `_time` → duration, `*_speed` → speed, `*_distance` → distance, `*_temperature` → temperature, `*_heart_rate` → bpm).
- Keep the catch-all rendering so nothing is ever hidden.

## Out of scope

- No backend / schema changes (everything fits in `raw_data` JSONB which is already populated).
- Existing FIT files re-render with whatever is already in `raw_data`; new per-record fields (step 3) only appear after re-uploading. That is acceptable — call this out in the final reply.

## Files touched

- `src/lib/fit-parser.ts` (extend `GpsPoint` + record mapping)
- `src/components/ActivityCharts.tsx` (new chart cards + scatter + power zones)
- `src/components/ActivityDetailDialog.tsx` (new stat sections, grouped raw tab)
