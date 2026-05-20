CREATE TABLE public.race_time_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  race_distance TEXT NOT NULL,
  prediction JSONB NOT NULL,
  computed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, race_distance)
);

ALTER TABLE public.race_time_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own race predictions" ON public.race_time_predictions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own race predictions" ON public.race_time_predictions
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own race predictions" ON public.race_time_predictions
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own race predictions" ON public.race_time_predictions
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_race_time_predictions_user ON public.race_time_predictions(user_id, computed_at DESC);