import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Google Fit sleep stage mappings
const SLEEP_STAGE_MAP: Record<number, string> = {
  1: "awake",
  2: "sleep",
  3: "out_of_bed",
  4: "light",
  5: "deep",
  6: "rem",
};

async function refreshStravaToken(supabase: any, userId: string, tokens: any): Promise<string> {
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
  if (!res.ok) throw new Error(`Strava token refresh failed: ${await res.text()}`);
  const data = await res.json();
  await supabase.from("strava_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  }).eq("user_id", userId);
  return data.access_token;
}

async function refreshGoogleFitToken(supabase: any, userId: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_FIT_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_FIT_CLIENT_SECRET")!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google Fit token refresh failed: ${await res.text()}`);
  const data = await res.json();
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);
  await supabase.from("google_fit_tokens").update({
    access_token: data.access_token,
    expires_at: expiresAt,
  }).eq("user_id", userId);
  return data.access_token;
}

// --- Strava sync for a single user ---
async function syncStravaForUser(supabase: any, userId: string, tokens: any) {
  const accessToken = await refreshStravaToken(supabase, userId, tokens);
  const after = Math.floor((Date.now() - 7 * 86400000) / 1000); // last 7 days
  const stravaRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=30&after=${after}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!stravaRes.ok) throw new Error(`Strava API error: ${stravaRes.status}`);
  const activities = await stravaRes.json();

  const sportMap: Record<string, string> = {
    Run: "running", Ride: "cycling", Swim: "swimming", Walk: "walking",
    Hike: "hiking", VirtualRun: "running", VirtualRide: "cycling", TrailRun: "trail_running",
  };

  const stravaIds = activities.map((a: any) => `strava:${a.id}`);
  const { data: existing } = await supabase.from("activities").select("source_file")
    .eq("user_id", userId).in("source_file", stravaIds);
  const existingSet = new Set((existing || []).map((e: any) => e.source_file));

  let imported = 0;
  for (const sa of activities) {
    if (existingSet.has(`strava:${sa.id}`)) continue;
    await supabase.from("activities").insert({
      user_id: userId,
      activity_type: sportMap[sa.type] || sa.type?.toLowerCase() || "other",
      start_time: sa.start_date,
      duration_seconds: sa.elapsed_time,
      distance_meters: sa.distance,
      avg_heart_rate: sa.average_heartrate || null,
      max_heart_rate: sa.max_heartrate || null,
      avg_speed: sa.average_speed ? sa.average_speed * 3.6 : null,
      max_speed: sa.max_speed ? sa.max_speed * 3.6 : null,
      avg_power: sa.average_watts || null,
      avg_cadence: sa.average_cadence || null,
      total_ascent: sa.total_elevation_gain || null,
      calories: sa.kilojoules ? Math.round(sa.kilojoules * 0.239) : null,
      avg_temperature: sa.average_temp || null,
      training_load: sa.suffer_score || null,
      source_file: `strava:${sa.id}`,
      raw_data: { strava_id: sa.id, name: sa.name, type: sa.type },
    });
    imported++;
    await new Promise((r) => setTimeout(r, 200));
  }
  return imported;
}

// --- Intervals.icu wellness sync for a single user ---
async function syncIntervalsForUser(supabase: any, userId: string) {
  const { data: creds } = await supabase
    .from("intervals_credentials")
    .select("athlete_id, api_key")
    .eq("user_id", userId)
    .maybeSingle();
  if (!creds?.athlete_id || !creds?.api_key) return 0;

  const newest = new Date().toISOString().split("T")[0];
  const oldest = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];
  const basicAuth = btoa(`API_KEY:${creds.api_key}`);

  const resp = await fetch(
    `https://intervals.icu/api/v1/athlete/${creds.athlete_id}/wellness?oldest=${oldest}&newest=${newest}`,
    { headers: { Authorization: `Basic ${basicAuth}`, "Content-Type": "application/json" } }
  );
  if (!resp.ok) throw new Error(`Intervals.icu API error: ${resp.status}`);
  const wellnessData = await resp.json();

  let upserted = 0;
  for (const w of wellnessData) {
    if (!w.id) continue;
    const record: Record<string, unknown> = { user_id: userId, date: w.id, source_file: "intervals.icu" };
    if (w.sleepSecs != null) record.sleep_duration_seconds = w.sleepSecs;
    if (w.sleepScore != null) record.sleep_score = w.sleepScore;
    if (w.hrv != null) record.hrv = w.hrv;
    else if (w.hrvSDNN != null) record.hrv = w.hrvSDNN;
    if (w.restingHR != null) record.resting_heart_rate = w.restingHR;
    if (w.weight != null) record.weight = w.weight;
    if (w.steps != null) record.steps = w.steps;
    if (w.stress != null) record.stress_score = w.stress;
    if (w.bodyFat != null) record.body_fat_percentage = w.bodyFat;
    if (w.calories != null) record.calories_total = w.calories;

    const hasData = Object.keys(record).some(
      (k) => !["user_id", "date", "source_file"].includes(k) && record[k] != null
    );
    if (!hasData) continue;

    const { data: existing } = await supabase.from("daily_metrics").select("id")
      .eq("user_id", userId).eq("date", w.id).maybeSingle();
    if (existing) {
      await supabase.from("daily_metrics").update(record).eq("id", existing.id);
    } else {
      await supabase.from("daily_metrics").insert(record);
    }
    upserted++;
  }
  return upserted;
}

// --- Google Fit sleep sync for a single user ---
async function syncGoogleFitSleepForUser(supabase: any, userId: string, tokenRow: any) {
  let accessToken = tokenRow.access_token;
  const now = Math.floor(Date.now() / 1000);
  if (tokenRow.expires_at < now + 60) {
    accessToken = await refreshGoogleFitToken(supabase, userId, tokenRow.refresh_token);
  }

  const endTimeMillis = Date.now();
  const startTimeMillis = endTimeMillis - 30 * 24 * 60 * 60 * 1000;

  const sessionsRes = await fetch(
    `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${new Date(startTimeMillis).toISOString()}&endTime=${new Date(endTimeMillis).toISOString()}&activityType=72`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!sessionsRes.ok) throw new Error(`Google Fit sessions error: ${sessionsRes.status}`);
  const sessionsData = await sessionsRes.json();
  const sessions = sessionsData.session || [];

  let totalStages = 0;
  for (const session of sessions) {
    const sessionStart = parseInt(session.startTimeMillis);
    const sessionEnd = parseInt(session.endTimeMillis);
    const sleepDate = new Date(sessionEnd).toISOString().split("T")[0];

    const datasetRes = await fetch(
      "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          aggregateBy: [{ dataTypeName: "com.google.sleep.segment" }],
          startTimeMillis: sessionStart,
          endTimeMillis: sessionEnd,
        }),
      }
    );
    if (!datasetRes.ok) continue;
    const datasetData = await datasetRes.json();

    await supabase.from("sleep_stages").delete()
      .eq("user_id", userId).eq("date", sleepDate).eq("source", "google_fit");

    for (const bucket of datasetData.bucket || []) {
      for (const dataset of bucket.dataset || []) {
        for (const point of dataset.point || []) {
          const startNanos = parseInt(point.startTimeNanos);
          const endNanos = parseInt(point.endTimeNanos);
          const stageType = point.value?.[0]?.intVal;
          if (stageType == null) continue;
          const stageName = SLEEP_STAGE_MAP[stageType];
          if (!stageName || stageName === "out_of_bed") continue;
          const normalizedStage = stageName === "sleep" ? "light" : stageName;
          await supabase.from("sleep_stages").insert({
            user_id: userId, date: sleepDate, stage: normalizedStage,
            duration_seconds: Math.round((endNanos - startNanos) / 1e9),
            start_time: new Date(startNanos / 1e6).toISOString(),
            end_time: new Date(endNanos / 1e6).toISOString(),
            source: "google_fit",
          });
          totalStages++;
        }
      }
    }
  }
  return totalStages;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const syncType = body.type as string; // "strava" | "intervals-wellness" | "google-fit-sleep"

    if (!syncType) {
      return new Response(JSON.stringify({ error: "Missing 'type' parameter" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all enabled schedules for this sync type
    const { data: schedules, error: schedErr } = await supabase
      .from("sync_schedules")
      .select("*");

    if (schedErr) throw new Error(`Failed to fetch schedules: ${schedErr.message}`);

    const results: { user_id: string; status: string; detail?: string }[] = [];
    const now = new Date();

    for (const sched of schedules || []) {
      try {
        if (syncType === "strava" && sched.strava_enabled) {
          // Check if enough time has passed since last sync
          const lastSync = sched.last_strava_sync ? new Date(sched.last_strava_sync) : null;
          const intervalMs = sched.strava_interval_hours * 3600000;
          if (lastSync && (now.getTime() - lastSync.getTime()) < intervalMs) {
            results.push({ user_id: sched.user_id, status: "skipped", detail: "too soon" });
            continue;
          }

          const { data: tokens } = await supabase.from("strava_tokens").select("*")
            .eq("user_id", sched.user_id).maybeSingle();
          if (!tokens) { results.push({ user_id: sched.user_id, status: "skipped", detail: "no tokens" }); continue; }

          const imported = await syncStravaForUser(supabase, sched.user_id, tokens);
          await supabase.from("sync_schedules").update({ last_strava_sync: now.toISOString() }).eq("user_id", sched.user_id);
          results.push({ user_id: sched.user_id, status: "ok", detail: `${imported} imported` });

        } else if (syncType === "intervals-wellness" && sched.intervals_enabled) {
          const lastSync = sched.last_intervals_sync ? new Date(sched.last_intervals_sync) : null;
          const intervalMs = sched.intervals_interval_hours * 3600000;
          if (lastSync && (now.getTime() - lastSync.getTime()) < intervalMs) {
            results.push({ user_id: sched.user_id, status: "skipped", detail: "too soon" });
            continue;
          }

          const upserted = await syncIntervalsForUser(supabase, sched.user_id);
          await supabase.from("sync_schedules").update({ last_intervals_sync: now.toISOString() }).eq("user_id", sched.user_id);
          results.push({ user_id: sched.user_id, status: "ok", detail: `${upserted} upserted` });

        } else if (syncType === "google-fit-sleep" && sched.google_fit_enabled) {
          // Check if it's the right hour (UTC)
          const currentHourUtc = now.getUTCHours();
          if (currentHourUtc !== sched.google_fit_hour_utc) {
            results.push({ user_id: sched.user_id, status: "skipped", detail: "not scheduled hour" });
            continue;
          }

          const { data: tokenRow } = await supabase.from("google_fit_tokens").select("*")
            .eq("user_id", sched.user_id).maybeSingle();
          if (!tokenRow) { results.push({ user_id: sched.user_id, status: "skipped", detail: "no tokens" }); continue; }

          const totalStages = await syncGoogleFitSleepForUser(supabase, sched.user_id, tokenRow);
          await supabase.from("sync_schedules").update({ last_google_fit_sync: now.toISOString() }).eq("user_id", sched.user_id);
          results.push({ user_id: sched.user_id, status: "ok", detail: `${totalStages} stages` });
        }
      } catch (e) {
        console.error(`Auto-sync error for user ${sched.user_id}:`, e);
        results.push({ user_id: sched.user_id, status: "error", detail: e.message });
      }
    }

    return new Response(JSON.stringify({ type: syncType, results }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("auto-sync error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
