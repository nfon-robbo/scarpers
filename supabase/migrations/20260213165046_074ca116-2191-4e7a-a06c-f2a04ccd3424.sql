-- Add training_plan_id column to activities so users can tag which activities belong to a plan
ALTER TABLE public.activities ADD COLUMN training_plan_id uuid REFERENCES public.training_plans(id) ON DELETE SET NULL;

-- Index for efficient lookups
CREATE INDEX idx_activities_training_plan_id ON public.activities(training_plan_id);