// Proxies Open Food Facts search with UK-biased re-ranking.
// Tries search-a-licious first, falls back to legacy cgi/search.pl.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const UA = 'Scarpers/1.0 (https://scarpers.co.uk; contact@scarpers.co.uk)';
const FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity,countries_tags,lang,unique_scans_n,popularity_key';
const PAGE_SIZE = 50;
const RETURN_LIMIT = 15;

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { ok: r.ok && body !== null, status: r.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// Map search-a-licious hit to legacy shape
function mapHit(h: any) {
  const n = h.nutriments ?? {};
  return {
    code: h.code,
    product_name: h.product_name ?? '',
    brands: Array.isArray(h.brands) ? h.brands.join(', ') : (h.brands ?? ''),
    nutriments: {
      carbohydrates_100g: n.carbohydrates_100g,
      proteins_100g: n.proteins_100g,
      fat_100g: n.fat_100g,
      'energy-kcal_100g': n['energy-kcal_100g'],
      energy_100g: n.energy_100g,
    },
    serving_size: h.serving_size,
    serving_quantity: h.serving_quantity,
    countries_tags: h.countries_tags ?? [],
    lang: h.lang ?? '',
    unique_scans_n: h.unique_scans_n,
    popularity_key: h.popularity_key,
  };
}

interface Normalised {
  raw: any;
  name: string;
  brand: string;
  kcal: number;
  carbs: number;
  protein: number;
  fat: number;
  countries: string[];
  lang: string;
  popularity: number;
}

function normalise(p: any): Normalised | null {
  const n = p?.nutriments ?? {};
  const name = (p.product_name || '').trim();
  if (!name) return null;
  let kcal = num(n['energy-kcal_100g']);
  if (!kcal) {
    const kj = num(n.energy_100g);
    if (kj > 0) kcal = kj / 4.184;
  }
  const carbs = num(n.carbohydrates_100g);
  const protein = num(n.proteins_100g);
  const fat = num(n.fat_100g);

  // Drop junk: zero kcal OR missing all 3 macros
  if (!kcal || kcal <= 0) return null;
  if (!n.carbohydrates_100g && !n.proteins_100g && !n.fat_100g) return null;

  const brand = (p.brands || '').split(',')[0]?.trim() || '';
  const countries: string[] = Array.isArray(p.countries_tags) ? p.countries_tags : [];
  const popularity = num(p.unique_scans_n) || num(p.popularity_key) || 0;

  return {
    raw: p,
    name,
    brand,
    kcal,
    carbs,
    protein,
    fat,
    countries,
    lang: (p.lang || '').toLowerCase(),
    popularity,
  };
}

function score(item: Normalised, query: string): number {
  const q = query.trim().toLowerCase();
  const name = item.name.toLowerCase();
  const qWords = q.split(/\s+/).filter(Boolean);
  const allWordsMatch = qWords.every((w) => name.includes(w));

  let s = 0;
  if (name === q) s += 1000;
  else if (name.startsWith(q)) s += 500;
  if (allWordsMatch) s += 250;

  // Drop if no text match at all
  if (!allWordsMatch && !name.includes(q)) return -Infinity;

  if (item.countries.includes('en:united-kingdom')) s += 200;
  if (item.lang === 'en') s += 100;
  if (item.kcal > 0 && item.carbs && item.protein && item.fat) s += 75;
  s += Math.min(item.popularity, 100);
  return s;
}

function rankAndShape(rawProducts: any[], query: string): any[] {
  const normalised = rawProducts.map(normalise).filter((x): x is Normalised => !!x);
  const scored = normalised
    .map((n) => ({ n, s: score(n, query) }))
    .filter((x) => x.s > -Infinity);

  // Dedupe by name+brand, keep highest score
  const byKey = new Map<string, { n: Normalised; s: number }>();
  for (const item of scored) {
    const key = `${item.n.name.toLowerCase().trim()}|${item.n.brand.toLowerCase().trim()}`;
    const prev = byKey.get(key);
    if (!prev || item.s > prev.s) byKey.set(key, item);
  }

  const sorted = [...byKey.values()].sort((a, b) => b.s - a.s).slice(0, RETURN_LIMIT);
  return sorted.map((x) => x.n.raw);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim();
    const barcode = (url.searchParams.get('barcode') || '').trim();

    if (barcode) {
      const hosts = ['https://world.openfoodfacts.org', 'https://uk.openfoodfacts.org'];
      for (const h of hosts) {
        const r = await fetchJson(`${h}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${FIELDS}`);
        if (r.ok) return new Response(JSON.stringify(r.body), { headers });
      }
      return new Response(JSON.stringify({ status: 0, status_verbose: 'unavailable' }), { headers });
    }

    if (q.length < 2) {
      return new Response(JSON.stringify({ products: [] }), { headers });
    }

    let rawProducts: any[] | null = null;

    // 1) search-a-licious with optional langs=en hint
    const salUrls = [
      `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${PAGE_SIZE}&langs=en&fields=${FIELDS}`,
      `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=${PAGE_SIZE}&fields=${FIELDS}`,
    ];
    for (const u of salUrls) {
      const r = await fetchJson(u);
      if (r.ok && Array.isArray(r.body?.hits)) {
        rawProducts = r.body.hits.map(mapHit);
        break;
      }
    }

    // 2) Fallback: legacy cgi/search.pl with lc=en
    if (!rawProducts) {
      const legacy = await fetchJson(
        `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&lc=en&page_size=${PAGE_SIZE}&fields=${FIELDS}&search_terms=${encodeURIComponent(q)}`
      );
      if (legacy.ok && Array.isArray(legacy.body?.products)) {
        rawProducts = legacy.body.products;
      }
    }

    if (!rawProducts) {
      return new Response(
        JSON.stringify({ products: [], error: 'upstream_unavailable', fallback: true }),
        { headers }
      );
    }

    const ranked = rankAndShape(rawProducts, q);
    return new Response(JSON.stringify({ products: ranked }), { headers });
  } catch (e) {
    return new Response(
      JSON.stringify({ products: [], error: (e as Error).message, fallback: true }),
      { status: 200, headers }
    );
  }
});
