CREATE OR REPLACE FUNCTION public.admin_system_health_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'latency', jsonb_build_object(
      'avg_ms_24h', (SELECT COALESCE(AVG(latency_ms),0)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours' AND latency_ms IS NOT NULL),
      'p95_ms_24h', (SELECT COALESCE(percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms),0)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours' AND latency_ms IS NOT NULL),
      'max_ms_24h', (SELECT COALESCE(MAX(latency_ms),0)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours' AND latency_ms IS NOT NULL),
      'calls_24h', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours'),
      'avg_by_label', COALESCE((SELECT jsonb_object_agg(COALESCE(label,'unknown'), avg_ms) FROM (
        SELECT label, AVG(latency_ms)::int avg_ms FROM public.ai_usage_log
        WHERE created_at > NOW() - INTERVAL '24 hours' AND latency_ms IS NOT NULL
        GROUP BY label
      ) l), '{}'::jsonb)
    ),
    'errors', jsonb_build_object(
      'count_24h', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours' AND status IS NOT NULL AND status >= 400),
      'count_7d', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '7 days' AND status IS NOT NULL AND status >= 400),
      'rate_24h', (SELECT CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(100.0 * SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) / COUNT(*), 2) END FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours' AND status IS NOT NULL),
      'recent', COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM (
        SELECT created_at, provider, label, status, latency_ms
        FROM public.ai_usage_log
        WHERE status IS NOT NULL AND status >= 400
        ORDER BY created_at DESC
        LIMIT 10
      ) r), '[]'::jsonb)
    ),
    'plan_failures', jsonb_build_object(
      'count_24h', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '24 hours' AND status IS NOT NULL AND status >= 400 AND label IN ('plan-generation','training-plan','plan')),
      'count_7d', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '7 days' AND status IS NOT NULL AND status >= 400 AND label IN ('plan-generation','training-plan','plan')),
      'count_30d', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '30 days' AND status IS NOT NULL AND status >= 400 AND label IN ('plan-generation','training-plan','plan')),
      'recent', COALESCE((SELECT jsonb_agg(row_to_json(r)) FROM (
        SELECT created_at, provider, model, status, latency_ms
        FROM public.ai_usage_log
        WHERE status IS NOT NULL AND status >= 400 AND label IN ('plan-generation','training-plan','plan')
        ORDER BY created_at DESC
        LIMIT 10
      ) r), '[]'::jsonb)
    )
  ) INTO result;
  RETURN result;
END;
$$;