
-- Create table for saved analyses
CREATE TABLE public.analyses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own analyses"
ON public.analyses FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
ON public.analyses FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses"
ON public.analyses FOR DELETE
USING (auth.uid() = user_id);
