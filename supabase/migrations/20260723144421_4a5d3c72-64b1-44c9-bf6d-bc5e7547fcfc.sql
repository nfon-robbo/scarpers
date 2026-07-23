ALTER TABLE public.benchmark_results
  ADD COLUMN IF NOT EXISTS rpe_response text,
  ADD COLUMN IF NOT EXISTS could_continue_response text,
  ADD COLUMN IF NOT EXISTS likely_submaximal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.benchmark_results.rpe_response IS 'Post-benchmark RPE answer: Easy | Moderate | Hard | Maximal';
COMMENT ON COLUMN public.benchmark_results.could_continue_response IS 'Post-benchmark could-continue answer: Easily | A bit | Barely | Not at all';
COMMENT ON COLUMN public.benchmark_results.likely_submaximal IS 'Derived at insert: true if rpe_response IN (Easy,Moderate) OR could_continue_response = Easily. Drives both the confidence-score deduction and the history flag; never re-evaluated separately.';