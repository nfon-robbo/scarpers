
CREATE TABLE public.plan_generation_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  request JSONB NOT NULL DEFAULT '{}'::jsonb,
  content TEXT NOT NULL DEFAULT '',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  CONSTRAINT plan_generation_jobs_status_check CHECK (status IN ('running','done','error','cancelled'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_generation_jobs TO authenticated;
GRANT ALL ON public.plan_generation_jobs TO service_role;

ALTER TABLE public.plan_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own plan generation jobs"
  ON public.plan_generation_jobs FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Only one running job per (user, type)
CREATE UNIQUE INDEX plan_generation_jobs_one_running_per_type
  ON public.plan_generation_jobs (user_id, type)
  WHERE status = 'running';

CREATE INDEX plan_generation_jobs_user_status_idx
  ON public.plan_generation_jobs (user_id, status, updated_at DESC);

CREATE TRIGGER plan_generation_jobs_updated_at
  BEFORE UPDATE ON public.plan_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Realtime for live progress
ALTER PUBLICATION supabase_realtime ADD TABLE public.plan_generation_jobs;
ALTER TABLE public.plan_generation_jobs REPLICA IDENTITY FULL;
