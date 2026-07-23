
-- Remove effort_window fields from activities. They belong on benchmark_results
-- (arriving in step 3), not on the activity row itself.
ALTER TABLE public.activities
  DROP COLUMN IF EXISTS effort_window_source,
  DROP COLUMN IF EXISTS effort_window_note;

-- Allow garmin_export as a lap source (Garmin Connect data-export splits).
ALTER TABLE public.activity_laps
  DROP CONSTRAINT IF EXISTS activity_laps_source_check;
ALTER TABLE public.activity_laps
  ADD CONSTRAINT activity_laps_source_check
  CHECK (source IN ('fit','strava','garmin_export'));
