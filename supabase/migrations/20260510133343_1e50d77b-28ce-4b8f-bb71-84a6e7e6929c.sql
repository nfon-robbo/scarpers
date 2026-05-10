CREATE TABLE public.user_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rating integer,
  category text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own feedback" ON public.user_feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users view own feedback" ON public.user_feedback
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users delete own feedback" ON public.user_feedback
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Admins view all feedback" ON public.user_feedback
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE INDEX idx_user_feedback_created ON public.user_feedback(created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_feedback_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*)::int FROM public.user_feedback),
    'count_7d', (SELECT COUNT(*)::int FROM public.user_feedback WHERE created_at > NOW() - INTERVAL '7 days'),
    'count_30d', (SELECT COUNT(*)::int FROM public.user_feedback WHERE created_at > NOW() - INTERVAL '30 days'),
    'avg_rating', (SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0) FROM public.user_feedback WHERE rating IS NOT NULL),
    'by_category', COALESCE((SELECT jsonb_object_agg(COALESCE(category,'general'), c) FROM (
      SELECT category, COUNT(*)::int c FROM public.user_feedback GROUP BY category
    ) t), '{}'::jsonb),
    'by_rating', COALESCE((SELECT jsonb_object_agg(rating::text, c) FROM (
      SELECT rating, COUNT(*)::int c FROM public.user_feedback WHERE rating IS NOT NULL GROUP BY rating
    ) t), '{}'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM (
      SELECT id, created_at, rating, category, message
      FROM public.user_feedback ORDER BY created_at DESC LIMIT 20
    ) r), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;