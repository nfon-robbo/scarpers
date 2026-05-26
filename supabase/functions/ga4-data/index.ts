import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const CLIENT_ID = Deno.env.get("GA4_OAUTH_CLIENT_ID")!;
    const CLIENT_SECRET = Deno.env.get("GA4_OAUTH_CLIENT_SECRET")!;
    const PROPERTY_ID = Deno.env.get("GA4_PROPERTY_ID");
    if (!PROPERTY_ID) return json({ error: "GA4_PROPERTY_ID not set" }, 500);

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user } } = await sb.auth.getUser(auth.replace("Bearer ", ""));
    if (!user) return json({ error: "Unauthorized" }, 401);
    const { data: roles } = await sb.from("user_roles").select("role")
      .eq("user_id", user.id).eq("role", "admin");
    if (!roles || roles.length === 0) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "report";
    const days: number = Math.min(Math.max(Number(body.days) || 28, 1), 365);

    const { data: tokenRow } = await sb.from("ga4_tokens").select("*").maybeSingle();
    if (action === "status") {
      return json({ connected: !!tokenRow, property_id: PROPERTY_ID });
    }
    if (action === "disconnect") {
      if (tokenRow) await sb.from("ga4_tokens").delete().eq("id", tokenRow.id);
      return json({ ok: true });
    }
    if (!tokenRow) return json({ error: "Not connected" }, 400);

    // Get fresh access token
    let accessToken = tokenRow.access_token as string | null;
    const now = Math.floor(Date.now() / 1000);
    if (!accessToken || !tokenRow.expires_at || tokenRow.expires_at < now + 60) {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: tokenRow.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("Refresh failed:", t);
        // If Google says the refresh token is dead, clear the stored row so the
        // UI shows a Reconnect button instead of looping on the same error.
        let isInvalidGrant = false;
        try { isInvalidGrant = JSON.parse(t)?.error === "invalid_grant"; } catch { /* noop */ }
        if (isInvalidGrant) {
          await sb.from("ga4_tokens").delete().eq("id", tokenRow.id);
          return json({ error: "GA4 reconnect required", reauth_required: true, detail: t });
        }
        return json({ error: "Token refresh failed", detail: t }, 500);
      }
      const j = await r.json();
      accessToken = j.access_token;
      const newExp = now + (j.expires_in || 3600);
      await sb.from("ga4_tokens").update({ access_token: accessToken, expires_at: newExp })
        .eq("id", tokenRow.id);
    }

    const endDate = "today";
    const startDate = `${days}daysAgo`;

    const runReport = (payload: unknown) =>
      fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}:runReport`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

    // Totals
    const totalsRes = await runReport({
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: "activeUsers" },
        { name: "newUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
        { name: "engagementRate" },
      ],
    });
    if (!totalsRes.ok) {
      const t = await totalsRes.text();
      console.error("GA4 totals error:", t);
      return json({ error: "GA4 API error", detail: t }, 500);
    }
    const totalsJ = await totalsRes.json();
    const tRow = totalsJ.rows?.[0]?.metricValues ?? [];
    const totals = {
      activeUsers: Number(tRow[0]?.value ?? 0),
      newUsers: Number(tRow[1]?.value ?? 0),
      sessions: Number(tRow[2]?.value ?? 0),
      pageViews: Number(tRow[3]?.value ?? 0),
      avgSessionDuration: Number(tRow[4]?.value ?? 0),
      engagementRate: Number(tRow[5]?.value ?? 0),
    };

    // By page
    const pagesRes = await runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "engagementRate" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 25,
    });
    const pagesJ = pagesRes.ok ? await pagesRes.json() : { rows: [] };
    const pages = (pagesJ.rows ?? []).map((r: any) => ({
      path: r.dimensionValues?.[0]?.value ?? "",
      pageViews: Number(r.metricValues?.[0]?.value ?? 0),
      users: Number(r.metricValues?.[1]?.value ?? 0),
      engagementRate: Number(r.metricValues?.[2]?.value ?? 0),
    }));

    // By source
    const sourcesRes = await runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics: [{ name: "sessions" }, { name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 15,
    });
    const sourcesJ = sourcesRes.ok ? await sourcesRes.json() : { rows: [] };
    const sources = (sourcesJ.rows ?? []).map((r: any) => ({
      source: r.dimensionValues?.[0]?.value ?? "",
      medium: r.dimensionValues?.[1]?.value ?? "",
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
      users: Number(r.metricValues?.[1]?.value ?? 0),
    }));

    // By country
    const countriesRes = await runReport({
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "country" }],
      metrics: [{ name: "activeUsers" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      limit: 10,
    });
    const countriesJ = countriesRes.ok ? await countriesRes.json() : { rows: [] };
    const countries = (countriesJ.rows ?? []).map((r: any) => ({
      country: r.dimensionValues?.[0]?.value ?? "",
      users: Number(r.metricValues?.[0]?.value ?? 0),
    }));

    return json({
      range: { days, startDate, endDate },
      totals,
      pages,
      sources,
      countries,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error("ga4-data error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
