CREATE TABLE public.race_prediction_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  distance text NOT NULL,
  predicted_seconds integer NOT NULL,
  predicted_pace_per_km integer NOT NULL,
  vo2_max numeric,
  data_sources jsonb,
  triggered_by text NOT NULL DEFAULT 'manual',
  activity_id uuid,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rph_user_distance_date ON public.race_prediction_history(user_id, distance, calculated_at DESC);
CREATE INDEX idx_rph_user_recent ON public.race_prediction_history(user_id, created_at DESC);

ALTER TABLE public.race_prediction_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own prediction history"
  ON public.race_prediction_history FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own prediction history"
  ON public.race_prediction_history FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access prediction history"
  ON public.race_prediction_history FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);