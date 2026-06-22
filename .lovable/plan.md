# Barcode scanning for Add Meal

Add a second discovery path (scan) alongside the existing text search in the Add Meal dialog. A scan resolves to the outer multipack record, so the portion step must default to a single bag/serving — never the whole pack.

## Scope

Changes are confined to:
- `src/components/AddMealDialog.tsx` (UI + flow)
- `src/components/BarcodeScanner.tsx` (new — camera view)
- `src/lib/nutrition-api.ts` (new `lookupByBarcode` helper, reuse `OffFood` normaliser)
- `supabase/functions/food-search/index.ts` (extend existing `?barcode=` branch with `lc=en` and trimmed fields)

No DB migration. `nutrition_logs.portion_label` / `portion_grams` already exist from the previous update. Text-search ranking, dedupe, and the portion step are untouched.

## Flow

```text
[Add Meal] ──► search field + [Scan] button
                 │                 │
                 │                 ▼
                 │           Camera scanner
                 │           ┌──────────────┐
                 │           │ live preview │  ← cancel returns to search
                 │           │  + reticle   │
                 │           └──────────────┘
                 │                 │ EAN/UPC detected (debounced)
                 │                 ▼
                 │           edge fn ?barcode=…
                 │             │           │
                 │             ▼           ▼
                 │           HIT         MISS → "Product not found for {code}"
                 │             │              [Search by name] [Enter manually]
                 ▼             ▼
            results list   Portion step (skip list)
                 └─────────────┘
                       │
                       ▼
              Save → nutrition_logs (scaled macros + portion_label + portion_grams)
```

## 1. Add Meal dialog

- Add a `[Scan]` icon-button (lucide `ScanLine` or `Barcode`) inline-right of the search input, only visible when not in scanner/portion step.
- New local state `scanning: boolean` and `scanError: { code: string } | null`.
- When `scanning` is true, render `<BarcodeScanner>` in place of the search/results block with a close (X) control.
- On successful scan: call `lookupByBarcode(code)`. If a normalised food comes back, call the existing `pickFood(f)` — this already drives the portion step. If null, set `scanError = { code }` and exit scanner.
- Miss UI: small card showing "Product not found for barcode `{code}`" plus two buttons: "Search by name instead" (clears error, focuses search input with the code as the query so the user can edit) and "Enter manually" (existing `setManual(true)` path).
- Permission denied / no camera: scanner reports back via an `onError` callback; dialog shows a one-line toast "Camera unavailable — use search instead" and returns to the search view.

## 2. Portion step changes (scanned items only)

The existing portion step already supports `g` / `serving` / `pack` units and live scaling. For a scanned pick we need the option order and default to make "one bag" a single tap:

- When `selected` came from a scan AND `servingG` is present:
  - Show options in this order: `serving` (DEFAULT, label "1 bag / serving (~{servingG}g)"), `pack` ("whole pack ({productG}g)" — only if `productG > servingG * 1.5`), `g`.
  - `qty = 1`, `unit = "serving"`.
- When `servingG` is missing, default to `g` with a sensible starting qty (30g, same as today).
- Track scan-origin via a new optional field on `OffFood` (e.g. `fromBarcode?: boolean`) set in `lookupByBarcode`, so we don't change ordering for text-search picks.

No other portion-step logic changes. Save still writes scaled macros + `portion_label` + `quantity_g` (as `portion_grams` equivalent) just like today.

## 3. Scanner component (`BarcodeScanner.tsx`)

- Detect support: `'BarcodeDetector' in window` → use native with formats `['ean_13','ean_8','upc_a','upc_e']` against a `<video>` stream (rear camera, `facingMode: { ideal: 'environment' }`).
- Fallback: dynamic `import('@zxing/browser')` → `BrowserMultiFormatReader` restricted to the same four formats.
- requestAnimationFrame loop for native detector; ZXing handles its own loop. Stop the stream and call `onDetected(code)` on the first valid read. 800ms debounce guard so a re-render can't double-fire.
- Always release the MediaStream tracks in cleanup / on cancel.
- Errors:
  - `NotAllowedError` / `NotFoundError` → `onError('camera_unavailable')`.
  - BarcodeDetector construction failure → fall through to ZXing.
- UI: full-width video, dimmed overlay with a centred reticle, "Point at the barcode" caption, close button top-right.

## 4. Edge function (`food-search`)

The barcode branch already exists. Updates:
- Trim `FIELDS_BARCODE = 'code,product_name,brands,nutriments,serving_size,serving_quantity,product_quantity,countries_tags,lang'` (as specified).
- Append `&lc=en` to the lookup URL.
- Return `{ status: 0 }` shape unchanged on miss so the client can detect it.
- Keep existing host fallback (`world` → `uk`).

No change to text-search ranking, dedupe, or any other branch.

## 5. Client API (`nutrition-api.ts`)

- New `lookupByBarcode(code: string): Promise<OffFood | null>` — calls the edge function with `?barcode=`, runs the result through the same `normaliseOffProduct` used by `searchFoods`, sets `fromBarcode: true`, returns `null` when OFF responds `status: 0` or product is missing.

## 6. Dependencies

Add `@zxing/browser` (peer: `@zxing/library`) via bun. Native `BarcodeDetector` needs no dependency.

## What stays untouched

- Text search ranking, UK bias, dedupe, `entries_merged` display.
- `nutrition_logs` / `daily_nutrition_summary` schema and the recalc trigger.
- The "Enter manually" fallback button and its behaviour.
- Per-100g reference numbers shown on each result row.
