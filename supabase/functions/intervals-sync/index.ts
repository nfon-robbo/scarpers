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

    const body = await req.json();
    const { workouts, clearRange, deleteRange } = body as {
      workouts?: Array<{
        date: string;
        name: string;
        description: string;
        steps: Array<{
          duration: number;
          hrLow: number;
          hrHigh: number;
          intensity: string;
        }>;
      }>;
      clearRange?: { oldest: string; newest: string };
      deleteRange?: { oldest: string; newest: string };
    };

    const basicAuth = btoa(`API_KEY:${INTERVALS_API_KEY}`);
    const baseUrl = `https://intervals.icu/api/v1/athlete/${INTERVALS_ATHLETE_ID}`;
    const authHeaders = {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    };

    // Delete-only mode: remove all planned workouts in range
    if (deleteRange) {
      try {
        const eventsResp = await fetch(
          `${baseUrl}/events?oldest=${deleteRange.oldest}&newest=${deleteRange.newest}`,
          { headers: authHeaders }
        );
        if (eventsResp.ok) {
          const events = await eventsResp.json();
          const workoutEvents = events.filter(
            (e: { category: string }) => e.category === "WORKOUT"
          );
          let deleted = 0;
          for (const evt of workoutEvents) {
            const delResp = await fetch(`${baseUrl}/events/${evt.id}`, {
              method: "DELETE",
              headers: authHeaders,
            });
            if (delResp.ok) deleted++;
          }
          return new Response(
            JSON.stringify({ deleted, total: workoutEvents.length }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errText = await eventsResp.text();
        return new Response(
          JSON.stringify({ error: `Failed to fetch events: ${eventsResp.status} ${errText}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return new Response(
          JSON.stringify({ error: msg }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!workouts || workouts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No workouts provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Delete existing planned workouts in range if requested
    if (clearRange) {
      try {
        const eventsResp = await fetch(
          `${baseUrl}/events?oldest=${clearRange.oldest}&newest=${clearRange.newest}`,
          { headers: authHeaders }
        );
        if (eventsResp.ok) {
          const events = await eventsResp.json();
          const workoutEvents = events.filter(
            (e: { category: string }) => e.category === "WORKOUT"
          );
          console.log(`Deleting ${workoutEvents.length} existing workouts in range`);
          for (const evt of workoutEvents) {
            await fetch(`${baseUrl}/events/${evt.id}`, {
              method: "DELETE",
              headers: authHeaders,
            });
          }
        } else {
          console.error("Failed to fetch existing events:", eventsResp.status);
        }
      } catch (e) {
        console.error("Error clearing existing workouts:", e);
      }
    }

    // Step 2: Create new workouts
    const results: Array<{ date: string; name: string; success: boolean; error?: string }> = [];

    for (const workout of workouts) {
      const totalDuration = workout.steps.reduce((sum: number, s: { duration: number }) => sum + s.duration, 0);

      // Build text-based workout_definition that intervals.icu parses into proper step types
      const lines: string[] = [];
      let currentSection = "";
      for (const s of workout.steps) {
        // Determine section header based on intensity
        let section = "";
        switch (s.intensity) {
          case "Warmup": section = "Warmup"; break;
          case "Cooldown": section = "Cooldown"; break;
          default: section = ""; break;
        }

        // Add section header if it changed
        if (section && section !== currentSection) {
          lines.push(section);
          currentSection = section;
        } else if (!section && currentSection !== "Main") {
          // No special section = main set
          currentSection = "Main";
        }

        // Format duration
        const mins = Math.floor(s.duration / 60);
        const secs = s.duration % 60;
        let durStr = "";
        if (mins > 0 && secs > 0) durStr = `${mins}m${secs}s`;
        else if (mins > 0) durStr = `${mins}m`;
        else durStr = `${secs}s`;

        // Format HR target
        const hrStr = `${s.hrLow}-${s.hrHigh}bpm`;

        // Mark recovery/rest steps
        let label = "";
        if (s.intensity === "Recovery" || s.intensity === "Rest") label = " #recovery";

        lines.push(`- ${durStr} ${hrStr}${label}`);
      }

      const workoutDefinition = lines.join("\n");

      const payload = {
        start_date_local: `${workout.date}T00:00:00`,
        category: "WORKOUT",
        name: workout.name,
        description: workout.description,
        type: "Run",
        moving_time: totalDuration,
        workout_definition: workoutDefinition,
      };

      try {
        const resp = await fetch(`${baseUrl}/events`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(payload),
        });

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
