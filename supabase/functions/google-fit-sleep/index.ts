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
    const normalized = err.toLowerCase();

    // User revoked/expired refresh token
    if (normalized.includes("invalid_grant") && normalized.includes("expired or revoked")) {
      throw new Error("GOOGLE_FIT_USER_TOKEN_INVALID");
    }

    // App/client credentials misconfigured
    if (normalized.includes("invalid_client") || normalized.includes("unauthorized_client")) {
      throw new Error("GOOGLE_FIT_APP_CREDENTIALS_INVALID");
    }

    throw new Error(`GOOGLE_FIT_TOKEN_REFRESH_FAILED:${err}`);
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

  let daysBack = 7; // default
  try {
    const body = await req.clone().json();
    if (body?.days) daysBack = Math.min(body.days, 30);
  } catch { /* no body, use default */ }

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

    // Fetch sleep sessions
    const endTimeMillis = Date.now();
    const startTimeMillis = endTimeMillis - daysBack * 24 * 60 * 60 * 1000;

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
    console.log(`Google Fit: found ${sessions.length} sleep sessions in last ${daysBack} days`);
    if (sessions.length === 0) {
      console.log(`Google Fit API query: startTime=${new Date(startTimeMillis).toISOString()}, endTime=${new Date(endTimeMillis).toISOString()}, activityType=72`);
      console.log(`Google Fit raw response keys:`, Object.keys(sessionsData));
      if (sessionsData.deletedSession) console.log(`Google Fit: ${sessionsData.deletedSession.length} deleted sessions found`);
    }

    let totalStages = 0;
    // Aggregate per-date totals so we can also update daily_metrics
    const dailyTotals: Record<string, { deep: number; rem: number; light: number; awake: number; sleep: number }> = {};
    const addStage = (date: string, stage: string, secs: number) => {
      if (!dailyTotals[date]) dailyTotals[date] = { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 };
      const t = dailyTotals[date] as any;
      if (stage in t) t[stage] += secs;
    };

    for (const session of sessions) {
      const sessionStart = parseInt(session.startTimeMillis);
      const sessionEnd = parseInt(session.endTimeMillis);
      
      // Determine the date (use the end time's date as the "sleep night" date)
      const sleepDate = new Date(sessionEnd).toISOString().split("T")[0];
      console.log(`Processing session: ${session.id}, date: ${sleepDate}, start: ${new Date(sessionStart).toISOString()}, end: ${new Date(sessionEnd).toISOString()}`);

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
              { dataTypeName: "com.google.sleep.segment" },
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
      let sessionStages = 0;

      for (const bucket of buckets) {
        for (const dataset of bucket.dataset || []) {
          for (const point of dataset.point || []) {
            const startNanos = parseInt(point.startTimeNanos);
            const endNanos = parseInt(point.endTimeNanos);
            const stageType = point.value?.[0]?.intVal;

            if (stageType == null) continue;

            const stageName = SLEEP_STAGE_MAP[stageType];
            if (!stageName || stageName === "out_of_bed") continue;

            // Keep "sleep" as-is (generic sleep without stage breakdown)
            const normalizedStage = stageName;
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

            sessionStages++;
            totalStages++;
            addStage(sleepDate, normalizedStage, durationSeconds);
          }
        }
      }

      // Fallback: if no granular stage data, create a single "sleep" entry
      // from the session itself so we at least capture total sleep time
      if (sessionStages === 0) {
        const durationSeconds = Math.round((sessionEnd - sessionStart) / 1000);
        console.log(`No stage data for session ${session.id}, creating fallback entry (${durationSeconds}s)`);
        await supabase.from("sleep_stages").insert({
          user_id: user.id,
          date: sleepDate,
          stage: "sleep",
          duration_seconds: durationSeconds,
          start_time: new Date(sessionStart).toISOString(),
          end_time: new Date(sessionEnd).toISOString(),
          source: "google_fit",
        });
        totalStages++;
        addStage(sleepDate, "sleep", durationSeconds);
      }
    }

    // Upsert daily_metrics totals (deep/rem/light/awake minutes + total duration)
    for (const [date, t] of Object.entries(dailyTotals)) {
      const totalSecs = t.deep + t.rem + t.light + t.sleep;
      const { data: existing } = await supabase
        .from("daily_metrics")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", date)
        .maybeSingle();

      const payload = {
        user_id: user.id,
        date,
        deep_sleep_minutes: Math.round(t.deep / 60),
        rem_sleep_minutes: Math.round(t.rem / 60),
        light_sleep_minutes: Math.round((t.light + t.sleep) / 60),
        awake_during_night_minutes: Math.round(t.awake / 60),
        sleep_duration_seconds: totalSecs,
      };

      if (existing) {
        await supabase.from("daily_metrics").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("daily_metrics").insert(payload);
      }
    }

    console.log(`Google Fit sleep sync complete: ${totalStages} stages from ${sessions.length} sessions, ${Object.keys(dailyTotals).length} daily_metrics rows updated`);
    return new Response(
      JSON.stringify({ synced: totalStages, sessions: sessions.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    let status = 500;
    let clientError = "Google Fit sleep sync failed";

    // Token invalid is an expected, user-actionable state — return 200 so it
    // isn't surfaced as a runtime error in the client overlay.
    if (message === "GOOGLE_FIT_USER_TOKEN_INVALID") {
      console.log("Google Fit sleep skipped: token invalid (user must reconnect)");
      return new Response(
        JSON.stringify({
          synced: 0,
          sessions: 0,
          skipped: true,
          reason: "token_invalid",
          message: "Your Google Fit connection expired or was revoked. Please disconnect and reconnect Google Fit.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else if (message === "GOOGLE_FIT_APP_CREDENTIALS_INVALID") {
      status = 400;
      clientError = "Google Fit app credentials are invalid. Please update backend Google Fit credentials.";
    } else if (message.startsWith("GOOGLE_FIT_TOKEN_REFRESH_FAILED:")) {
      status = 502;
      clientError = "Unable to refresh Google Fit token right now. Please reconnect and try again.";
    }

    console.error("Google Fit sleep error:", message);
    return new Response(JSON.stringify({ error: clientError, code: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
