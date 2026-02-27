CREATE TABLE public.running_iq_snapshots (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  score INTEGER NOT NULL,
  adjusted_score INTEGER NOT NULL,
  label TEXT NOT NULL,
  pillars JSONB NOT NULL DEFAULT '[]'::jsonb,
  lowest_pillar TEXT,
  coaching_tip TEXT,
  recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.running_iq_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own running iq snapshots" ON public.running_iq_snapshots FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own running iq snapshots" ON public.running_iq_snapshots FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own running iq snapshots" ON public.running_iq_snapshots FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can update own running iq snapshots" ON public.running_iq_snapshots FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX idx_running_iq_user_recorded ON public.running_iq_snapshots (user_id, recorded_at DESC);