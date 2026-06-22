
CREATE TABLE public.quick_foods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_name TEXT NOT NULL,
  brand TEXT,
  carbs_100g NUMERIC NOT NULL DEFAULT 0,
  protein_100g NUMERIC NOT NULL DEFAULT 0,
  fat_100g NUMERIC NOT NULL DEFAULT 0,
  kcal_100g NUMERIC NOT NULL DEFAULT 0,
  serving_g NUMERIC,
  product_g NUMERIC,
  serving_size TEXT,
  default_qty NUMERIC NOT NULL DEFAULT 1,
  default_unit TEXT NOT NULL DEFAULT 'g',
  default_grams NUMERIC NOT NULL DEFAULT 100,
  off_product_id TEXT,
  source TEXT,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_foods TO authenticated;
GRANT ALL ON public.quick_foods TO service_role;

ALTER TABLE public.quick_foods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own quick foods"
  ON public.quick_foods
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX quick_foods_user_recent_idx ON public.quick_foods (user_id, last_used_at DESC);
