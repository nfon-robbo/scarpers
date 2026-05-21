## Add workout dates to extraction debug list

In `src/components/RaceTimeEstimate.tsx`, surface the workout date next to each entry in the "Debug" extraction list so it's clear which session each row refers to.

### Changes
- Extend `extractionDebug` state to carry a `date: Date` on every `successes[]` and `failures[]` entry (already available from the `recent` candidate loop).
- Populate `date: c.date` when pushing into `successes`/`failures` (including the `catch` fallback).
- In the breakdown render (around line 472), prepend each row with the formatted date, e.g. `21/05 — ✓ Walk/Run Intervals…`, using UK formatting (`dd/MM`) via `date-fns`.

No business logic, weighting, or extraction thresholds change — purely a labelling addition to the debug UI.