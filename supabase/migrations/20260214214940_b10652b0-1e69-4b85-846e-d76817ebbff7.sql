
-- Store Google Fit OAuth tokens
CREATE TABLE public.google_fit_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE public.google_fit_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own google fit tokens" ON public.google_fit_tokens FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own google fit tokens" ON public.google_fit_tokens FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own google fit tokens" ON public.google_fit_tokens FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own google fit tokens" ON public.google_fit_tokens FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_google_fit_tokens_updated_at
  BEFORE UPDATE ON public.google_fit_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Store sleep stage data
CREATE TABLE public.sleep_stages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  date DATE NOT NULL,
  stage TEXT NOT NULL, -- 'deep', 'light', 'rem', 'awake'
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  start_time TIMESTAMP WITH TIME ZONE,
  end_time TIMESTAMP WITH TIME ZONE,
  source TEXT DEFAULT 'google_fit',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.sleep_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sleep stages" ON public.sleep_stages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own sleep stages" ON public.sleep_stages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own sleep stages" ON public.sleep_stages FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own sleep stages" ON public.sleep_stages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_sleep_stages_user_date ON public.sleep_stages(user_id, date);
