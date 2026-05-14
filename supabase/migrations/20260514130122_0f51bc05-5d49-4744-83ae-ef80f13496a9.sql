ALTER TABLE public.readiness_snapshots
  ADD COLUMN IF NOT EXISTS insight TEXT,
  ADD COLUMN IF NOT EXISTS recommendation TEXT;