ALTER TABLE public.training_plans ADD COLUMN archived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_training_plans_user_archived ON public.training_plans(user_id, archived);