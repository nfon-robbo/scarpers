
-- Create uploads table
CREATE TABLE public.uploads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'zip',
  record_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own uploads" ON public.uploads FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own uploads" ON public.uploads FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own uploads" ON public.uploads FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own uploads" ON public.uploads FOR DELETE USING (auth.uid() = user_id);

-- Create activities table
CREATE TABLE public.activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_id UUID REFERENCES public.uploads(id) ON DELETE SET NULL,
  activity_type TEXT,
  start_time TIMESTAMP WITH TIME ZONE,
  duration_seconds NUMERIC,
  distance_meters NUMERIC,
  avg_heart_rate NUMERIC,
  max_heart_rate NUMERIC,
  avg_speed NUMERIC,
  max_speed NUMERIC,
  avg_power NUMERIC,
  max_power NUMERIC,
  avg_cadence NUMERIC,
  total_ascent NUMERIC,
  total_descent NUMERIC,
  calories NUMERIC,
  avg_temperature NUMERIC,
  training_effect NUMERIC,
  training_load NUMERIC,
  source_file TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own activities" ON public.activities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own activities" ON public.activities FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own activities" ON public.activities FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own activities" ON public.activities FOR DELETE USING (auth.uid() = user_id);

-- Create daily_metrics table
CREATE TABLE public.daily_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_id UUID REFERENCES public.uploads(id) ON DELETE SET NULL,
  date DATE NOT NULL,
  resting_heart_rate NUMERIC,
  hrv NUMERIC,
  sleep_score NUMERIC,
  sleep_duration_seconds NUMERIC,
  weight NUMERIC,
  body_fat_percentage NUMERIC,
  stress_score NUMERIC,
  steps INTEGER,
  calories_total NUMERIC,
  source_file TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, date)
);

ALTER TABLE public.daily_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own metrics" ON public.daily_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own metrics" ON public.daily_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own metrics" ON public.daily_metrics FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own metrics" ON public.daily_metrics FOR DELETE USING (auth.uid() = user_id);

-- Index for faster querying
CREATE INDEX idx_activities_user_start ON public.activities(user_id, start_time DESC);
CREATE INDEX idx_daily_metrics_user_date ON public.daily_metrics(user_id, date DESC);
CREATE INDEX idx_uploads_user ON public.uploads(user_id, created_at DESC);
