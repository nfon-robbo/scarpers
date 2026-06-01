
CREATE OR REPLACE FUNCTION public.admin_feedback_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      SELECT id, user_id, created_at, rating, category, message
      FROM public.user_feedback ORDER BY created_at DESC LIMIT 20
    ) r), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$function$;
