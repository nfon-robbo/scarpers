CREATE TABLE public.analytics_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid,
  summary text NOT NULL,
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_analytics_summaries_user_plan ON public.analytics_summaries(user_id, plan_id, generated_at DESC);

ALTER TABLE public.analytics_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own analytics summaries" ON public.analytics_summaries
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own analytics summaries" ON public.analytics_summaries
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own analytics summaries" ON public.analytics_summaries
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own analytics summaries" ON public.analytics_summaries
  FOR DELETE USING (auth.uid() = user_id);