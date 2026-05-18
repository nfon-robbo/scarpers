
CREATE TABLE public.plan_edit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  date_uk text NOT NULL,
  action text NOT NULL,
  template text,
  before_title text,
  after_title text,
  summary text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.plan_edit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own plan edit log"
  ON public.plan_edit_log FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own plan edit log"
  ON public.plan_edit_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own plan edit log"
  ON public.plan_edit_log FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX plan_edit_log_plan_id_created_idx
  ON public.plan_edit_log (plan_id, created_at DESC);

CREATE INDEX plan_edit_log_user_id_created_idx
  ON public.plan_edit_log (user_id, created_at DESC);
