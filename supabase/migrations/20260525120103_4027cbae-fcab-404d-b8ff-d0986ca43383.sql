
ALTER TABLE public.daily_metrics
  ADD COLUMN IF NOT EXISTS spo2_avg numeric,
  ADD COLUMN IF NOT EXISTS spo2_lowest numeric,
  ADD COLUMN IF NOT EXISTS respiration_avg numeric,
  ADD COLUMN IF NOT EXISTS breathing_pattern text,
  ADD COLUMN IF NOT EXISTS skin_temp_deviation numeric,
  ADD COLUMN IF NOT EXISTS restless_count integer,
  ADD COLUMN IF NOT EXISTS hrv_7d_trend text,
  ADD COLUMN IF NOT EXISTS body_battery_change integer;
