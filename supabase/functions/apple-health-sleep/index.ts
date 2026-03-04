import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-user-id, automation-name, automation-id, automation-aggregation, automation-period, session-id",
};

// Map Health Auto Export sleep stage values to our internal stage names
const STAGE_MAP: Record<string, string | null> = {
  "Deep":    "deep",
  "Core":    "light",    // Apple "Core" = light sleep
  "REM":     "rem",
  "Awake":   "awake",
  "Asleep":  "sleep",    // generic/uncategorized sleep
  "In Bed":  null,       // skip "In Bed" — not actual sleep
  "Unspecified": null,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const APPLE_HEALTH_API_KEY = Deno.env.get("APPLE_HEALTH_API_KEY");

  try {
    // ── Auth: X-API-Key header + X-User-Id header ──
    const apiKey = req.headers.get("x-api-key") || req.headers.get("X-API-Key");
    const userId = req.headers.get("x-user-id") || req.headers.get("X-User-Id");

    if (!APPLE_HEALTH_API_KEY) {
      console.error("APPLE_HEALTH_API_KEY secret not configured");
      return new Response(JSON.stringify({ error: "Server not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!apiKey || apiKey !== APPLE_HEALTH_API_KEY) {
      return new Response(JSON.stringify({ error: "Invalid API key" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Missing X-User-Id header" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user exists
    const { data: userCheck } = await supabase.auth.admin.getUserById(userId);
    if (!userCheck?.user) {
      return new Response(JSON.stringify({ error: "Invalid user ID" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse payload ──
    const body = await req.json();
    const metrics = body?.data?.metrics || [];

    // Find Sleep Analysis metric
    const sleepMetric = metrics.find(
      (m: any) => m.name?.toLowerCase().includes("sleep") && m.name?.toLowerCase().includes("analysis")
    );

    if (!sleepMetric || !sleepMetric.data || sleepMetric.data.length === 0) {
      console.log("No sleep analysis data in payload. Metrics received:", metrics.map((m: any) => m.name));
      return new Response(
        JSON.stringify({ status: "ok", message: "No sleep data found in payload", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const sleepData = sleepMetric.data;
    const isAggregated = sleepData[0]?.totalSleep !== undefined || sleepData[0]?.deep !== undefined;

    console.log(`Apple Health: received ${sleepData.length} sleep entries, aggregated=${isAggregated}`);

    let totalStages = 0;
    const processedDates = new Set<string>();

    if (isAggregated) {
      // ── Aggregated format ──
      // Each entry has: date, totalSleep, asleep, core, deep, rem, sleepStart, sleepEnd, inBed, ...
      for (const entry of sleepData) {
        const dateStr = extractDate(entry.date || entry.sleepEnd || entry.sleepStart);
        if (!dateStr) continue;

        // Delete existing apple_health data for this date
        if (!processedDates.has(dateStr)) {
          await supabase
            .from("sleep_stages")
            .delete()
            .eq("user_id", userId)
            .eq("date", dateStr)
            .eq("source", "apple_health");
          processedDates.add(dateStr);
        }

        const stages: { stage: string; minutes: number }[] = [];
        if (entry.deep > 0) stages.push({ stage: "deep", minutes: entry.deep });
        if (entry.core > 0) stages.push({ stage: "light", minutes: entry.core });
        if (entry.rem > 0) stages.push({ stage: "rem", minutes: entry.rem });

        // Calculate awake from inBed - totalSleep if available
        const awakeMins = entry.inBed && entry.totalSleep ? entry.inBed - entry.totalSleep : 0;
        if (awakeMins > 0) stages.push({ stage: "awake", minutes: awakeMins });

        // If no breakdown, use totalSleep as generic
        if (stages.length === 0 && entry.totalSleep > 0) {
          stages.push({ stage: "sleep", minutes: entry.totalSleep });
        }

        for (const s of stages) {
          await supabase.from("sleep_stages").insert({
            user_id: userId,
            date: dateStr,
            stage: s.stage,
            duration_seconds: Math.round(s.minutes * 60),
            start_time: entry.sleepStart || null,
            end_time: entry.sleepEnd || null,
            source: "apple_health",
          });
          totalStages++;
        }
      }
    } else {
      // ── Unaggregated format ──
      // Each entry has: startDate, endDate, qty (minutes), value (stage name)
      for (const entry of sleepData) {
        const stageValue = entry.value;
        const mappedStage = STAGE_MAP[stageValue];
        if (mappedStage === null || mappedStage === undefined) continue;

        const dateStr = extractDate(entry.endDate || entry.startDate);
        if (!dateStr) continue;

        if (!processedDates.has(dateStr)) {
          await supabase
            .from("sleep_stages")
            .delete()
            .eq("user_id", userId)
            .eq("date", dateStr)
            .eq("source", "apple_health");
          processedDates.add(dateStr);
        }

        const durationSeconds = entry.qty ? Math.round(entry.qty * 60) : 0;
        if (durationSeconds <= 0) continue;

        await supabase.from("sleep_stages").insert({
          user_id: userId,
          date: dateStr,
          stage: mappedStage,
          duration_seconds: durationSeconds,
          start_time: entry.startDate || null,
          end_time: entry.endDate || null,
          source: "apple_health",
        });
        totalStages++;
      }
    }

    console.log(`Apple Health sleep sync complete: ${totalStages} stages for ${processedDates.size} dates`);
    return new Response(
      JSON.stringify({ status: "ok", synced: totalStages, dates: processedDates.size }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Apple Health sleep error:", message);
    return new Response(JSON.stringify({ error: "Apple Health sleep sync failed", detail: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/** Extract YYYY-MM-DD from various date formats */
function extractDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  // Handle "yyyy-MM-dd HH:mm:ss Z" or "yyyy-MM-dd" or ISO
  const match = String(dateStr).match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
