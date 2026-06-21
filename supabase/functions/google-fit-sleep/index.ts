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

function makeTrace(debug: boolean) {
  const traceId = `google-fit-sleep-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const entries: Array<{ stage: string; data: unknown; timestamp: string }> = [];
  const log = (stage: string, data: unknown = {}) => {
    const entry = { stage, data, timestamp: new Date().toISOString() };
    if (debug) entries.push(entry);
    console.log(`[${traceId}] ${stage}: ${JSON.stringify(data)}`);
  };
  return { traceId, entries, log };
}

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

    // User revoked/expired refresh token. Google sometimes returns just
    // {"error":"invalid_grant","error_description":"Bad Request"} so match
    // on invalid_grant alone — the refresh token is unusable either way.
    if (normalized.includes("invalid_grant")) {
      // Clear the dead token so the UI flips back to "Connect Google Fit".
      await supabase.from("google_fit_tokens").delete().eq("user_id", userId);
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

  let daysBack = 3650; // default: all available history (~10 years)
  let debug = false;
  try {
    const body = await req.clone().json();
    if (body?.days) daysBack = Math.min(body.days, 3650);
    debug = body?.debug === true;
  } catch { /* no body, use default */ }

  const trace = makeTrace(debug);
  trace.log("request.received", { daysBack, debug, method: req.method });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      trace.log("auth.missing_header", {});
      return new Response(JSON.stringify({ error: "Not authenticated", traceId: trace.traceId }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (userError || !user) {
      trace.log("auth.invalid_token", { error: userError?.message });
      return new Response(JSON.stringify({ error: "Invalid token", traceId: trace.traceId }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    trace.log("auth.user_loaded", { userId: user.id });

    // Get tokens
    const now = Math.floor(Date.now() / 1000);
    const { data: tokenRow, error: tokenError } = await supabase
      .from("google_fit_tokens")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    trace.log("tokens.lookup", {
      found: !!tokenRow,
      error: tokenError?.message,
      expiresAt: tokenRow?.expires_at,
      now,
    });

    if (!tokenRow) {
      return new Response(JSON.stringify({ skipped: "not_connected", synced: 0, sessions: 0, traceId: trace.traceId }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Refresh if expired
    let accessToken = tokenRow.access_token;
    if (tokenRow.expires_at < now + 60) {
      trace.log("tokens.refresh.started", { expiresAt: tokenRow.expires_at, now });
      accessToken = await refreshAccessToken(supabase, user.id, tokenRow.refresh_token);
      trace.log("tokens.refresh.completed", {});
    } else {
      trace.log("tokens.refresh.skipped", { expiresAt: tokenRow.expires_at, now });
    }

    // Fetch sleep sessions
    const endTimeMillis = Date.now();
    const startTimeMillis = endTimeMillis - daysBack * 24 * 60 * 60 * 1000;

    const sessionsUrl = `https://www.googleapis.com/fitness/v1/users/me/sessions?startTime=${new Date(startTimeMillis).toISOString()}&endTime=${new Date(endTimeMillis).toISOString()}&activityType=72`;
    trace.log("google.sessions.request", {
      url: sessionsUrl,
      startTime: new Date(startTimeMillis).toISOString(),
      endTime: new Date(endTimeMillis).toISOString(),
      activityType: 72,
    });
    const sessionsRes = await fetch(
      sessionsUrl,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!sessionsRes.ok) {
      const err = await sessionsRes.text();
      trace.log("google.sessions.error", { status: sessionsRes.status, statusText: sessionsRes.statusText, body: err });
      return new Response(JSON.stringify({ error: "Failed to fetch sleep sessions", traceId: trace.traceId, trace: debug ? trace.entries : undefined }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sessionsData = await sessionsRes.json();
    const sessions = sessionsData.session || [];
    trace.log("google.sessions.response.raw", sessionsData);
    trace.log("google.sessions.parsed", {
      sessionsFound: sessions.length,
      daysBack,
      sessions: sessions.map((session: any) => ({
        id: session.id,
        name: session.name,
        description: session.description,
        application: session.application,
        activityType: session.activityType,
        startTimeMillis: session.startTimeMillis,
        endTimeMillis: session.endTimeMillis,
        startIso: session.startTimeMillis ? new Date(parseInt(session.startTimeMillis)).toISOString() : null,
        endIso: session.endTimeMillis ? new Date(parseInt(session.endTimeMillis)).toISOString() : null,
      })),
      deletedSessionsFound: sessionsData.deletedSession?.length || 0,
      responseKeys: Object.keys(sessionsData),
    });
    if (sessions.length === 0) {
      trace.log("google.sessions.empty", {
        query: { startTime: new Date(startTimeMillis).toISOString(), endTime: new Date(endTimeMillis).toISOString(), activityType: 72 },
        responseKeys: Object.keys(sessionsData),
        deletedSessionsFound: sessionsData.deletedSession?.length || 0,
      });
    }

    let totalStages = 0;
    // Aggregate per-date totals so we can also update daily_metrics
    const dailyTotals: Record<string, { deep: number; rem: number; light: number; awake: number; sleep: number }> = {};
    const addStage = (date: string, stage: string, secs: number) => {
      if (!dailyTotals[date]) dailyTotals[date] = { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 };
      const t = dailyTotals[date] as any;
      if (stage in t) t[stage] += secs;
    };

    // Pre-compute the set of "sleep night" dates and wipe existing google_fit rows
    // for those dates ONCE up front. Doing the delete per-session (as before) caused
    // duplicate rows whenever two sessions mapped to the same date — the second
    // session's delete would wipe the first session's freshly-inserted rows... or
    // (in practice) leave stale rows from earlier syncs untouched, producing dupes.
    const nightDates = new Set<string>();
    for (const session of sessions) {
      nightDates.add(new Date(parseInt(session.endTimeMillis)).toISOString().split("T")[0]);
    }
    trace.log("database.sleep_stages.delete.sessions.planned", { dates: Array.from(nightDates), count: nightDates.size });
    if (nightDates.size > 0) {
      const { error: deleteError } = await supabase
        .from("sleep_stages")
        .delete()
        .eq("user_id", user.id)
        .eq("source", "google_fit")
        .in("date", Array.from(nightDates));
      trace.log("database.sleep_stages.delete.sessions.completed", {
        dates: Array.from(nightDates),
        error: deleteError?.message || null,
      });
    }

    for (const session of sessions) {
      const sessionStart = parseInt(session.startTimeMillis);
      const sessionEnd = parseInt(session.endTimeMillis);

      // Determine the date (use the end time's date as the "sleep night" date)
      const sleepDate = new Date(sessionEnd).toISOString().split("T")[0];
      trace.log("session.processing.started", {
        id: session.id,
        date: sleepDate,
        start: new Date(sessionStart).toISOString(),
        end: new Date(sessionEnd).toISOString(),
        rawSession: session,
      });

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
        const errTxt = await datasetRes.text();
        trace.log("google.session_segments.error", { sessionId: session.id, status: datasetRes.status, statusText: datasetRes.statusText, body: errTxt });
        continue;
      }

      const datasetData = await datasetRes.json();
      trace.log("google.session_segments.response.raw", { sessionId: session.id, response: datasetData });

      // (rows for this date were already deleted up-front, before the loop)

      const buckets = datasetData.bucket || [];
      let sessionStages = 0;
      let skippedPoints = 0;

      for (const bucket of buckets) {
        for (const dataset of bucket.dataset || []) {
          for (const point of dataset.point || []) {
            const startNanos = parseInt(point.startTimeNanos);
            const endNanos = parseInt(point.endTimeNanos);
            const stageType = point.value?.[0]?.intVal;

            if (stageType == null) {
              skippedPoints++;
              trace.log("session.point.skipped", { sessionId: session.id, reason: "missing_stage_type", point });
              continue;
            }

            const stageName = SLEEP_STAGE_MAP[stageType];
            if (!stageName || stageName === "out_of_bed") {
              skippedPoints++;
              trace.log("session.point.skipped", { sessionId: session.id, reason: "unsupported_or_out_of_bed", stageType, stageName, point });
              continue;
            }

            // Keep "sleep" as-is (generic sleep without stage breakdown)
            const normalizedStage = stageName;
            const durationSeconds = Math.round((endNanos - startNanos) / 1e9);

            const insertPayload = {
              user_id: user.id,
              date: sleepDate,
              stage: normalizedStage,
              duration_seconds: durationSeconds,
              start_time: new Date(startNanos / 1e6).toISOString(),
              end_time: new Date(endNanos / 1e6).toISOString(),
              source: "google_fit",
            };

            const { error: insertError } = await supabase.from("sleep_stages").upsert(insertPayload, { onConflict: "user_id,source,start_time,end_time,stage", ignoreDuplicates: true });
            trace.log("database.sleep_stages.insert.session_point", {
              sessionId: session.id,
              payload: insertPayload,
              error: insertError?.message || null,
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
        trace.log("session.fallback_sleep_entry.started", { sessionId: session.id, durationSeconds, skippedPoints });
        const fallbackPayload = {
          user_id: user.id,
          date: sleepDate,
          stage: "sleep",
          duration_seconds: durationSeconds,
          start_time: new Date(sessionStart).toISOString(),
          end_time: new Date(sessionEnd).toISOString(),
          source: "google_fit",
        };
        const { error: fallbackInsertError } = await supabase.from("sleep_stages").upsert(fallbackPayload, { onConflict: "user_id,source,start_time,end_time,stage", ignoreDuplicates: true });
        trace.log("database.sleep_stages.insert.session_fallback", {
          sessionId: session.id,
          payload: fallbackPayload,
          error: fallbackInsertError?.message || null,
        });
        totalStages++;
        addStage(sleepDate, "sleep", durationSeconds);
      }
      trace.log("session.processing.completed", { sessionId: session.id, date: sleepDate, insertedStages: sessionStages, skippedPoints });
    }

    // ---------- Fallback: query sleep.segment data directly ----------
    // The Sessions API (activityType=72) only returns sleep that was explicitly
    // logged as a "session". Many watches & Health Connect push raw sleep
    // segments without a session wrapper, so they're invisible above. Pull the
    // raw segments for the whole window and ingest any nights we haven't
    // already covered via sessions.
    try {
      const segRes = await fetch(
        `https://www.googleapis.com/fitness/v1/users/me/dataSources/derived:com.google.sleep.segment:com.google.android.gms:merged/datasets/${startTimeMillis * 1_000_000}-${endTimeMillis * 1_000_000}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (segRes.ok) {
        const segData = await segRes.json();
        const points: any[] = segData.point || [];
        trace.log("google.raw_segments.response.raw", segData);
        trace.log("google.raw_segments.parsed", { pointsFetched: points.length });

        const pointsByDate = new Map<string, any[]>();
        for (const p of points) {
          const endNanos = parseInt(p.endTimeNanos);
          const date = new Date(endNanos / 1e6).toISOString().split("T")[0];
          if (!pointsByDate.has(date)) pointsByDate.set(date, []);
          pointsByDate.get(date)!.push(p);
        }

        const newDates = Array.from(pointsByDate.keys()).filter((d) => !nightDates.has(d));
        trace.log("google.raw_segments.dates", {
          allDates: Array.from(pointsByDate.keys()),
          sessionDatesAlreadyCovered: Array.from(nightDates),
          newDates,
        });

        if (newDates.length > 0) {
          const { error: fallbackDeleteError } = await supabase
            .from("sleep_stages")
            .delete()
            .eq("user_id", user.id)
            .eq("source", "google_fit")
            .in("date", newDates);
          trace.log("database.sleep_stages.delete.raw_segments.completed", { dates: newDates, error: fallbackDeleteError?.message || null });

          for (const date of newDates) {
            for (const p of pointsByDate.get(date)!) {
              const startNanos = parseInt(p.startTimeNanos);
              const endNanos = parseInt(p.endTimeNanos);
              const stageType = p.value?.[0]?.intVal;
              if (stageType == null) {
                trace.log("raw_segment.point.skipped", { date, reason: "missing_stage_type", point: p });
                continue;
              }
              const stageName = SLEEP_STAGE_MAP[stageType];
              if (!stageName || stageName === "out_of_bed") {
                trace.log("raw_segment.point.skipped", { date, reason: "unsupported_or_out_of_bed", stageType, stageName, point: p });
                continue;
              }

              const durationSeconds = Math.round((endNanos - startNanos) / 1e9);
              const rawInsertPayload = {
                user_id: user.id,
                date,
                stage: stageName,
                duration_seconds: durationSeconds,
                start_time: new Date(startNanos / 1e6).toISOString(),
                end_time: new Date(endNanos / 1e6).toISOString(),
                source: "google_fit",
              };
              const { error: rawInsertError } = await supabase.from("sleep_stages").upsert(rawInsertPayload, { onConflict: "user_id,source,start_time,end_time,stage", ignoreDuplicates: true });
              trace.log("database.sleep_stages.insert.raw_segment", { date, payload: rawInsertPayload, error: rawInsertError?.message || null });
              totalStages++;
              addStage(date, stageName, durationSeconds);
            }
          }
        } else {
          trace.log("google.raw_segments.no_new_dates", { reason: "all raw segment dates already covered by sessions or no points returned" });
        }
      } else {
        const errTxt = await segRes.text();
        trace.log("google.raw_segments.error", { status: segRes.status, statusText: segRes.statusText, body: errTxt });
      }
    } catch (e) {
      trace.log("google.raw_segments.exception", { error: e instanceof Error ? e.message : String(e) });
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
        const { error: updateError } = await supabase.from("daily_metrics").update(payload).eq("id", existing.id);
        trace.log("database.daily_metrics.update", { date, payload, existingId: existing.id, error: updateError?.message || null });
      } else {
        const { error: dailyInsertError } = await supabase.from("daily_metrics").insert(payload);
        trace.log("database.daily_metrics.insert", { date, payload, error: dailyInsertError?.message || null });
      }
    }

    trace.log("sync.completed", {
      totalStages,
      sessions: sessions.length,
      dailyMetricsRowsUpdated: Object.keys(dailyTotals).length,
      dailyTotals,
    });
    return new Response(
      JSON.stringify({ synced: totalStages, sessions: sessions.length, traceId: trace.traceId, trace: debug ? trace.entries : undefined }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    let status = 500;
    let clientError = "Google Fit sleep sync failed";

    // Token invalid is an expected, user-actionable state — return 200 so it
    // isn't surfaced as a runtime error in the client overlay.
    if (message === "GOOGLE_FIT_USER_TOKEN_INVALID") {
      trace.log("sync.skipped.token_invalid", { message });
      return new Response(
        JSON.stringify({
          synced: 0,
          sessions: 0,
          skipped: true,
          reason: "token_invalid",
          message: "Your Google Fit connection expired or was revoked. Please disconnect and reconnect Google Fit.",
          traceId: trace.traceId,
          trace: debug ? trace.entries : undefined,
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

    trace.log("sync.error", { message, clientError, status });
    return new Response(JSON.stringify({ error: clientError, code: message, traceId: trace.traceId, trace: debug ? trace.entries : undefined }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
