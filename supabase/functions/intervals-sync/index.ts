import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

type WorkoutStep = {
  duration: number;
  hrLow: number;
  hrHigh: number;
  hrZone?: string;
  intensity: string;
  pace?: string;
};

type WorkoutInput = {
  date: string;
  name: string;
  description: string;
  notes?: string;
  rawDescription?: string;
  fitFileBase64?: string;
  fitFileName?: string;
  steps: WorkoutStep[];
};

function formatWorkoutDescription(workout: WorkoutInput): string {
  if (workout.rawDescription && /\bpace\b/i.test(workout.rawDescription) && !/\b(?:hr|lthr|bpm)\b/i.test(workout.rawDescription)) {
    return workout.notes ? `${workout.rawDescription}\n\n${workout.notes}` : workout.rawDescription;
  }

  function fmtDur(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m > 0 && s > 0) return `${m}m${s}s`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function normalizeHrZone(step: { hrZone?: string; hrLow: number; hrHigh: number }): string {
    if (step.hrZone && /Z\d/i.test(step.hrZone)) {
      const zones = Array.from(step.hrZone.matchAll(/Z(\d)/gi)).map((match) => Number(match[1]));
      if (zones.length === 1) return `Z${zones[0]}`;
      if (zones.length > 1) return `Z${zones[0]}-Z${zones[zones.length - 1]}`;
    }

    const bpmToZone = (bpm: number) => {
      if (bpm <= 120) return 1;
      if (bpm <= 140) return 2;
      if (bpm <= 160) return 3;
      if (bpm <= 175) return 4;
      return 5;
    };

    const lowZone = bpmToZone(step.hrLow);
    const highZone = bpmToZone(step.hrHigh);
    return lowZone === highZone ? `Z${lowZone}` : `Z${lowZone}-Z${highZone}`;
  }

  function fmtTarget(step: WorkoutStep): string {
    if (step.pace) return ` ${step.pace.replace(/\s+/g, "").replace(/\/$/, "")} Pace`;
    if (step.hrLow > 0 && step.hrHigh > 0) return ` ${normalizeHrZone(step)} HR`;
    return "";
  }

  const lines: string[] = [];
  let i = 0;
  let prevIntensity = "";

  while (i < workout.steps.length) {
    const step = workout.steps[i];

    if (step.intensity === "Warmup") {
      if (prevIntensity !== "Warmup") lines.push("Warmup");
      lines.push(`- ${fmtDur(step.duration)}${fmtTarget(step)}`);
      prevIntensity = "Warmup";
      i += 1;
    } else if (step.intensity === "Cooldown") {
      if (prevIntensity !== "Cooldown") {
        lines.push("");
        lines.push("Cooldown");
      }
      lines.push(`- ${fmtDur(step.duration)}${fmtTarget(step)}`);
      prevIntensity = "Cooldown";
      i += 1;
    } else if (step.intensity === "Interval") {
      let reps = 0;
      let j = i;
      const workDur = step.duration;
      const workStep = step;
      let restDur = 0;
      let restStep: WorkoutStep | undefined;

      while (j < workout.steps.length && workout.steps[j].intensity === "Interval" && workout.steps[j].duration === workDur) {
        reps += 1;
        if (j + 1 < workout.steps.length && (workout.steps[j + 1].intensity === "Recovery" || workout.steps[j + 1].intensity === "Rest")) {
          restDur = workout.steps[j + 1].duration;
          restStep = workout.steps[j + 1];
          j += 2;
        } else {
          j += 1;
          break;
        }
      }

      if (reps > 1) {
        lines.push("");
        lines.push(`${reps}x`);
        lines.push(`- ${fmtDur(workDur)}${fmtTarget(workStep)}`);
        if (restDur > 0 && restStep) lines.push(`- ${fmtDur(restDur)} rest${fmtTarget(restStep)}`);
        i = j;
      } else {
        if (prevIntensity !== "Active") {
          lines.push("");
          lines.push("Run");
        }
        lines.push(`- ${fmtDur(step.duration)}${fmtTarget(step)}`);
        i += 1;
      }

      prevIntensity = "Active";
    } else {
      if (prevIntensity !== "Active") {
        lines.push("");
        lines.push("Run");
      }
      lines.push(`- ${fmtDur(step.duration)}${fmtTarget(step)}`);
      prevIntensity = "Active";
      i += 1;
    }
  }

  const workoutText = lines.join("\n");
  return workout.notes ? `${workoutText}\n\n${workout.notes}` : workoutText;
}

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
      workouts?: WorkoutInput[];
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

    // Step 2: Build bulk events
    const bulkEvents = workouts.map((workout, idx) => {
      const fullDescription = formatWorkoutDescription(workout);
      const totalDuration = workout.steps.reduce((sum, s) => sum + s.duration, 0);

      return {
        category: "WORKOUT",
        start_date_local: `${workout.date}T00:00:00`,
        name: workout.name,
        type: "Run",
        target: "PACE",
        moving_time: totalDuration,
        description: fullDescription,
        workout_doc: {},
        ...(workout.fitFileBase64 && workout.fitFileName
          ? {
              filename: workout.fitFileName,
              file_contents_base64: workout.fitFileBase64,
            }
          : {}),
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
