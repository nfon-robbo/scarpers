// Proxies Open Food Facts search to avoid browser CORS issues.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const q = (url.searchParams.get('q') || '').trim();
    const barcode = (url.searchParams.get('barcode') || '').trim();

    let upstream: string;
    if (barcode) {
      upstream = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=code,product_name,brands,nutriments,serving_size,serving_quantity`;
    } else {
      if (q.length < 2) {
        return new Response(JSON.stringify({ products: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      upstream =
        `https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=15` +
        `&fields=code,product_name,brands,nutriments,serving_size,serving_quantity` +
        `&search_terms=${encodeURIComponent(q)}`;
    }

    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'Scarpers/1.0 (https://scarpers.co.uk)' },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
