
-- 1. Delete duplicate sleep_stages rows, keeping the earliest by created_at
DELETE FROM public.sleep_stages a
USING public.sleep_stages b
WHERE a.ctid > b.ctid
  AND a.user_id = b.user_id
  AND a.source IS NOT DISTINCT FROM b.source
  AND a.start_time IS NOT DISTINCT FROM b.start_time
  AND a.end_time IS NOT DISTINCT FROM b.end_time
  AND a.stage = b.stage;

-- 2. Add unique index to prevent re-introduction
CREATE UNIQUE INDEX IF NOT EXISTS sleep_stages_unique_segment
  ON public.sleep_stages (user_id, source, start_time, end_time, stage);
