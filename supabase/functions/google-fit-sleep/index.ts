import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Google Fit sleep stage type mappings
const SLEEP_STAGE_MAP: Record<number, string> = {
  1: "awake",
  2: "sleep",   // generic sleep - treat as light
  3: "out_of_bed",
  4: "light",
  5: "deep",
  6: "rem",
};

async function refreshAccessToken(
  supabase: any,
  userId: string,
  refreshToken: string
): Promise<string> {
  const GOOGLE_FIT_CLIENT_ID = Deno.env.get("GOOGLE_FIT_CLIENT_ID")!;
  const GOOGLE_FIT_CLIENT_SECRET = Deno.env.get("GOOGLE_FIT_CLIENT_SECRET")!;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_FIT_CLIENT_ID,
      client_secret: GOOGLE_FIT_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${err}`);
  }

  const data = await res.json();
  const expiresAt = Math.floor(Date.now() / 1000) + (data.expires_in || 3600);

  await supabase.from("google_fit_tokens").update({
    access_token: data.access_token,
    expires_at: expiresAt,
  }).eq("user_id", userId);

  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get tokens
    const { data: tokenRow } = await supabase
      .from("google_fit_tokens")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!tokenRow) {
      return new Response(JSON.stringify({ error: "Google Fit not connected" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh if expired
    let accessToken = tokenRow.access_token;
    const now = Math.floor(Date.now() / 1000);
    if (tokenRow.expires_at < now + 60) {
      accessToken = await refreshAccessToken(supabase, user.id, tokenRow.refresh_token);
    }

    // Fetch sleep sessions for the last 30 days
    const endTimeMillis = Date.now();
    const startTimeMillis = endTimeMillis - 30 * 24 * 60 * 60 * 1000;

    const sessionsRes = await fetch(
      `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${new Date(startTimeMillis).toISOString()}&endTime=${new Date(endTimeMillis).toISOString()}&activityType=72`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!sessionsRes.ok) {
      const err = await sessionsRes.text();
      console.error("Google Fit sessions error:", err);
      return new Response(JSON.stringify({ error: "Failed to fetch sleep sessions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionsData = await sessionsRes.json();
    const sessions = sessionsData.session || [];

    let totalStages = 0;

    for (const session of sessions) {
      const sessionStart = parseInt(session.startTimeMillis);
      const sessionEnd = parseInt(session.endTimeMillis);
      
      // Determine the date (use the end time's date as the "sleep night" date)
      const sleepDate = new Date(sessionEnd).toISOString().split("T")[0];

      // Fetch sleep segment data for this session
      const datasetRes = await fetch(
        `https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            aggregateBy: [
              {
                dataTypeName: "com.google.sleep.segment",
              },
            ],
            startTimeMillis: sessionStart,
            endTimeMillis: sessionEnd,
          }),
        }
      );

      if (!datasetRes.ok) {
        console.error("Failed to fetch sleep segments for session", session.id);
        continue;
      }

      const datasetData = await datasetRes.json();

      // Delete old data for this date before inserting
      await supabase
        .from("sleep_stages")
        .delete()
        .eq("user_id", user.id)
        .eq("date", sleepDate)
        .eq("source", "google_fit");

      const buckets = datasetData.bucket || [];
      for (const bucket of buckets) {
        for (const dataset of bucket.dataset || []) {
          for (const point of dataset.point || []) {
            const startNanos = parseInt(point.startTimeNanos);
            const endNanos = parseInt(point.endTimeNanos);
            const stageType = point.value?.[0]?.intVal;

            if (stageType == null) continue;

            const stageName = SLEEP_STAGE_MAP[stageType];
            if (!stageName || stageName === "out_of_bed") continue;

            // Normalize "sleep" to "light"
            const normalizedStage = stageName === "sleep" ? "light" : stageName;
            const durationSeconds = Math.round((endNanos - startNanos) / 1e9);

            await supabase.from("sleep_stages").insert({
              user_id: user.id,
              date: sleepDate,
              stage: normalizedStage,
              duration_seconds: durationSeconds,
              start_time: new Date(startNanos / 1e6).toISOString(),
              end_time: new Date(endNanos / 1e6).toISOString(),
              source: "google_fit",
            });

            totalStages++;
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ synced: totalStages, sessions: sessions.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Google Fit sleep error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
