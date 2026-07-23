// Lazy Strava lap fetcher.
//
// Called only when the caller (e.g. benchmark candidate evaluator) wants
// lap-level detail for a single activity. Never invoked from the normal
// activity import path.
//
// Responsibility is narrow: fetch laps, cache them in activity_laps
// (source='strava'), and report status. This function does NOT decide the
// effort window and does NOT write anything to public.activities. The
// benchmark evaluator inspects the returned laps and writes
// effort_window_source on the benchmark_results row.
//
// Behaviour:
//   1. Cache hit — return existing rows from activity_laps.
//   2. Otherwise refresh token, GET /activities/:id/laps, read
//      X-ReadRateLimit-Usage / -Limit, flag budgetLow when remaining < 10 on
//      either window.
//   3. On any non-2xx (rate-limit, 4xx, 5xx) return { ok:false, reason }
//      with an empty laps array. Caller falls back to its pace-based
//      detector and records the reason on its own row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MIN_BUDGET = 10;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseUsageHeaders(res: Response): { shortRemaining: number | null; longRemaining: number | null } {
  const usage = res.headers.get("x-readratelimit-usage") ?? res.headers.get("x-ratelimit-usage");
  const limit = res.headers.get("x-readratelimit-limit") ?? res.headers.get("x-ratelimit-limit");
  if (!usage || !limit) return { shortRemaining: null, longRemaining: null };
  const [uS, uL] = usage.split(",").map((n) => parseInt(n.trim(), 10));
  const [lS, lL] = limit.split(",").map((n) => parseInt(n.trim(), 10));
  return {
    shortRemaining: Number.isFinite(uS) && Number.isFinite(lS) ? lS - uS : null,
    longRemaining: Number.isFinite(uL) && Number.isFinite(lL) ? lL - uL : null,
  };
}

async function refreshTokenIfNeeded(supabase: any, userId: string, tokens: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at > now + 60) return tokens.access_token;
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: Deno.env.get("STRAVA_CLIENT_ID"),
      client_secret: Deno.env.get("STRAVA_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`STRAVA_TOKEN_REFRESH_FAILED:${await res.text()}`);
  const data = await res.json();
  await supabase.from("strava_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  }).eq("user_id", userId);
  return data.access_token;
}

// NOTE: intentionally no stampFallback helper. This function must not write
// to public.activities. Callers own the effort_window_source decision.



function mapStravaLap(lap: any, idx: number) {
  return {
    lap_index: typeof lap.lap_index === "number" ? lap.lap_index - 1 : idx,
    start_time: lap.start_date ?? null,
    elapsed_time_s: lap.elapsed_time ?? null,
    moving_time_s: lap.moving_time ?? null,
    distance_m: lap.distance ?? null,
    avg_heart_rate: lap.average_heartrate ?? null,
    max_heart_rate: lap.max_heartrate ?? null,
    avg_speed_mps: lap.average_speed ?? null,
    max_speed_mps: lap.max_speed ?? null,
    avg_cadence: lap.average_cadence ?? null,
    avg_power: lap.average_watts ?? null,
    max_power: null,
    total_ascent_m: lap.total_elevation_gain ?? null,
    total_descent_m: null,
    lap_trigger: lap.lap_index != null ? "manual_or_auto" : null,
    raw: lap,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json(401, { error: "Not authenticated" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (userError || !user) return json(401, { error: "Invalid token" });

    const body = await req.json().catch(() => ({}));
    const activityId: string | undefined = body.activity_id;
    if (!activityId) return json(400, { error: "activity_id required" });

    // Load the activity and confirm ownership.
    const { data: activity, error: actErr } = await supabase
      .from("activities")
      .select("id, user_id, source_file, raw_data")
      .eq("id", activityId)
      .single();
    if (actErr || !activity || activity.user_id !== user.id) {
      return json(404, { error: "Activity not found" });
    }

    // 1. Cache hit — return existing Strava laps without touching Strava.
    const { data: cached } = await supabase
      .from("activity_laps")
      .select("*")
      .eq("activity_id", activityId)
      .eq("source", "strava")
      .order("lap_index", { ascending: true });
    if (cached && cached.length > 0) {
      return json(200, { ok: true, cached: true, laps: cached });
    }

    // Resolve Strava activity id.
    const rawStravaId =
      (activity.raw_data as any)?.strava_id ??
      (typeof activity.source_file === "string" && activity.source_file.startsWith("strava:")
        ? activity.source_file.slice(7)
        : null);
    if (!rawStravaId) {
      return json(200, { ok: false, reason: "no_strava_id", laps: [] });
    }

    // 2. Get tokens.
    const { data: tokens, error: tokErr } = await supabase
      .from("strava_tokens")
      .select("*")
      .eq("user_id", user.id)
      .single();
    if (tokErr || !tokens) {
      return json(200, { ok: false, reason: "strava_not_connected", laps: [] });
    }

    let accessToken: string;
    try {
      accessToken = await refreshTokenIfNeeded(supabase, user.id, tokens);
    } catch (e: any) {
      return json(200, { ok: false, reason: "token_refresh_failed", detail: e.message, laps: [] });
    }

    // 3. Call Strava.
    const url = `https://www.strava.com/api/v3/activities/${rawStravaId}/laps`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const { shortRemaining, longRemaining } = parseUsageHeaders(res);

    // Rate-limit short-circuit — even on success, if we're running dry we
    // signal the caller to stop scheduling further lap calls this window.
    const budgetLow =
      (shortRemaining !== null && shortRemaining < MIN_BUDGET) ||
      (longRemaining !== null && longRemaining < MIN_BUDGET);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return json(200, {
        ok: false,
        reason: res.status === 429 ? "rate_limited" : "strava_error",
        status: res.status,
        detail: errText.slice(0, 200),
        rate_limit: { shortRemaining, longRemaining, budgetLow: true },
        laps: [],
      });
    }

    const stravaLaps: any[] = await res.json();
    const mapped = stravaLaps.map(mapStravaLap);

    // 4. Cache in activity_laps.
    if (mapped.length > 0) {
      const rows = mapped.map((lap) => ({
        user_id: user.id,
        activity_id: activityId,
        source: "strava",
        ...lap,
      }));
      const { error: insErr } = await supabase.from("activity_laps").insert(rows);
      if (insErr) console.warn("activity_laps insert warning:", insErr);
    }

    return json(200, {
      ok: true,
      cached: false,
      laps: mapped,
      rate_limit: { shortRemaining, longRemaining, budgetLow },
    });

  } catch (e: any) {
    console.error("strava-fetch-laps error:", e);
    return json(500, { error: e.message || String(e) });
  }
});
