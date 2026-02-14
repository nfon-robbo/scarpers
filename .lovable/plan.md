

# Auto-Sync Settings with Custom Schedule Times

## Overview
Add an "Auto-Sync" configuration card to the Settings page where users can enable/disable automatic syncing for each data source (Strava, Intervals.icu, Google Fit) and customize the schedule times.

## What You'll See

A new **"Auto-Sync Schedule"** card on the Settings page with:
- Toggle switches to enable/disable auto-sync per source
- Time/frequency pickers for each source:
  - **Strava Activities**: frequency selector (every 1h, 2h, 4h, 6h)
  - **Intervals.icu Wellness**: frequency selector (every 4h, 6h, 12h, 24h)
  - **Google Fit Sleep**: time-of-day picker (e.g., 7:00 AM, 8:00 AM, 9:00 AM)
- A "Save & Apply" button to persist the schedule
- Status indicators showing each source's connection state

## Technical Details

### 1. Database Migration
Create a `sync_schedules` table to store per-user preferences:
- `user_id` (text, references user)
- `strava_enabled` (boolean, default false)
- `strava_interval_hours` (integer, default 2)
- `intervals_enabled` (boolean, default false)
- `intervals_interval_hours` (integer, default 6)
- `google_fit_enabled` (boolean, default false)
- `google_fit_hour_utc` (integer, default 8)
- RLS policies so users can only read/write their own row

### 2. New Edge Function: `auto-sync`
- A single function that accepts a `type` parameter (`strava`, `intervals-wellness`, `google-fit-sleep`)
- Queries `sync_schedules` to find users who have that source enabled
- For each enabled user, runs the appropriate sync logic using the service role key
- Registered in `config.toml` with `verify_jwt = false` (called by cron, not users)

### 3. Database Cron Jobs (pg_cron + pg_net)
- Enable `pg_cron` and `pg_net` extensions via migration
- Create three cron entries that call the `auto-sync` function on a fixed base schedule (e.g., hourly)
- The edge function itself checks each user's configured frequency/time preferences to decide whether to actually sync

### 4. Settings Page Updates (`src/pages/Settings.tsx`)
- New card: "Auto-Sync Schedule" with:
  - Three rows (Strava, Intervals.icu, Google Fit), each with a Switch toggle and a Select dropdown for frequency/time
  - Checks connection status (whether tokens exist in `strava_tokens`, `google_fit_tokens`, or Intervals.icu secrets are set) and shows "Not connected" badge if unavailable
  - Save button that upserts the user's row in `sync_schedules`
  - Info text explaining syncs happen automatically in the background

### 5. File Changes Summary
| File | Change |
|------|--------|
| Migration SQL | Create `sync_schedules` table with RLS |
| Migration SQL | Enable `pg_cron`, `pg_net`, create 3 cron jobs |
| `supabase/functions/auto-sync/index.ts` | New edge function orchestrating syncs per user |
| `supabase/config.toml` | Add `[functions.auto-sync]` with `verify_jwt = false` |
| `src/pages/Settings.tsx` | Add Auto-Sync Schedule card with toggles and time pickers |

