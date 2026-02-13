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

function mapStravaActivity(sa: any) {
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
    avg_speed: sa.average_speed ? sa.average_speed * 3.6 : null, // m/s → km/h
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

    const accessToken = await refreshTokenIfNeeded(supabase, user.id, tokens);

    // Get request params
    const body = await req.json().catch(() => ({}));
    const page = body.page || 1;
    const perPage = body.per_page || 50;
    const after = body.after; // unix timestamp

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

    // Check for duplicates by source_file
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

    // Create upload record
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

      // Insert in batches
      const batchSize = 50;
      for (let i = 0; i < newActivities.length; i += batchSize) {
        const batch = newActivities.slice(i, i + batchSize).map((a: any) => ({
          user_id: user.id,
          upload_id: uploadId,
          ...mapStravaActivity(a),
        }));
        const { error: insertErr } = await supabase.from("activities").insert(batch);
        if (insertErr) {
          console.error("Insert error:", insertErr);
          throw new Error(`Failed to insert activities: ${insertErr.message}`);
        }
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
