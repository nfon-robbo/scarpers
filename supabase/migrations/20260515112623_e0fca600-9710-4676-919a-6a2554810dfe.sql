CREATE TABLE public.keyword_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword text NOT NULL,
  action_taken text NOT NULL,
  notes text,
  actioned_by uuid NOT NULL,
  actioned_by_email text,
  actioned_at timestamptz NOT NULL DEFAULT now(),
  next_review_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_keyword_actions_keyword ON public.keyword_actions(keyword);
CREATE INDEX idx_keyword_actions_actioned_at ON public.keyword_actions(actioned_at DESC);

ALTER TABLE public.keyword_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view keyword actions"
ON public.keyword_actions FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert keyword actions"
ON public.keyword_actions FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') AND auth.uid() = actioned_by);

CREATE POLICY "Admins can update keyword actions"
ON public.keyword_actions FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete keyword actions"
ON public.keyword_actions FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));