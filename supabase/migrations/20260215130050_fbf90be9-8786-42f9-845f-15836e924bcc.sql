
-- Table to store hourly readiness score snapshots
CREATE TABLE public.readiness_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  score integer NOT NULL,
  hour integer NOT NULL, -- 0-23 local hour
  factors jsonb,
  recorded_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for fast time-range queries per user
CREATE INDEX idx_readiness_snapshots_user_recorded ON public.readiness_snapshots (user_id, recorded_at DESC);

-- Enable RLS
ALTER TABLE public.readiness_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own readiness snapshots"
ON public.readiness_snapshots FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own readiness snapshots"
ON public.readiness_snapshots FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own readiness snapshots"
ON public.readiness_snapshots FOR DELETE
USING (auth.uid() = user_id);
