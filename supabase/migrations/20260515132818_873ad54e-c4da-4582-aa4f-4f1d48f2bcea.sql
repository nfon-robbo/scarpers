ALTER TABLE public.readiness_snapshots
  ADD COLUMN IF NOT EXISTS is_backfilled boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_user_recorded
  ON public.readiness_snapshots(user_id, recorded_at);