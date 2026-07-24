
-- 1. New structured columns on benchmark_results.
ALTER TABLE public.benchmark_results
  ADD COLUMN IF NOT EXISTS held_back_reasons       text[],
  ADD COLUMN IF NOT EXISTS slowdown_reason         text,
  ADD COLUMN IF NOT EXISTS breaks_reasons          text[],
  ADD COLUMN IF NOT EXISTS stoppage_duration_band  text,
  ADD COLUMN IF NOT EXISTS conditions              text[],
  ADD COLUMN IF NOT EXISTS injury_flagged          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS redo_requested          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_benchmark_interview jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Element-level CHECKs for multi-select arrays and single-select text.
ALTER TABLE public.benchmark_results
  DROP CONSTRAINT IF EXISTS benchmark_results_held_back_reasons_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_held_back_reasons_check
  CHECK (
    held_back_reasons IS NULL
    OR held_back_reasons <@ ARRAY[
      'Legs','Breathing','Motivation','Misjudged the pace','Cut it short','Old injury'
    ]::text[]
  );

ALTER TABLE public.benchmark_results
  DROP CONSTRAINT IF EXISTS benchmark_results_slowdown_reason_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_slowdown_reason_check
  CHECK (
    slowdown_reason IS NULL
    OR slowdown_reason = ANY (ARRAY[
      'Went out too hard','Hills or terrain','Ran out of legs',
      'Deliberate, felt strong early','Something interrupted me','Old injury'
    ])
  );

ALTER TABLE public.benchmark_results
  DROP CONSTRAINT IF EXISTS benchmark_results_breaks_reasons_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_breaks_reasons_check
  CHECK (
    breaks_reasons IS NULL
    OR breaks_reasons <@ ARRAY[
      'Traffic or crossings','Planned walk breaks','Needed to recover','Old injury','Something else'
    ]::text[]
  );

ALTER TABLE public.benchmark_results
  DROP CONSTRAINT IF EXISTS benchmark_results_stoppage_duration_band_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_stoppage_duration_band_check
  CHECK (
    stoppage_duration_band IS NULL
    OR stoppage_duration_band = ANY (ARRAY[
      'Under 30 seconds','30 seconds to 1 minute','1 to 2 minutes','Over 2 minutes'
    ])
  );

ALTER TABLE public.benchmark_results
  DROP CONSTRAINT IF EXISTS benchmark_results_conditions_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_conditions_check
  CHECK (
    conditions IS NULL
    OR conditions <@ ARRAY[
      'Nothing notable','Windy','Hot','Cold','Treadmill'
    ]::text[]
  );

-- 3. Extend status CHECK to include 'discarded'.
ALTER TABLE public.benchmark_results
  DROP CONSTRAINT IF EXISTS benchmark_results_status_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_status_check
  CHECK (status = ANY (ARRAY['pending','confirmed','rejected','scheduled','discarded']));

-- 4. hr_sensor_type on profiles.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS hr_sensor_type text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_hr_sensor_type_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_hr_sensor_type_check
  CHECK (
    hr_sensor_type IS NULL
    OR hr_sensor_type = ANY (ARRAY[
      'Chest strap','Watch wrist sensor','Armband','I don''t'
    ])
  );
