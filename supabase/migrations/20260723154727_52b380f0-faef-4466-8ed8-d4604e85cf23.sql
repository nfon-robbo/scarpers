ALTER TABLE public.benchmark_results
  ADD CONSTRAINT benchmark_results_rpe_response_check
    CHECK (rpe_response IS NULL OR rpe_response IN ('Easy','Moderate','Hard','Very Hard','Maximal')),
  ADD CONSTRAINT benchmark_results_could_continue_response_check
    CHECK (could_continue_response IS NULL OR could_continue_response IN ('Easily','Another 15 minutes','Another 10 minutes','Another 5 minutes','No'));