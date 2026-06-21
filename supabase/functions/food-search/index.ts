// Proxies Open Food Facts search to avoid browser CORS issues.
// Uses search-a-licious (new OFF search) with fallback to legacy cgi/search.pl.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const UA = 'Scarpers/1.0 (https://scarpers.co.uk; contact@scarpers.co.uk)';
const FIELDS = 'code,product_name,brands,nutriments,serving_size,serving_quantity';

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    const text = await r.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = null; }
    return { ok: r.ok && body !== null, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null };
  }
}

// Map search-a-licious hit to legacy shape
function mapHit(h: any) {
  const n = h.nutriments ?? {};
  return {
    code: h.code,
    product_name: h.product_name ?? '',
    brands: Array.isArray(h.brands) ? h.brands.join(', ') : (h.brands ?? ''),
    nutriments: {
      carbohydrates_100g: n.carbohydrates_100g ?? n['carbohydrates_100g'],
      proteins_100g: n.proteins_100g ?? n['proteins_100g'],
      fat_100g: n.fat_100g ?? n['fat_100g'],
      'energy-kcal_100g': n['energy-kcal_100g'],
    },
    serving_size: h.serving_size,
    serving_quantity: h.serving_quantity,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const headers = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim();
    const barcode = (url.searchParams.get('barcode') || '').trim();

    if (barcode) {
      // Try world then off
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

    // 1) Try search-a-licious (more reliable, JSON-native)
    const sal = await fetchJson(
      `https://search.openfoodfacts.org/search?q=${encodeURIComponent(q)}&page_size=20&fields=${FIELDS}`
    );
    if (sal.ok && Array.isArray(sal.body?.hits)) {
      return new Response(JSON.stringify({ products: sal.body.hits.map(mapHit) }), { headers });
    }

    // 2) Fallback to legacy cgi/search.pl
    const legacy = await fetchJson(
      `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}&search_terms=${encodeURIComponent(q)}`
    );
    if (legacy.ok) {
      return new Response(JSON.stringify(legacy.body), { headers });
    }

    // 3) Graceful empty result so the UI doesn't crash
    return new Response(
      JSON.stringify({ products: [], error: 'upstream_unavailable', fallback: true }),
      { headers }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ products: [], error: (e as Error).message, fallback: true }),
      { status: 200, headers }
    );
  }
});
