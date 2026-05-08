CREATE TABLE public.intervals_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  athlete_id text NOT NULL,
  api_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.intervals_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own intervals credentials" ON public.intervals_credentials
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own intervals credentials" ON public.intervals_credentials
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own intervals credentials" ON public.intervals_credentials
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own intervals credentials" ON public.intervals_credentials
  FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_intervals_credentials_updated_at
  BEFORE UPDATE ON public.intervals_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();