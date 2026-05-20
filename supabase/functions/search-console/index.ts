import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from 'npm:@supabase/supabase-js@2'

const GATEWAY = 'https://connector-gateway.lovable.dev/google_search_console/webmasters/v3'
const SITE = 'sc-domain:scarpers.co.uk'
const SITE_ENC = encodeURIComponent(SITE)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    const GSC_KEY = Deno.env.get('GOOGLE_SEARCH_CONSOLE_API_KEY')
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured')
    if (!GSC_KEY) throw new Error('GOOGLE_SEARCH_CONSOLE_API_KEY not configured')

    // Auth + admin check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: userData } = await supabase.auth.getUser()
    const user = userData?.user
    if (!user) return json({ error: 'Unauthorized' }, 401)
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
    if (!roles || roles.length === 0) return json({ error: 'Forbidden' }, 403)

    // Parse optional date range (in days). Allowed: 7, 28, 90. Default 28.
    // Optional `page` filter: when present, return only queries for that page URL.
    let days = 28
    let pageFilter: string | null = null
    try {
      if (req.method === 'POST') {
        const body = await req.json().catch(() => ({}))
        const d = Number(body?.days)
        if ([7, 28, 90].includes(d)) days = d
        if (typeof body?.page === 'string' && body.page.startsWith('http')) pageFilter = body.page
      } else {
        const url = new URL(req.url)
        const d = Number(url.searchParams.get('days'))
        if ([7, 28, 90].includes(d)) days = d
        const p = url.searchParams.get('page')
        if (p && p.startsWith('http')) pageFilter = p
      }
    } catch { /* ignore */ }

    const today = new Date()
    const end = today.toISOString().slice(0, 10)
    const startD = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10)

    const headers = {
      'Authorization': `Bearer ${LOVABLE_API_KEY}`,
      'X-Connection-Api-Key': GSC_KEY,
      'Content-Type': 'application/json',
    }

    const query = async (dimensions: string[], rowLimit = 100, filters?: any[]) => {
      const payload: any = { startDate: startD, endDate: end, dimensions, rowLimit }
      if (filters && filters.length) payload.dimensionFilterGroups = [{ filters }]
      const r = await fetch(`${GATEWAY}/sites/${SITE_ENC}/searchAnalytics/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(`GSC ${dimensions.join(',')} [${r.status}]: ${JSON.stringify(d)}`)
      return d.rows ?? []
    }

    if (pageFilter) {
      const rows = await query(['query'], 50, [
        { dimension: 'page', operator: 'equals', expression: pageFilter },
      ])
      return json({
        site: SITE,
        range: { start: startD, end, days },
        page: pageFilter,
        byQuery: rows,
        fetchedAt: new Date().toISOString(),
      })
    }

    const [byQuery, byPage, byDate, totals, sitemaps] = await Promise.all([
      query(['query'], 100),
      query(['page'], 100),
      query(['date'], 100),
      query([], 1),
      fetch(`${GATEWAY}/sites/${SITE_ENC}/sitemaps`, { headers }).then(r => r.json()).catch(() => ({})),
    ])

    return json({
      site: SITE,
      range: { start: startD, end, days },
      totals: totals[0] ?? null,
      byQuery,
      byPage,
      byDate,
      sitemaps: sitemaps?.sitemap ?? [],
      fetchedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error(e)
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
