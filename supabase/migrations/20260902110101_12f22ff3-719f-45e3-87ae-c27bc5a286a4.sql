CREATE TABLE public.niggles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  location TEXT NOT NULL,
  severity TEXT,
  notes TEXT,
  source TEXT,
  activity_id UUID,
  status TEXT NOT NULL DEFAULT 'active',
  reported_on DATE NOT NULL DEFAULT (now() AT TIME ZONE 'utc')::date,
  last_checkin_on DATE,
  last_trend TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX niggles_user_status_idx ON public.niggles (user_id, status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.niggles TO authenticated;
GRANT ALL ON public.niggles TO service_role;
ALTER TABLE public.niggles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own niggles" ON public.niggles FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.niggle_checkins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  niggle_id UUID NOT NULL REFERENCES public.niggles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  checkin_on DATE NOT NULL,
  response TEXT NOT NULL,
  workout_title TEXT,
  advice TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (niggle_id, checkin_on)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.niggle_checkins TO authenticated;
GRANT ALL ON public.niggle_checkins TO service_role;
ALTER TABLE public.niggle_checkins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own niggle checkins" ON public.niggle_checkins FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_niggles_updated_at BEFORE UPDATE ON public.niggles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();