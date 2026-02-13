import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function refreshTokenIfNeeded(
  supabase: any,
  userId: string,
  tokens: any
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at > now + 60) {
    return tokens.access_token;
  }

  const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID")!;
  const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET")!;

  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: STRAVA_CLIENT_ID,
      client_secret: STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${await res.text()}`);
  }

  const data = await res.json();
  await supabase
    .from("strava_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at,
    })
    .eq("user_id", userId);

  return data.access_token;
}

async function fetchStreams(activityId: number, accessToken: string) {
  const streamTypes = "time,latlng,heartrate,altitude,velocity_smooth,watts,cadence,temp";
  const url = `https://www.strava.com/api/v3/activities/${activityId}/streams?keys=${streamTypes}&key_type=time`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    // 404 means no streams available (e.g. manual activity)
    if (res.status === 404) return null;
    // Rate limited — wait and retry once
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("Retry-After") || "15", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      const retry = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!retry.ok) return null;
      return await retry.json();
    }
    console.error(`Streams fetch failed for ${activityId}: ${res.status}`);
    return null;
  }

  return await res.json();
}

function buildGpsTrack(streams: any[]) {
  const timeStream = streams.find((s: any) => s.type === "time");
  const latlngStream = streams.find((s: any) => s.type === "latlng");
  const hrStream = streams.find((s: any) => s.type === "heartrate");
  const altStream = streams.find((s: any) => s.type === "altitude");
  const speedStream = streams.find((s: any) => s.type === "velocity_smooth");
  const powerStream = streams.find((s: any) => s.type === "watts");
  const cadenceStream = streams.find((s: any) => s.type === "cadence");
  const tempStream = streams.find((s: any) => s.type === "temp");

  if (!timeStream) return null;

  const len = timeStream.data.length;
  const track: any[] = [];

  for (let i = 0; i < len; i++) {
    const point: any = {
      elapsed_time: timeStream.data[i],
    };

    if (latlngStream?.data[i]) {
      point.lat = latlngStream.data[i][0];
      point.lon = latlngStream.data[i][1];
    }
    if (hrStream?.data[i] != null) point.heart_rate = hrStream.data[i];
    if (altStream?.data[i] != null) point.altitude = altStream.data[i];
    if (speedStream?.data[i] != null) point.speed = speedStream.data[i] * 3.6; // m/s → km/h
    if (powerStream?.data[i] != null) point.power = powerStream.data[i];
    if (cadenceStream?.data[i] != null) point.cadence = cadenceStream.data[i];
    if (tempStream?.data[i] != null) point.temperature = tempStream.data[i];

    track.push(point);
  }

  return track;
}

function mapStravaActivity(sa: any, gpsTrack: any[] | null) {
  const sportMap: Record<string, string> = {
    Run: "running",
    Ride: "cycling",
    Swim: "swimming",
    Walk: "walking",
    Hike: "hiking",
    VirtualRun: "running",
    VirtualRide: "cycling",
    TrailRun: "trail_running",
  };

  return {
    activity_type: sportMap[sa.type] || sa.type?.toLowerCase() || "other",
    start_time: sa.start_date,
    duration_seconds: sa.elapsed_time,
    distance_meters: sa.distance,
    avg_heart_rate: sa.average_heartrate || null,
    max_heart_rate: sa.max_heartrate || null,
    avg_speed: sa.average_speed ? sa.average_speed * 3.6 : null,
    max_speed: sa.max_speed ? sa.max_speed * 3.6 : null,
    avg_power: sa.average_watts || null,
    max_power: sa.max_watts || null,
    avg_cadence: sa.average_cadence || null,
    total_ascent: sa.total_elevation_gain || null,
    total_descent: null,
    calories: sa.kilojoules ? Math.round(sa.kilojoules * 0.239) : null,
    avg_temperature: sa.average_temp || null,
    training_effect: null,
    training_load: sa.suffer_score || null,
    source_file: `strava:${sa.id}`,
    raw_data: {
      strava_id: sa.id,
      name: sa.name,
      type: sa.type,
      sport_type: sa.sport_type,
      start_latlng: sa.start_latlng,
      end_latlng: sa.end_latlng,
      map_polyline: sa.map?.summary_polyline || null,
      gps_track: gpsTrack,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tokens
    const { data: tokens, error: tokErr } = await supabase
      .from("strava_tokens")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (tokErr || !tokens) {
      return new Response(JSON.stringify({ error: "Strava not connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let accessToken = await refreshTokenIfNeeded(supabase, user.id, tokens);

    // Get request params
    const body = await req.json().catch(() => ({}));
    const page = body.page || 1;
    const perPage = body.per_page || 30; // Reduced to allow time for stream fetches
    const after = body.after;

    // Fetch activities from Strava
    let stravaUrl = `https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`;
    if (after) stravaUrl += `&after=${after}`;

    const stravaRes = await fetch(stravaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!stravaRes.ok) {
      const errText = await stravaRes.text();
      throw new Error(`Strava API error [${stravaRes.status}]: ${errText}`);
    }

    const stravaActivities = await stravaRes.json();

    if (!stravaActivities.length) {
      return new Response(
        JSON.stringify({ imported: 0, total_fetched: 0, has_more: false }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for duplicates
    const stravaIds = stravaActivities.map((a: any) => `strava:${a.id}`);
    const { data: existing } = await supabase
      .from("activities")
      .select("source_file")
      .eq("user_id", user.id)
      .in("source_file", stravaIds);

    const existingSet = new Set((existing || []).map((e: any) => e.source_file));
    const newActivities = stravaActivities.filter(
      (a: any) => !existingSet.has(`strava:${a.id}`)
    );

    // Create upload record and fetch streams + insert one by one
    let uploadId: string | null = null;
    if (newActivities.length > 0) {
      const { data: upload } = await supabase
        .from("uploads")
        .insert({
          user_id: user.id,
          file_name: "Strava Import",
          file_type: "strava",
          record_count: newActivities.length,
          status: "completed",
        })
        .select("id")
        .single();

      uploadId = upload?.id;

      // Process each activity: fetch streams then insert
      for (const sa of newActivities) {
        let gpsTrack: any[] | null = null;
        try {
          const streams = await fetchStreams(sa.id, accessToken);
          if (streams && Array.isArray(streams)) {
            gpsTrack = buildGpsTrack(streams);
          }
        } catch (e) {
          console.error(`Failed to fetch streams for ${sa.id}:`, e);
        }

        const mapped = mapStravaActivity(sa, gpsTrack);
        const { error: insertErr } = await supabase.from("activities").insert({
          user_id: user.id,
          upload_id: uploadId,
          ...mapped,
        });

        if (insertErr) {
          console.error(`Insert error for ${sa.id}:`, insertErr);
        }

        // Small delay to respect Strava rate limits (100 requests per 15 min)
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return new Response(
      JSON.stringify({
        imported: newActivities.length,
        skipped: stravaActivities.length - newActivities.length,
        total_fetched: stravaActivities.length,
        has_more: stravaActivities.length === perPage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Strava import error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
