
-- 1. Drop unused legacy column (0 rows populated; superseded by rpe_response)
ALTER TABLE public.benchmark_results DROP COLUMN IF EXISTS rpe_effort;

-- 2. Add benchmark_date. Backfill from scheduled_date/created_at, then enforce NOT NULL.
ALTER TABLE public.benchmark_results ADD COLUMN IF NOT EXISTS benchmark_date date;
UPDATE public.benchmark_results
SET benchmark_date = COALESCE(scheduled_date, created_at::date)
WHERE benchmark_date IS NULL;
ALTER TABLE public.benchmark_results ALTER COLUMN benchmark_date SET NOT NULL;

-- 3. Add benchmark_protocol with CHECK matching BenchmarkProtocol enum in benchmark-token.ts
ALTER TABLE public.benchmark_results ADD COLUMN IF NOT EXISTS benchmark_protocol text;
ALTER TABLE public.benchmark_results DROP CONSTRAINT IF EXISTS benchmark_results_protocol_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_protocol_check
  CHECK (benchmark_protocol IS NULL OR benchmark_protocol IN ('30min','3k','5k'));

-- 4. Add confidence_deductions jsonb (array of {code, points, note})
ALTER TABLE public.benchmark_results
  ADD COLUMN IF NOT EXISTS confidence_deductions jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 5. Extend status CHECK to allow 'scheduled'
ALTER TABLE public.benchmark_results DROP CONSTRAINT IF EXISTS benchmark_results_status_check;
ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_status_check
  CHECK (status IN ('pending','confirmed','rejected','scheduled'));

-- 6. Helpful index for history queries
CREATE INDEX IF NOT EXISTS idx_benchmark_results_user_bdate
  ON public.benchmark_results (user_id, benchmark_date DESC);
