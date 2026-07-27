Add saturated fat and salt tracking to the nutrition workflow, sourced from Open Food Facts and surfaced in the daily log and totals.

## Changes

### Database
- Add `sat_fats_g` and `salt_mg` columns to `public.nutrition_logs`.
- Add `total_sat_fats_g` and `total_salt_mg` columns to `public.daily_nutrition_summary`.
- Update `public.recalc_daily_nutrition()` to sum and persist the new fields.
- Update the `nutrition_logs_recalc_trigger()` trigger to fire on the new table layout.

### Edge Function
- Update `supabase/functions/food-search/index.ts` to request and return `saturated-fat_100g` and `salt_100g` from Open Food Facts for both search and barcode lookups.

### Client logic
- Extend `OffFood` and `NutritionLog` interfaces in `src/lib/nutrition-api.ts` and `src/pages/Nutrition.tsx` to include `satFatsG` / `saltMg` and `sat_fats_g` / `salt_mg`.
- Update `normalise()` and `scaleFood()` in `src/lib/nutrition-api.ts` to parse and scale the new values.
- Update `AddMealDialog.tsx` to show saturated fat and salt per 100g in search results and the selected-food preview, and to log them with the meal.
- Update `Nutrition.tsx` totals grid to show **Sat fats** and **Salt** cards with daily sums, and include the values in each meal item row.

### UX notes
- Salt displayed in milligrams (mg) to match food-label convention; saturated fat in grams (g) like other macros.
- If Open Food Facts does not provide values for an item, the fields will show as `—` and contribute 0 to totals.