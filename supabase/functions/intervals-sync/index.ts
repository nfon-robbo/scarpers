import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const INTERVALS_API_KEY = Deno.env.get("INTERVALS_API_KEY");
    const INTERVALS_ATHLETE_ID = Deno.env.get("INTERVALS_ATHLETE_ID");

    if (!INTERVALS_API_KEY || !INTERVALS_ATHLETE_ID) {
      return new Response(
        JSON.stringify({ error: "intervals.icu credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { workouts } = await req.json() as {
      workouts: Array<{
        date: string; // YYYY-MM-DD
        name: string;
        description: string;
        steps: Array<{
          duration: number; // seconds
          hrLow: number;
          hrHigh: number;
          intensity: string; // "Active" | "Resting"
        }>;
      }>;
    };

    if (!workouts || workouts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No workouts provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Using athlete ID: ${INTERVALS_ATHLETE_ID}, key length: ${INTERVALS_API_KEY.length}`);
    const basicAuth = btoa(`API_KEY:${INTERVALS_API_KEY}`);
    const results: Array<{ date: string; name: string; success: boolean; error?: string }> = [];

    for (const workout of workouts) {
      // Build workout_doc steps for intervals.icu
      const steps = workout.steps.map((s) => ({
        duration: s.duration,
        hr: { units: "bpm", start: s.hrLow, end: s.hrHigh },
        ramp: false,
      }));

      const totalDuration = workout.steps.reduce((sum, s) => sum + s.duration, 0);

      const payload = {
        start_date_local: `${workout.date}T00:00:00`,
        category: "WORKOUT",
        name: workout.name,
        description: workout.description,
        type: "Run",
        color: null,
        moving_time: totalDuration,
        workout_doc: {
          steps,
          duration: totalDuration,
        },
      };

      try {
        const resp = await fetch(
          `https://intervals.icu/api/v1/athlete/${INTERVALS_ATHLETE_ID}/events`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${basicAuth}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          }
        );

        if (resp.ok) {
          results.push({ date: workout.date, name: workout.name, success: true });
        } else {
          const errText = await resp.text();
          console.error(`intervals.icu error for ${workout.date}:`, resp.status, errText);
          results.push({ date: workout.date, name: workout.name, success: false, error: `${resp.status}: ${errText}` });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        results.push({ date: workout.date, name: workout.name, success: false, error: msg });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ succeeded, failed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("intervals-sync error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
