

# TrainingPeaks Export for Amazfit Balance 2

## Overview

The Amazfit Balance 2 / Zepp app supports syncing structured workouts FROM TrainingPeaks. The flow is:

1. Your app generates the training plan
2. You export individual workouts as `.FIT` workout files
3. Import the `.FIT` files into TrainingPeaks (via their calendar)
4. TrainingPeaks syncs the structured workouts to your Zepp app, which pushes them to your Balance 2

This means each workout's segments (warm-up, intervals, cool-down) with HR zones and durations will appear as executable structured workouts on your watch.

## What You'll Get

- **"Export for TrainingPeaks" button** -- downloads a ZIP of `.FIT` workout files (one per workout day)
- **"Download Calendar (.ics)" button** -- for calendar reminders with workout details
- **"Copy for Zepp" button** per workout -- for manual entry fallback
- **Setup instructions** card explaining how to link TrainingPeaks to Zepp

## How It Works

```text
+------------------+     +----------------+     +----------+     +-------------+
| Training Plan    | --> | .FIT Workout   | --> | Training | --> | Zepp App /  |
| (AI Generated)   |     | Files (ZIP)    |     | Peaks    |     | Balance 2   |
+------------------+     +----------------+     +----------+     +-------------+
```

The AI-generated plan already outputs workouts in a structured table format (Segment, Duration, Target, HR Zone). A parser will extract these tables and convert each workout into a FIT workout file with proper workout steps.

## Technical Details

### New Files

**`src/lib/fit-workout-encoder.ts`**
- Custom FIT file encoder that builds valid `.FIT` workout files in the browser (no external SDK needed -- the FIT binary format for workouts is simple enough to encode manually)
- Converts parsed workout segments into FIT workout_step messages with:
  - Duration targets (time or distance)
  - HR zone targets (Z1-Z5 mapped to percentage ranges)
  - Step types (warmup, active, cooldown, rest)
- Outputs a `Uint8Array` per workout

**`src/lib/plan-export.ts`**
- Parses the markdown plan content to extract individual workouts
- Detects workout headings (bold date + workout type pattern)
- Extracts segment tables (Duration, Target, HR Zone)
- Generates:
  - Individual `.FIT` workout files via the encoder
  - A `.zip` bundle of all workout FIT files (using existing JSZip dependency)
  - An `.ics` calendar file with workout descriptions
  - Clipboard-friendly text for manual Zepp entry

### Modified Files

**`src/pages/TrainingPlan.tsx`**
- Add export buttons in the action bar when a plan is displayed:
  - "Export for TrainingPeaks" (downloads ZIP of .FIT files)
  - "Download Calendar" (downloads .ics file)
- Add a collapsible "How to sync to your watch" instructions card

**`src/components/MarkdownRenderer.tsx`**
- Add a small "Copy for Zepp" clipboard button next to each detected workout heading
- When clicked, formats that workout's segments for easy manual entry

### FIT Workout File Structure

Each `.FIT` workout file will contain:
- File ID message (type: workout)
- Workout message (name, number of steps)
- Workout Step messages for each segment:
  - Warm-up: duration in seconds, HR zone target
  - Main intervals: duration/distance, pace/HR target, with repeat steps
  - Cool-down: duration in seconds, HR zone target

### TrainingPeaks Sync Instructions

A help card will explain:
1. Open the Zepp app on your phone
2. Go to Profile > 3rd-Party Account Linking > TrainingPeaks (via Terra)
3. Connect your TrainingPeaks account
4. Import the downloaded `.FIT` workout files into TrainingPeaks calendar
5. Workouts will automatically sync to your Balance 2

