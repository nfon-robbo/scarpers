# Nutrition Logger — Open Food Facts integration

Track daily carbs / protein / fat / calories per meal so Claire can reason about fuelling. UK supermarket coverage comes free via Open Food Facts (no API key, no cost).

Build Phase 1 end-to-end first (logging + summary UI). Phase 2 (readiness penalty + AI context) ships in the same PR but is feature-flag-light: it only activates once a user has logged ≥1 day of data, so existing users see no behaviour change until they start using it.

## Phase 1 — Logging

### Database (one migration)

`nutrition_logs`
- `id` uuid PK, `user_id` uuid (→ auth.users, cascade delete)
- `log_date` date, `meal_type` text check in (`breakfast`,`lunch`,`dinner`,`snack`)
- `food_name` text, `brand` text nullable, `barcode` text nullable
- `quantity_g` numeric (always normalised to grams; serving logic happens in UI)
- `carbs_g`, `protein_g`, `fat_g`, `calories` numeric
- `source` text check in (`open_food_facts`,`manual`,`quick_add`)
- `off_product_id` text nullable (Open Food Facts barcode for re-lookup)
- `created_at`, `updated_at` timestamptz
- Index `(user_id, log_date desc)`
- RLS: user owns their rows. GRANT select/insert/update/delete to `authenticated`, all to `service_role`.

`daily_nutrition_summary` — materialised view? No, plain table updated by trigger on `nutrition_logs` insert/update/delete (cheaper than a nightly cron and always live for the UI).
- `user_id` uuid, `date` date, totals as spec, `hydration_cups` numeric default 0
- PK `(user_id, date)`
- Trigger function `recalc_daily_nutrition(user_id, date)` runs AFTER insert/update/delete on `nutrition_logs`.
- Same RLS / GRANT pattern.

### Open Food Facts client — `src/lib/nutrition-api.ts`

- `searchFoods(query: string, signal?: AbortSignal): Promise<OffProduct[]>` → hits `https://world.openfoodfacts.org/cgi/search.pl?search_terms=…&search_simple=1&action=process&json=1&page_size=15&fields=code,product_name,brands,nutriments,serving_size,serving_quantity`. Filters out results with no `nutriments.carbohydrates_100g`.
- `getProductByBarcode(code)` for re-lookups.
- Normaliser: returns `{ id, name, brand, per100g: { carbs, protein, fat, kcal }, servingG | null }`.
- Debounced from the UI (300ms) with AbortController to avoid hammering OFF.
- No auth needed; send a descriptive `User-Agent: Scarpers/1.0 (https://scarpers.co.uk)` header per OFF etiquette.

### UI

`src/components/AddMealDialog.tsx`
- Meal type segmented control (breakfast/lunch/dinner/snack), defaults based on current UK time.
- Search input → live OFF results list (name • brand • kcal/100g).
- Selected food card with quantity input (grams) + serving shortcut (`1 serving = Xg` when OFF provides it) + slider 0–500g.
- Live-recomputed carbs / protein / fat / kcal preview.
- Editable override fields (carbs_g / protein_g / fat_g / kcal) — pre-filled, mark `source='manual'` on save if changed.
- "Can't find it? Enter manually" toggle → blank form, `source='manual'`.
- Save → insert into `nutrition_logs`; toast on success.

`src/pages/Nutrition.tsx`
- Header strip: today's totals (carbs, protein, fat, kcal) with target bars (carbs target = 5g/kg bodyweight from `profiles.weight_kg`, protein target = 1.6g/kg; soft visual only, no scoring yet).
- Quick-add chips for runner foods: Banana 120g, Slice of toast 35g, SIS gel 60g, Porridge 50g dry, Whey scoop 30g. Each writes a `quick_add` row in one tap.
- Sections per meal type with edit / delete buttons per row (uses AddMealDialog in edit mode).
- Day picker (defaults today, ± arrows for yesterday/tomorrow).

`src/components/insights/WellnessTab.tsx` — add a "Nutrition" sub-tab (or a card linking to `/nutrition`) so it lives inside the existing Wellness IA the user already has. No new top-level nav.

Route: register `/nutrition` in `src/App.tsx` behind `ProtectedRoute`.

## Phase 2 — Readiness + Claire hooks (same PR, flips on automatically once data exists)

### `src/lib/readiness.ts`
Extend `ReadinessData` with:
- `yesterdayCarbsG: number | null`
- `yesterdayProteinG: number | null`
- `bodyWeightKg: number | null`
- `todayPlannedHard: boolean`

New optional modifier (EOD mode only, skipped entirely if all three nutrition values are null — so no impact for non-loggers):
- Carb fuelling: if `todayPlannedHard` and `yesterdayCarbsG < 150` → `-6` (or `-10` if `< 100`).
- Protein recovery: if `yesterdayProteinG < 0.8 * bodyWeightKg` → `-4`.
- Both clearly labelled in the factor list so the user sees *why*.

### AI context
Add a `nutrition` block to the readiness/coach prompt builders (ai-coach edge fn and Claire chatbot context) summarising the last 3 days of totals + targets-hit-rate. Keeps the 150-word/3-5-bullet rule. No new edge function — just inject into the existing context payload.

### Loader
Single helper `loadNutritionContext(userId, today)` in `src/lib/nutrition-context.ts` reads `daily_nutrition_summary` for the relevant dates; used by Dashboard, readiness compute call sites, and the chat context builder.

## Explicitly out of scope (matches spec)
- Hydration (column exists at 0, no UI yet)
- Barcode scanning, meal templates, HealthKit/Health Connect nutrition
- Workout gating on nutrition

## Verification checklist (manual after build)
1. Open `/nutrition`, click Add Meal, search "banana" → OFF returns "Banana – raw" (~23g carbs/100g).
2. Set qty 120g → preview shows ~28g carbs; Save → row appears under Breakfast and totals update.
3. Edit the row, change qty to 60g → totals halve.
4. Delete the row → totals zero out and `daily_nutrition_summary` row reflects 0.
5. Log <150g carbs yesterday + a hard session today → readiness widget shows new "Carb Fuelling" factor with the penalty detail.
6. Open Claire chat → she references yesterday's carbs/protein in the answer.

## Open questions before I implement
None blocking — defaults chosen above (grams as canonical unit, plain table + trigger instead of nightly cron, Nutrition lives inside Wellness rather than as a new top-level nav item). Say the word if you'd rather have any of those flipped.
