
-- 1. Drop plan_workouts (plans stay in markdown; benchmark marker moves to title token)
ALTER TABLE public.benchmark_results DROP CONSTRAINT IF EXISTS benchmark_results_plan_workout_id_fkey;
ALTER TABLE public.benchmark_results DROP COLUMN IF EXISTS plan_workout_id;
DROP TABLE IF EXISTS public.plan_workouts CASCADE;

-- 2. Reshape benchmark_results: add plan link + activity snapshot
ALTER TABLE public.benchmark_results
  ADD COLUMN IF NOT EXISTS training_plan_id UUID REFERENCES public.training_plans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scheduled_date DATE,
  ADD COLUMN IF NOT EXISTS activity_snapshot JSONB;

CREATE INDEX IF NOT EXISTS idx_benchmark_results_plan_date
  ON public.benchmark_results (training_plan_id, scheduled_date);

CREATE UNIQUE INDEX IF NOT EXISTS benchmark_results_plan_slot_unique
  ON public.benchmark_results (user_id, training_plan_id, scheduled_date)
  WHERE status = 'confirmed' AND training_plan_id IS NOT NULL AND scheduled_date IS NOT NULL;

-- 3. Rejections table (queryable, one row per user+activity, permanent)
CREATE TABLE IF NOT EXISTS public.benchmark_rejections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  reason TEXT,
  rejected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, activity_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_rejections TO authenticated;
GRANT ALL ON public.benchmark_rejections TO service_role;
ALTER TABLE public.benchmark_rejections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own benchmark_rejections"
  ON public.benchmark_rejections FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_rejections_user ON public.benchmark_rejections (user_id, rejected_at DESC);

-- 4. Import deletion audit log
CREATE TABLE IF NOT EXISTS public.activity_deletions_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL,
  source_file TEXT,
  start_time TIMESTAMPTZ,
  duration_seconds NUMERIC,
  distance_meters NUMERIC,
  activity_type TEXT,
  source TEXT,
  reason TEXT NOT NULL,
  import_source TEXT,
  raw_snapshot JSONB,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_deletions_log TO authenticated;
GRANT ALL ON public.activity_deletions_log TO service_role;
ALTER TABLE public.activity_deletions_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own activity_deletions_log"
  ON public.activity_deletions_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own activity_deletions_log"
  ON public.activity_deletions_log FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_activity_deletions_user ON public.activity_deletions_log (user_id, deleted_at DESC);
