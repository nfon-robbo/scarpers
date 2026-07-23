
-- 1. activity_laps table
CREATE TABLE public.activity_laps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  lap_index INTEGER NOT NULL,
  start_time TIMESTAMPTZ,
  elapsed_time_s NUMERIC,
  moving_time_s NUMERIC,
  distance_m NUMERIC,
  avg_heart_rate NUMERIC,
  max_heart_rate NUMERIC,
  avg_speed_mps NUMERIC,
  max_speed_mps NUMERIC,
  avg_cadence NUMERIC,
  avg_power NUMERIC,
  max_power NUMERIC,
  total_ascent_m NUMERIC,
  total_descent_m NUMERIC,
  lap_trigger TEXT,
  source TEXT NOT NULL CHECK (source IN ('fit','strava')),
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, source, lap_index)
);

CREATE INDEX activity_laps_activity_id_idx ON public.activity_laps(activity_id);
CREATE INDEX activity_laps_user_id_idx ON public.activity_laps(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_laps TO authenticated;
GRANT ALL ON public.activity_laps TO service_role;

ALTER TABLE public.activity_laps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own activity laps"
  ON public.activity_laps FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own activity laps"
  ON public.activity_laps FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own activity laps"
  ON public.activity_laps FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own activity laps"
  ON public.activity_laps FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 2. effort_window metadata on activities (nullable, additive)
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS effort_window_source TEXT,
  ADD COLUMN IF NOT EXISTS effort_window_note TEXT;
