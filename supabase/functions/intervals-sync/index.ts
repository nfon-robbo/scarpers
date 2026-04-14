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
        notes?: string;
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

    // Step 2: Build bulk events with HR targets in workout description
    const bulkEvents = workouts.map((workout, idx) => {
      function fmtDur(secs: number): string {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        if (m > 0 && s > 0) return `${m}m${s}s`;
        if (m > 0) return `${m}m`;
        return `${s}s`;
      }

      function fmtHr(step: { hrLow: number; hrHigh: number }): string {
        if (step.hrLow > 0 && step.hrHigh > 0) {
          return ` ${step.hrLow}-${step.hrHigh}bpm`;
        }
        return "";
      }

      const steps = workout.steps;
      const lines: string[] = [];
      let i = 0;
      let prevIntensity = "";

      while (i < steps.length) {
        const s = steps[i];

        if (s.intensity === "Warmup") {
          if (prevIntensity !== "Warmup") lines.push("Warmup");
          lines.push(`- ${fmtDur(s.duration)}${fmtHr(s)}`);
          prevIntensity = "Warmup";
          i++;
        } else if (s.intensity === "Cooldown") {
          if (prevIntensity !== "Cooldown") { lines.push(""); lines.push("Cooldown"); }
          lines.push(`- ${fmtDur(s.duration)}${fmtHr(s)}`);
          prevIntensity = "Cooldown";
          i++;
        } else if (s.intensity === "Interval") {
          let reps = 0;
          let j = i;
          const workDur = s.duration;
          const workHr = { hrLow: s.hrLow, hrHigh: s.hrHigh };
          let restDur = 0;
          let restHr = { hrLow: 0, hrHigh: 0 };

          while (j < steps.length && steps[j].intensity === "Interval" &&
                 steps[j].duration === workDur) {
            reps++;
            if (j + 1 < steps.length && (steps[j + 1].intensity === "Recovery" || steps[j + 1].intensity === "Rest")) {
              restDur = steps[j + 1].duration;
              restHr = { hrLow: steps[j + 1].hrLow, hrHigh: steps[j + 1].hrHigh };
              j += 2;
            } else {
              j++;
              break;
            }
          }

          if (reps > 1) {
            lines.push("");
            lines.push(`${reps}x`);
            lines.push(`- ${fmtDur(workDur)}${fmtHr(workHr)}`);
            if (restDur > 0) lines.push(`- ${fmtDur(restDur)} rest${fmtHr(restHr)}`);
            i = j;
          } else {
            if (prevIntensity !== "Active") { lines.push(""); lines.push("Run"); }
            lines.push(`- ${fmtDur(s.duration)}${fmtHr(s)}`);
            i++;
          }
          prevIntensity = "Active";
        } else {
          if (prevIntensity !== "Active") { lines.push(""); lines.push("Run"); }
          lines.push(`- ${fmtDur(s.duration)}${fmtHr(s)}`);
          prevIntensity = "Active";
          i++;
        }
      }

      const workoutText = lines.join("\n");
      // Append notes (e.g. music BPM targets) if provided
      const fullDescription = workout.notes
        ? `${workoutText}\n\n${workout.notes}`
        : workoutText;
      const totalDuration = workout.steps.reduce((sum, s) => sum + s.duration, 0);

      return {
        category: "WORKOUT",
        start_date_local: `${workout.date}T00:00:00`,
        name: workout.name,
        type: "Run",
        target: "HR",
        moving_time: totalDuration,
        description: fullDescription,
        external_id: `lovable-${workout.date}-${idx}`,
      };
    });

    // Use bulk upsert endpoint for reliability
    console.log(`Syncing ${bulkEvents.length} workouts via bulk endpoint`);
    const resp = await fetch(`${baseUrl}/events/bulk?upsert=true`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(bulkEvents),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Bulk sync error:", resp.status, errText);
      return new Response(
        JSON.stringify({ error: `Intervals.icu API error: ${resp.status} ${errText}`, succeeded: 0, failed: bulkEvents.length }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await resp.json();
    console.log(`Bulk sync result: ${result.length} events created/updated`);

    return new Response(
      JSON.stringify({ succeeded: result.length, failed: 0, results: result.map((r: any) => ({ date: r.start_date_local, name: r.name, success: true })) }),
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
