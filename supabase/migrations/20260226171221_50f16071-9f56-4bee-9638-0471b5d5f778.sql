
-- Add missing columns to activities
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS total_steps integer,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision;

-- Add missing columns to daily_metrics
ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS spo2 double precision,
  ADD COLUMN IF NOT EXISTS vo2_max double precision,
  ADD COLUMN IF NOT EXISTS active_calories double precision,
  ADD COLUMN IF NOT EXISTS height_m double precision,
  ADD COLUMN IF NOT EXISTS deep_sleep_minutes bigint,
  ADD COLUMN IF NOT EXISTS rem_sleep_minutes bigint,
  ADD COLUMN IF NOT EXISTS light_sleep_minutes bigint,
  ADD COLUMN IF NOT EXISTS awake_during_night_minutes bigint;

-- Add unique constraint on activities.source_file for deduplication (if not exists)
CREATE UNIQUE INDEX IF NOT EXISTS activities_source_file_unique ON public.activities (source_file) WHERE source_file IS NOT NULL;

-- Add unique constraint on daily_metrics (user_id, date) for upsert
CREATE UNIQUE INDEX IF NOT EXISTS daily_metrics_user_date_unique ON public.daily_metrics (user_id, date);
