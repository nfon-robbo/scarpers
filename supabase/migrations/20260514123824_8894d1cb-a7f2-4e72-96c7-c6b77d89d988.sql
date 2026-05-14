ALTER TABLE public.readiness_snapshots
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'eod';

UPDATE public.readiness_snapshots SET kind = 'morning' WHERE kind = 'eod';

ALTER TABLE public.readiness_snapshots
  DROP CONSTRAINT IF EXISTS readiness_snapshots_kind_check;
ALTER TABLE public.readiness_snapshots
  ADD CONSTRAINT readiness_snapshots_kind_check CHECK (kind IN ('morning','eod'));

CREATE INDEX IF NOT EXISTS idx_readiness_snapshots_user_kind_recorded
  ON public.readiness_snapshots (user_id, kind, recorded_at DESC);