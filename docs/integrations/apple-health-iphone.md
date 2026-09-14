# Apple Health on iPhone (via Health Auto Export)

iPhone users can sync sleep stages, resting heart rate, HRV, steps, active
calories and workouts into Scarpers automatically — no Apple Developer account,
no extra server. Anything your watch or phone writes into Apple Health (Garmin,
Apple Watch, Whoop, Oura, Fitbit) comes through.

## One-time setup

1. Install **Health Auto Export — JSON/CSV** from the App Store and allow it to
   read Apple Health. The automation feature is a one-off in-app purchase.
2. In Scarpers: **Settings → Integrations → Apple Health (iPhone)** → tap
   **Create key** and copy it. The key is only shown once.
3. In Health Auto Export: **Automations → Add automation → REST API**.
4. Paste the web address shown on the Scarpers card, set the format to **JSON**.
5. Add a header named `Authorization` with the value `Bearer YOUR-KEY`.
6. Select the data types: **Sleep Analysis, Resting Heart Rate, Heart Rate
   Variability, Step Count, Active Energy**.
7. Set the automation to run automatically (hourly, or each morning) and save.
8. Add a second automation for **Workouts**. In the Workout Configuration, turn
   on **Include Route Data** so run/walk maps draw the GPS trace. Both
   automations use the same endpoint and key.

The Scarpers card shows when data last arrived and what was received.

## What syncs

- Sleep stages (Deep, REM, Core/Light, Awake) — used by the Sleep Score.
- Total sleep duration.
- Resting heart rate and HRV — used by Readiness.
- Steps and active calories.
- Runs, walks, hikes, rides and swims — including the GPS route if you enable
  **Include Route Data**.

A night's sleep is filed against the morning you woke up. Re-sending the same
night overwrites the previous values rather than duplicating them.

## Notes

- Lost your key? Create a new one on the card and update the header in Health
  Auto Export. The old key stops working immediately.
- The screenshot upload on the Wellness tab remains available as a manual
  fallback.
