CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'total_users', (SELECT COUNT(*)::int FROM auth.users),
    'new_today', (SELECT COUNT(*)::int FROM auth.users WHERE created_at::date = CURRENT_DATE),
    'new_this_week', (SELECT COUNT(*)::int FROM auth.users WHERE created_at > NOW() - INTERVAL '7 days'),
    'new_this_month', (SELECT COUNT(*)::int FROM auth.users WHERE created_at > NOW() - INTERVAL '30 days'),
    'active_week', (SELECT COUNT(DISTINCT user_id)::int FROM public.activities WHERE start_time > NOW() - INTERVAL '7 days'),
    'active_month', (SELECT COUNT(DISTINCT user_id)::int FROM public.activities WHERE start_time > NOW() - INTERVAL '30 days'),
    'intervals_connected', (SELECT COUNT(*)::int FROM public.intervals_credentials),
    'strava_connected', (SELECT COUNT(*)::int FROM public.strava_tokens),
    'google_fit_connected', (SELECT COUNT(*)::int FROM public.google_fit_tokens),
    'total_plans_active', (SELECT COUNT(*)::int FROM public.training_plans WHERE archived = false),
    'total_plans_all', (SELECT COUNT(*)::int FROM public.training_plans),
    'plans_by_distance', COALESCE((SELECT jsonb_object_agg(race_distance, c) FROM (
      SELECT COALESCE(race_distance,'unknown') as race_distance, COUNT(*)::int c
      FROM public.training_plans WHERE archived = false GROUP BY race_distance
    ) t), '{}'::jsonb),
    'plans_by_week', COALESCE((SELECT jsonb_object_agg(week::text, c) FROM (
      SELECT GREATEST(1, FLOOR((CURRENT_DATE - start_date)::numeric/7.0)::int + 1) as week, COUNT(*)::int c
      FROM public.training_plans WHERE archived = false
      GROUP BY 1
    ) t), '{}'::jsonb),
    'strava_synced_7d', (SELECT COUNT(*)::int FROM public.sync_schedules WHERE last_strava_sync > NOW() - INTERVAL '7 days'),
    'intervals_synced_7d', (SELECT COUNT(*)::int FROM public.sync_schedules WHERE last_intervals_sync > NOW() - INTERVAL '7 days'),
    'google_fit_synced_7d', (SELECT COUNT(*)::int FROM public.sync_schedules WHERE last_google_fit_sync > NOW() - INTERVAL '7 days'),
    'activities_total', (SELECT COUNT(*)::int FROM public.activities),
    'activities_7d', (SELECT COUNT(*)::int FROM public.activities WHERE created_at > NOW() - INTERVAL '7 days')
  ) INTO result;

  RETURN result;
END;
$$;