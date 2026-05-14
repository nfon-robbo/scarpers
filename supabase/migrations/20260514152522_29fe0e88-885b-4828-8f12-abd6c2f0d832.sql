
CREATE TABLE public.workout_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  activity_id uuid NOT NULL UNIQUE,
  difficulty text,
  pace text,
  feel text,
  injury text,
  ai_summary text,
  coach_recommendation text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workout_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workout reviews"
  ON public.workout_reviews FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own workout reviews"
  ON public.workout_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own workout reviews"
  ON public.workout_reviews FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own workout reviews"
  ON public.workout_reviews FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER set_workout_reviews_updated_at
  BEFORE UPDATE ON public.workout_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
