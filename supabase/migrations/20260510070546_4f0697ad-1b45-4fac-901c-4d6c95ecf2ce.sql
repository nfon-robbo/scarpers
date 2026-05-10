CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  provider text NOT NULL,
  model text,
  label text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  total_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  latency_ms integer,
  status integer,
  streamed boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ai_usage_log_created_at_idx ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_log_user_id_idx ON public.ai_usage_log (user_id);

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view ai usage"
ON public.ai_usage_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role can insert ai usage"
ON public.ai_usage_log FOR INSERT
TO public
WITH CHECK (auth.role() = 'service_role');

-- Admin stats RPC: extend with AI usage data
CREATE OR REPLACE FUNCTION public.admin_ai_usage_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT jsonb_build_object(
    'calls_today', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at::date = CURRENT_DATE),
    'calls_month', (SELECT COUNT(*)::int FROM public.ai_usage_log WHERE created_at > date_trunc('month', NOW())),
    'tokens_today', (SELECT COALESCE(SUM(total_tokens),0)::int FROM public.ai_usage_log WHERE created_at::date = CURRENT_DATE),
    'tokens_month', (SELECT COALESCE(SUM(total_tokens),0)::int FROM public.ai_usage_log WHERE created_at > date_trunc('month', NOW())),
    'cost_today', (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM public.ai_usage_log WHERE created_at::date = CURRENT_DATE),
    'cost_month', (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM public.ai_usage_log WHERE created_at > date_trunc('month', NOW())),
    'cost_30d', (SELECT COALESCE(SUM(estimated_cost_usd),0) FROM public.ai_usage_log WHERE created_at > NOW() - INTERVAL '30 days'),
    'avg_tokens_per_plan', (SELECT COALESCE(AVG(total_tokens),0)::int FROM public.ai_usage_log WHERE label IN ('plan-generation','training-plan','plan')),
    'by_provider', COALESCE((SELECT jsonb_object_agg(provider, jsonb_build_object('calls', c, 'tokens', t, 'cost', cost)) FROM (
      SELECT provider, COUNT(*)::int c, COALESCE(SUM(total_tokens),0)::int t, COALESCE(SUM(estimated_cost_usd),0) cost
      FROM public.ai_usage_log WHERE created_at > date_trunc('month', NOW())
      GROUP BY provider
    ) p), '{}'::jsonb),
    'by_label', COALESCE((SELECT jsonb_object_agg(COALESCE(label,'unknown'), c) FROM (
      SELECT label, COUNT(*)::int c FROM public.ai_usage_log
      WHERE created_at > NOW() - INTERVAL '30 days' GROUP BY label
    ) l), '{}'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;