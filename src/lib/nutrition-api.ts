// Open Food Facts client. No API key required.
// Docs: https://wiki.openfoodfacts.org/API/Read/Search

export interface OffFood {
  id: string; // barcode
  name: string;
  brand: string | null;
  per100g: {
    carbs: number;
    protein: number;
    fat: number;
    kcal: number;
  };
  servingG: number | null;
}

const PROXY_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/food-search`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function normalise(p: any): OffFood | null {
  const nutr = p?.nutriments ?? {};
  const carbs = num(nutr.carbohydrates_100g);
  // Drop items without basic macros — unusable for tracking
  if (!nutr.carbohydrates_100g && !nutr.proteins_100g && !nutr["energy-kcal_100g"]) return null;
  const name = (p.product_name || "").trim();
  if (!name) return null;
  return {
    id: String(p.code ?? ""),
    name,
    brand: (p.brands || "").split(",")[0]?.trim() || null,
    per100g: {
      carbs,
      protein: num(nutr.proteins_100g),
      fat: num(nutr.fat_100g),
      kcal: num(nutr["energy-kcal_100g"]),
    },
    servingG: num(p.serving_quantity) || null,
  };
}

export async function searchFoods(query: string, signal?: AbortSignal): Promise<OffFood[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `${SEARCH_URL}&search_terms=${encodeURIComponent(q)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open Food Facts search failed: ${res.status}`);
  const data = await res.json();
  const products: any[] = data.products ?? [];
  const items = products.map(normalise).filter((x): x is OffFood => !!x);
  // de-dupe by id
  const seen = new Set<string>();
  return items.filter((it) => {
    if (!it.id || seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
}

export async function getProductByBarcode(code: string): Promise<OffFood | null> {
  const res = await fetch(PRODUCT_URL(code));
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 1) return null;
  return normalise(data.product);
}

/** Scale per-100g macros to an arbitrary gram quantity. */
export function scaleFood(food: OffFood, grams: number) {
  const f = grams / 100;
  return {
    carbs_g: +(food.per100g.carbs * f).toFixed(1),
    protein_g: +(food.per100g.protein * f).toFixed(1),
    fat_g: +(food.per100g.fat * f).toFixed(1),
    calories: Math.round(food.per100g.kcal * f),
  };
}
