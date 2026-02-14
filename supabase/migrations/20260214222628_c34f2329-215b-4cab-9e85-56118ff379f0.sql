
-- Create sync_schedules table
CREATE TABLE public.sync_schedules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  strava_enabled boolean NOT NULL DEFAULT false,
  strava_interval_hours integer NOT NULL DEFAULT 2,
  intervals_enabled boolean NOT NULL DEFAULT false,
  intervals_interval_hours integer NOT NULL DEFAULT 6,
  google_fit_enabled boolean NOT NULL DEFAULT false,
  google_fit_hour_utc integer NOT NULL DEFAULT 8,
  last_strava_sync timestamptz,
  last_intervals_sync timestamptz,
  last_google_fit_sync timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sync_schedules ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own sync schedule"
  ON public.sync_schedules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync schedule"
  ON public.sync_schedules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync schedule"
  ON public.sync_schedules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own sync schedule"
  ON public.sync_schedules FOR DELETE
  USING (auth.uid() = user_id);

-- Service role policy for cron-triggered auto-sync function
CREATE POLICY "Service role full access"
  ON public.sync_schedules FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Updated_at trigger
CREATE TRIGGER update_sync_schedules_updated_at
  BEFORE UPDATE ON public.sync_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Enable pg_cron and pg_net for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
