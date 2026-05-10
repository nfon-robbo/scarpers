## Goal

1. Fully remove Apple Health as a sleep data source.
2. Add a diagnostic showing which integration delivered last night's sleep (and recent nights), so it's clear where the data is coming from.

## Part 1 — Remove Apple Health sleep

### Code
- Delete edge function `supabase/functions/apple-health-sleep/` (and its config in `supabase/config.toml` if present).
- Remove any UI references to Apple Health for sleep:
  - Search for "Apple Health" / "apple-health" across `src/`. Remove setup card / connect block / instructions.
  - Strip Apple Health branch from any source-merge logic in `src/components/SleepCalendar.tsx`, `src/components/insights/WellnessTab.tsx`, readiness/Running IQ helpers (`src/lib/sleep-score.ts`, `src/lib/readiness.ts`, `src/lib/running-iq.ts`).
- Remove the `apple-health-integration` memory file and its index entry.

### Data cleanup
- Delete existing rows in `sleep_stages` where `source = 'apple_health'` (none exist today, but run for safety).

### Documentation
- Update README / settings copy that mention Apple Health.

## Part 2 — Sleep source diagnostic

Add a small "Sleep sources" panel on the Insights → Wellness tab (or as a new collapsible card) showing, for the last 7 nights, which integration produced data:

```text
Date         Intervals  Google Fit  Health Connect  Garmin ZIP
10/05/2026   7.6h / 79   —           —               —
09/05/2026   7.2h / 71   —           —               —
...
```

### Implementation
- New helper that, per date, queries:
  - `daily_metrics` grouped by `source_file` (intervals.icu, garmin export ZIP) → hours + score.
  - `sleep_stages` grouped by `source` (`google_fit`, `health_connect`) → total minutes.
- Render as a compact table with a tick / dash per source.
- Place above existing sleep calendar so the user can immediately see "last night came from Intervals only".

## Open questions

- Confirm: also remove Apple Health entirely from anywhere it appears (not just sleep)? Currently it only appears in the sleep edge function, so this is effectively the same thing — but flag if you want the connector card to remain for any future use.

## Out of scope

- No changes to Google Fit, Health Connect, Garmin ZIP, or Intervals.icu sleep ingestion.
- No change to how sleep is merged for Readiness / Running IQ scoring (still uses sleep_stages first, falls back to daily_metrics).
