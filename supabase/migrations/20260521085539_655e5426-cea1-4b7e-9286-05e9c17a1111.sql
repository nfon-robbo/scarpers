CREATE INDEX IF NOT EXISTS idx_activities_user_start_time
  ON public.activities (user_id, start_time DESC);

CREATE INDEX IF NOT EXISTS idx_sleep_stages_user_date
  ON public.sleep_stages (user_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_user_date
  ON public.daily_metrics (user_id, date DESC);