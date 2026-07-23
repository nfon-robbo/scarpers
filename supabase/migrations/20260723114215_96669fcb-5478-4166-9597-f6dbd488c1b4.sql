
-- ============================================================
-- STEP 4: BENCHMARK FEATURE SCHEMA
-- ============================================================

-- 1. plan_workouts ---------------------------------------------------------
CREATE TABLE public.plan_workouts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  training_plan_id UUID REFERENCES public.training_plans(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  workout_type TEXT,
  is_benchmark BOOLEAN NOT NULL DEFAULT FALSE,
  benchmark_protocol TEXT,
  rejected_activity_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plan_workouts TO authenticated;
GRANT ALL ON public.plan_workouts TO service_role;

ALTER TABLE public.plan_workouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own plan_workouts"
  ON public.plan_workouts FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_plan_workouts_user_date
  ON public.plan_workouts(user_id, scheduled_date);
CREATE INDEX idx_plan_workouts_plan
  ON public.plan_workouts(training_plan_id);
CREATE INDEX idx_plan_workouts_benchmark
  ON public.plan_workouts(user_id, is_benchmark) WHERE is_benchmark;

CREATE TRIGGER trg_plan_workouts_updated_at
  BEFORE UPDATE ON public.plan_workouts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2. benchmark_results -----------------------------------------------------
CREATE TABLE public.benchmark_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_workout_id UUID REFERENCES public.plan_workouts(id) ON DELETE SET NULL,
  activity_id UUID REFERENCES public.activities(id) ON DELETE SET NULL,

  -- Effort window (queryable columns, not jsonb)
  effort_window_start_time TIMESTAMPTZ NOT NULL,
  effort_window_end_time   TIMESTAMPTZ NOT NULL,
  effort_window_duration_s NUMERIC NOT NULL,
  effort_window_distance_m NUMERIC NOT NULL,
  effort_window_source     TEXT    NOT NULL
    CHECK (effort_window_source IN ('lap','derived','manual')),
  effort_window_note       TEXT,

  -- Calculations
  threshold_pace_s_per_km NUMERIC NOT NULL,
  threshold_hr             INTEGER,
  lthr                     INTEGER,
  riegel_exponent          NUMERIC NOT NULL DEFAULT 1.06,
  predicted_5k_seconds     INTEGER,
  predicted_10k_seconds    INTEGER,
  predicted_half_seconds   INTEGER,
  predicted_full_seconds   INTEGER,

  -- Meta
  capture_method TEXT NOT NULL
    CHECK (capture_method IN ('auto','manual','fit_upload')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','rejected')),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  confidence_score INTEGER,
  confidence_band  TEXT,
  rpe_effort       INTEGER,
  rpe_notes        TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmark_results TO authenticated;
GRANT ALL ON public.benchmark_results TO service_role;

ALTER TABLE public.benchmark_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own benchmark_results"
  ON public.benchmark_results FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Only one ACTIVE, CONFIRMED benchmark per user
CREATE UNIQUE INDEX benchmark_results_active_confirmed_unique
  ON public.benchmark_results(user_id)
  WHERE active AND status = 'confirmed';

CREATE INDEX idx_benchmark_results_user_created
  ON public.benchmark_results(user_id, created_at DESC);
CREATE INDEX idx_benchmark_results_activity
  ON public.benchmark_results(activity_id);
CREATE INDEX idx_benchmark_results_plan_workout
  ON public.benchmark_results(plan_workout_id);

CREATE TRIGGER trg_benchmark_results_updated_at
  BEFORE UPDATE ON public.benchmark_results
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 3. hr_zones --------------------------------------------------------------
CREATE TABLE public.hr_zones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL CHECK (source IN ('benchmark','manual')),
  benchmark_result_id UUID REFERENCES public.benchmark_results(id) ON DELETE SET NULL,
  lthr INTEGER NOT NULL,
  z1_max INTEGER NOT NULL,
  z2_max INTEGER NOT NULL,
  z3_max INTEGER NOT NULL,
  z4_max INTEGER NOT NULL,
  -- No z5_max: Z5 is open-ended above z4_max.
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_zones TO authenticated;
GRANT ALL ON public.hr_zones TO service_role;

ALTER TABLE public.hr_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own hr_zones"
  ON public.hr_zones FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_hr_zones_user_effective
  ON public.hr_zones(user_id, effective_from DESC);

CREATE TRIGGER trg_hr_zones_updated_at
  BEFORE UPDATE ON public.hr_zones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 4. profiles.next_benchmark_due ------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS next_benchmark_due DATE;
