ALTER TABLE public.benchmark_results
  DROP COLUMN IF EXISTS predicted_10k_seconds,
  DROP COLUMN IF EXISTS predicted_half_seconds,
  DROP COLUMN IF EXISTS predicted_full_seconds;