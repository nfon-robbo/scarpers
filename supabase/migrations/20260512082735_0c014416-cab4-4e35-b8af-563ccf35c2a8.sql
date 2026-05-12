ALTER TABLE public.training_plans
  ADD COLUMN IF NOT EXISTS last_adapted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_adaptation_reason text NULL;