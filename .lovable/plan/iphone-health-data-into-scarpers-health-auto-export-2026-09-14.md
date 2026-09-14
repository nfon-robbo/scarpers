# iPhone health data into Scarpers (Health Auto Export)

## The idea

Health Auto Export is an iPhone app that reads Apple Health and can automatically
send the data to any web address on a schedule. The linked project is just a
sample server that receives that data. We don't need to host it — Scarpers can
receive the data itself, which means no extra server, no extra cost, and the
data lands straight in the app.

This finally gives iPhone users the same automatic sleep and health sync that
Android users get today.

## How it works for the user

1. They buy/install Health Auto Export on their iPhone (one-off App Store purchase
   for the automation feature — this is the only cost, and it's theirs, not ours).
2. In Scarpers: Settings → Integrations → a new "Apple Health (iPhone)" card shows
   a personal web address and a personal key, with a copy button and short steps.
3. In Health Auto Export they create a REST API automation, paste the address and
   key, pick the data types listed on the card, and set it to run automatically
   (e.g. hourly or each morning).
4. Sleep, resting heart rate, HRV, steps and calories then appear on the Wellness
   tab and feed the Sleep Score, Readiness and Running IQ exactly like Android data.

The existing screenshot upload stays as a manual fallback.

## What gets imported

- Sleep stages: Deep, REM, Light (Core), Awake, In Bed — stored as sleep segments
  with source `apple_health`.
- Resting heart rate, heart rate variability, steps, active energy — stored as the
  day's metrics.
- Repeat sends for the same night overwrite rather than duplicate.

Sleep source precedence becomes: manual, then Apple Health / Health Connect
(whichever the user actually uses), then Google Fit, then legacy Garmin export.

## Technical notes

- New table `apple_health_tokens` (user_id, token hash, created_at, last_seen_at,
  revoked_at) with row-level security limiting each user to their own row, plus
  the required grants. Token is generated in the app, shown once, stored hashed;
  service role reads it for verification.
- New edge function `apple-health-ingest` (`verify_jwt = false`, own bearer-token
  auth against the hashed token, CORS headers, Zod validation of the payload,
  payload size cap, plain 401/400 responses).
- Parser maps Health Auto Export's `data.metrics[]` shape (each metric has `name`,
  `units`, `data[]` with `date`, `qty`, and for sleep `sleepStart`/`sleepEnd` plus
  per-stage hours) into `sleep_stages` rows and `daily_metrics` upserts, keyed on
  (user_id, date) and (user_id, date, stage, start_time).
- Dates are converted to the user's local day using the offset in the payload, so
  a night's sleep lands on the correct UK date.
- `src/lib/sleep-source-precedence.ts` gains `apple_health` at the Health Connect
  tier; `SleepSourcesPanel` and the Wellness tab gain an "iPhone sync" label.
- New `AppleHealthCard.tsx` in Settings → Integrations: generate/regenerate token,
  copy endpoint, show last received time and last payload summary so the user can
  confirm it's working.
- Docs: `docs/integrations/apple-health-iphone.md`, and the Garmin/Android doc's
  "iPhone users" section updated to point at this instead of "roadmap".

## Out of scope for this change

- Importing workouts/runs from Apple Health (Strava/FIT still cover runs).
- Any Apple Developer account, HealthKit app, or App Store submission by us.
