
-- Table to store Strava OAuth tokens per user
CREATE TABLE public.strava_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  athlete_id BIGINT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.strava_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strava tokens"
  ON public.strava_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own strava tokens"
  ON public.strava_tokens FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own strava tokens"
  ON public.strava_tokens FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own strava tokens"
  ON public.strava_tokens FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER update_strava_tokens_updated_at
  BEFORE UPDATE ON public.strava_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
