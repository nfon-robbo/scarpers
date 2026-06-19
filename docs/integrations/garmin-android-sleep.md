# Garmin sleep on Android (via Health Connect)

Android users with a Garmin watch can sync sleep automatically into Scarpers — including Deep / REM / Light / Awake stages, duration, and resting heart rate. No Garmin API account needed.

## One-time setup

1. Install **Health Connect** from the Google Play Store (pre-installed on Android 14+).
2. Open **Garmin Connect** → tap the menu → **Settings** → **Health Connect**.
3. Toggle on at minimum:
   - **Sleep**
   - **Heart Rate**
   - **Steps**
   - **Active Calories**
4. Open Scarpers → **Insights** → **Wellness** tab.
5. On the **Health Connect (Android)** card, tap **Grant access**, then **Sync now**.

That's it. From now on Garmin writes each night's sleep into Health Connect, and Scarpers pulls it in.

## What syncs automatically

- Sleep stages (Deep, REM, Light, Awake) — used by the Sleep Score.
- Total sleep duration.
- Resting heart rate.
- Steps and active calories.

Each manual sync pulls the **last 7 days**. The nightly background sync keeps everything current — you shouldn't normally need to press "Sync now".

## Universal fallback — screenshot upload

If you're not on Android, your watch is dead, or you're travelling without your phone, use the **Upload screenshot** button at the top of the Sleep panel on the Wellness tab. It works with **Garmin, Whoop, Oura, and Fitbit** sleep screenshots — Scarpers extracts stages and vitals automatically and saves them as a manual entry for today.

## iPhone users

Native iPhone sync (Apple Health → Scarpers via a webhook bridge) is **on the roadmap but not yet built**. For now, use the screenshot upload above. If you'd like iPhone sync prioritised, send feedback from the app.
