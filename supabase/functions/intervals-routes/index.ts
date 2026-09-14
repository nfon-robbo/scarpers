// Backfills GPS routes from Intervals.icu for activities that arrived without
// one (e.g. workouts written into Apple Health by Garmin Connect, which never
// includes route data). Matches by start time and stores an encoded polyline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MATCH_WINDOW_MS = 15 * 60 * 1000;
const RECHECK_AFTER_MS = 7 * 86400_000;
const MAX_LOOKUPS = 25;

function encodeSignedNumber(num: number): string {
  let sgn = num << 1;
  if (num < 0) sgn = ~sgn;
  let out = "";
  while (sgn >= 0x20) {
    out += String.fromCharCode((0x20 | (sgn & 0x1f)) + 63);
    sgn >>= 5;
  }
  out += String.fromCharCode(sgn + 63);
  return out;
}

function encodePolyline(points: Array<[number, number]>): string {
  let lastLat = 0;
  let lastLng = 0;
  let result = "";
  for (const [lat, lng] of points) {
    const eLat = Math.round(lat * 1e5);
    const eLng = Math.round(lng * 1e5);
    result += encodeSignedNumber(eLat - lastLat);
    result += encodeSignedNumber(eLng - lastLng);
    lastLat = eLat;
    lastLng = eLng;
  }
  return result;
}

function hasRoute(raw: any): boolean {
  if (!raw || typeof raw !== "object") return false;
  if (Array.isArray(raw.gps_track) && raw.gps_track.length > 0) return true;
  if (typeof raw.map_polyline === "string" && raw.map_polyline.length > 0) return true;
  return false;
}

function recentlyChecked(raw: any): boolean {
  const at = raw?.route_lookup?.checked_at;
  if (typeof at !== "string") return false;
  const ts = new Date(at).getTime();
  return Number.isFinite(ts) && Date.now() - ts < RECHECK_AFTER_MS;
}

// Intervals.icu exposes the route on /activity/{id}/map as `latlngs`
// (pairs, with nulls where GPS had no fix).
function pointsFromMap(map: any): Array<[number, number]> {
  const list = map?.latlngs;
  if (!Array.isArray(list)) return [];
  const out: Array<[number, number]> = [];
  for (const p of list) {
    if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
      out.push([Number(p[0]), Number(p[1])]);
    }
  }
  return out;
}

function pointsFromStreams(streams: any): Array<[number, number]> {
  const list = Array.isArray(streams) ? streams : streams?.streams;
  if (!Array.isArray(list)) return [];
  const latlng = list.find((s: any) => s?.type === "latlng");
  const out: Array<[number, number]> = [];
  if (Array.isArray(latlng?.data)) {
    for (const p of latlng.data) {
      if (Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
        out.push([Number(p[0]), Number(p[1])]);
      } else if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng ?? p.lon)) {
        out.push([Number(p.lat), Number(p.lng ?? p.lon)]);
      }
    }
    return out;
  }
  const lat = list.find((s: any) => s?.type === "lat");
  const lng = list.find((s: any) => s?.type === "lng" || s?.type === "lon");
  if (Array.isArray(lat?.data) && Array.isArray(lng?.data)) {
    const n = Math.min(lat.data.length, lng.data.length);
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(lat.data[i]) && Number.isFinite(lng.data[i])) {
        out.push([Number(lat.data[i]), Number(lng.data[i])]);
      }
    }
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    const days = Math.min(Math.max(Number(body?.days) || 30, 1), 365);
    const force = body?.force === true;
    const activityIds: string[] | null = Array.isArray(body?.activityIds)
      ? body.activityIds.filter((v: unknown) => typeof v === "string").slice(0, MAX_LOOKUPS)
      : null;

    const { data: creds } = await supabase
      .from("intervals_credentials")
      .select("athlete_id, api_key")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!creds?.athlete_id || !creds?.api_key) {
      return new Response(JSON.stringify({ skipped: "not_connected", updated: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const since = new Date(Date.now() - days * 86400_000);
    let query = supabase
      .from("activities")
      .select("id, start_time, raw_data, latitude, longitude")
      .eq("user_id", user.id)
      .order("start_time", { ascending: false });
    if (activityIds) query = query.in("id", activityIds);
    else query = query.gte("start_time", since.toISOString());

    const { data: rows, error } = await query;
    if (error) throw error;

    const pending = (rows ?? [])
      .filter((a) => a.start_time && !hasRoute(a.raw_data))
      .filter((a) => force || !recentlyChecked(a.raw_data))
      .slice(0, MAX_LOOKUPS);

    if (pending.length === 0) {
      return new Response(JSON.stringify({ updated: 0, checked: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const times = pending.map((a) => new Date(a.start_time as string).getTime());
    const oldest = new Date(Math.min(...times) - 86400_000).toISOString().slice(0, 10);
    const newest = new Date(Math.max(...times) + 86400_000).toISOString().slice(0, 10);

    const basicAuth = btoa(`API_KEY:${creds.api_key}`);
    const headers = { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/json" };
    const baseUrl = `https://intervals.icu/api/v1/athlete/${creds.athlete_id}`;

    const listResp = await fetch(`${baseUrl}/activities?oldest=${oldest}&newest=${newest}`, { headers });
    if (!listResp.ok) {
      const text = await listResp.text();
      console.error(`Intervals.icu activities failed [${listResp.status}]: ${text}`);
      return new Response(
        JSON.stringify({ error: "Intervals.icu request failed", status: listResp.status, details: text }),
        { status: listResp.status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const remote = await listResp.json();
    const remoteList: any[] = Array.isArray(remote) ? remote : [];

    let updated = 0;
    let noRoute = 0;

    for (const activity of pending) {
      const startMs = new Date(activity.start_time as string).getTime();
      let best: any = null;
      let bestDelta = Infinity;
      for (const r of remoteList) {
        const rs = r?.start_date_local || r?.start_date;
        if (!rs) continue;
        // start_date_local has no timezone marker; treat as the same wall clock.
        const rMs = new Date(r?.start_date || `${rs}Z`).getTime();
        if (!Number.isFinite(rMs)) continue;
        const delta = Math.abs(rMs - startMs);
        if (delta < bestDelta) { bestDelta = delta; best = r; }
      }

      let points: Array<[number, number]> = [];
      if (best && bestDelta <= MATCH_WINDOW_MS) {
        const apiRoot = baseUrl.replace(/\/athlete\/.*$/, "");
        try {
          const mapResp = await fetch(`${apiRoot}/activity/${best.id}/map`, { headers });
          if (mapResp.ok) points = pointsFromMap(await mapResp.json());
          else console.error(`Map failed for ${best.id} [${mapResp.status}]`);
        } catch (e) {
          console.error("Map fetch error", e);
        }
        if (points.length < 2) {
          try {
            const streamResp = await fetch(`${apiRoot}/activity/${best.id}/streams?types=lat,lng`, { headers });
            if (streamResp.ok) points = pointsFromStreams(await streamResp.json());
          } catch (e) {
            console.error("Stream fetch error", e);
          }
        }
      }

      const raw = (activity.raw_data && typeof activity.raw_data === "object") ? { ...activity.raw_data as any } : {};

      if (points.length >= 2) {
        raw.map_polyline = encodePolyline(points);
        raw.gps_track_source = "intervals.icu";
        raw.route_lookup = { checked_at: new Date().toISOString(), result: "found", source: "intervals.icu" };
        await supabase
          .from("activities")
          .update({
            raw_data: raw,
            latitude: activity.latitude ?? points[0][0],
            longitude: activity.longitude ?? points[0][1],
          })
          .eq("id", activity.id)
          .eq("user_id", user.id);
        updated++;
      } else {
        raw.route_lookup = { checked_at: new Date().toISOString(), result: "none" };
        await supabase
          .from("activities")
          .update({ raw_data: raw })
          .eq("id", activity.id)
          .eq("user_id", user.id);
        noRoute++;
      }
    }

    console.log(`Route backfill: ${updated} updated, ${noRoute} without route`);

    return new Response(JSON.stringify({ updated, checked: pending.length, noRoute }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("intervals-routes error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
