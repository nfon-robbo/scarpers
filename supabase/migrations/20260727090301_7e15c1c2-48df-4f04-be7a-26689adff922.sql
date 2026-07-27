ALTER TABLE public.nutrition_logs
ADD COLUMN sat_fats_g numeric NOT NULL DEFAULT 0,
ADD COLUMN salt_mg numeric NOT NULL DEFAULT 0;

ALTER TABLE public.daily_nutrition_summary
ADD COLUMN total_sat_fats_g numeric NOT NULL DEFAULT 0,
ADD COLUMN total_salt_mg numeric NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recalc_daily_nutrition(_user_id uuid, _date date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.daily_nutrition_summary (user_id, date, total_carbs_g, total_protein_g, total_fat_g, total_calories, total_alcohol_units, total_sat_fats_g, total_salt_mg, updated_at)
  SELECT _user_id, _date,
    COALESCE(SUM(carbs_g), 0),
    COALESCE(SUM(protein_g), 0),
    COALESCE(SUM(fat_g), 0),
    COALESCE(SUM(calories), 0),
    COALESCE(SUM(alcohol_units), 0),
    COALESCE(SUM(sat_fats_g), 0),
    COALESCE(SUM(salt_mg), 0),
    now()
  FROM public.nutrition_logs
  WHERE user_id = _user_id AND log_date = _date
  ON CONFLICT (user_id, date) DO UPDATE SET
    total_carbs_g = EXCLUDED.total_carbs_g,
    total_protein_g = EXCLUDED.total_protein_g,
    total_fat_g = EXCLUDED.total_fat_g,
    total_calories = EXCLUDED.total_calories,
    total_alcohol_units = EXCLUDED.total_alcohol_units,
    total_sat_fats_g = EXCLUDED.total_sat_fats_g,
    total_salt_mg = EXCLUDED.total_salt_mg,
    updated_at = now();
END;
$function$;