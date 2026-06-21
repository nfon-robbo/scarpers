
CREATE TABLE public.nutrition_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  meal_type text NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','snack')),
  food_name text NOT NULL,
  brand text,
  barcode text,
  quantity_g numeric NOT NULL DEFAULT 100,
  carbs_g numeric NOT NULL DEFAULT 0,
  protein_g numeric NOT NULL DEFAULT 0,
  fat_g numeric NOT NULL DEFAULT 0,
  calories numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('open_food_facts','manual','quick_add')),
  off_product_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nutrition_logs_user_date ON public.nutrition_logs (user_id, log_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_logs TO authenticated;
GRANT ALL ON public.nutrition_logs TO service_role;
ALTER TABLE public.nutrition_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own nutrition logs" ON public.nutrition_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_nutrition_logs_updated_at
  BEFORE UPDATE ON public.nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.daily_nutrition_summary (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  total_carbs_g numeric NOT NULL DEFAULT 0,
  total_protein_g numeric NOT NULL DEFAULT 0,
  total_fat_g numeric NOT NULL DEFAULT 0,
  total_calories numeric NOT NULL DEFAULT 0,
  hydration_cups numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_nutrition_summary TO authenticated;
GRANT ALL ON public.daily_nutrition_summary TO service_role;
ALTER TABLE public.daily_nutrition_summary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own nutrition summary" ON public.daily_nutrition_summary
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own nutrition summary hydration" ON public.daily_nutrition_summary
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.recalc_daily_nutrition(_user_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.daily_nutrition_summary (user_id, date, total_carbs_g, total_protein_g, total_fat_g, total_calories, updated_at)
  SELECT _user_id, _date,
    COALESCE(SUM(carbs_g), 0),
    COALESCE(SUM(protein_g), 0),
    COALESCE(SUM(fat_g), 0),
    COALESCE(SUM(calories), 0),
    now()
  FROM public.nutrition_logs
  WHERE user_id = _user_id AND log_date = _date
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_carbs_g = EXCLUDED.total_carbs_g,
    total_protein_g = EXCLUDED.total_protein_g,
    total_fat_g = EXCLUDED.total_fat_g,
    total_calories = EXCLUDED.total_calories,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.nutrition_logs_recalc_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_daily_nutrition(OLD.user_id, OLD.log_date);
    RETURN OLD;
  END IF;
  PERFORM public.recalc_daily_nutrition(NEW.user_id, NEW.log_date);
  IF TG_OP = 'UPDATE' AND (OLD.user_id <> NEW.user_id OR OLD.log_date <> NEW.log_date) THEN
    PERFORM public.recalc_daily_nutrition(OLD.user_id, OLD.log_date);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER nutrition_logs_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.nutrition_logs
  FOR EACH ROW EXECUTE FUNCTION public.nutrition_logs_recalc_trigger();
