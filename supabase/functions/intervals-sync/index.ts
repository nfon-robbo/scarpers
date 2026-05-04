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
  steps: WorkoutStep[];
};

type StructuredWorkoutStep =
  | {
      type: "WARMUP" | "COOLDOWN" | "INTERVAL_ACTIVE" | "INTERVAL_REST" | "ACTIVE";
      duration: number;
      durationType: "TIME";
      target: string;
    }
  | {
      type: "REPEAT";
      repeat: number;
      steps: StructuredWorkoutStep[];
    };

type StructuredWorkoutDoc = {
  name: string;
  steps: StructuredWorkoutStep[];
};

function paceToDistanceMeters(durationSeconds: number, pace?: string): number {
  const match = pace?.match(/(\d{1,2}):(\d{2})(?:\s*\/\s*(km|mi))?/i);
  if (!match) return 0;
  const paceSeconds = Number(match[1]) * 60 + Number(match[2]);
  if (!Number.isFinite(paceSeconds) || paceSeconds <= 0) return 0;
  const metresPerUnit = /mi/i.test(match[3] || "") ? 1609.344 : 1000;
  return (durationSeconds / paceSeconds) * metresPerUnit;
}

function zoneTarget(step: WorkoutStep): string {
  const zoneMatch = step.hrZone?.match(/Z(\d)/i);
  if (zoneMatch) return `ZONE${zoneMatch[1]}`;

  const normalized = step.intensity.toLowerCase();
  if (normalized === "interval") return "ZONE4";
  if (normalized === "recovery" || normalized === "rest" || normalized === "warmup" || normalized === "cooldown") return "ZONE1";
  return "ZONE2";
}

function structuredStep(step: WorkoutStep, forcedType?: "INTERVAL_ACTIVE" | "INTERVAL_REST"): StructuredWorkoutStep {
  const normalized = step.intensity.toLowerCase();
  const type = forcedType
    ?? (normalized === "warmup"
      ? "WARMUP"
      : normalized === "cooldown"
        ? "COOLDOWN"
        : normalized === "recovery" || normalized === "rest"
          ? "INTERVAL_REST"
          : normalized === "interval"
            ? "INTERVAL_ACTIVE"
            : "ACTIVE");

  return {
    type,
    duration: Math.max(1, Math.round(step.duration)),
    durationType: "TIME",
    target: zoneTarget(step),
  };
}

function sameRepeatPair(aWork: WorkoutStep, aRest: WorkoutStep, bWork: WorkoutStep, bRest: WorkoutStep): boolean {
  return aWork.duration === bWork.duration
    && aRest.duration === bRest.duration
    && zoneTarget(aWork) === zoneTarget(bWork)
    && zoneTarget(aRest) === zoneTarget(bRest);
}

function buildStructuredWorkoutDoc(workout: WorkoutInput): StructuredWorkoutDoc {
  const steps: StructuredWorkoutStep[] = [];
  const source = workout.steps.filter((step) => step.duration > 0);
  let i = 0;

  while (i < source.length) {
    const step = source[i];
    const next = source[i + 1];
    const isWork = step.intensity === "Interval";
    const isRest = next && (next.intensity === "Recovery" || next.intensity === "Rest");

    if (isWork && isRest) {
      const workStep = step;
      const restStep = next;
      let repeat = 0;
      let j = i;

      while (
        j + 1 < source.length
        && source[j].intensity === "Interval"
        && (source[j + 1].intensity === "Recovery" || source[j + 1].intensity === "Rest")
        && sameRepeatPair(workStep, restStep, source[j], source[j + 1])
      ) {
        repeat += 1;
        j += 2;
      }

      steps.push({
        type: "REPEAT",
        repeat,
        steps: [
          structuredStep(workStep, "INTERVAL_ACTIVE"),
          structuredStep(restStep, "INTERVAL_REST"),
        ],
      });
      i = j;
      continue;
    }

    steps.push(structuredStep(step));
    i += 1;
  }

  return { name: workout.name, steps };
}

function formatWorkoutDescription(workout: WorkoutInput): string {
  function fmtDur(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    if (m > 0 && s > 0) return `${m}m${s}`;
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

  // Cue keywords are how Intervals.icu derives the Garmin step type.
  // - "Recovery" / "Rest" -> Garmin "Recovery" step
  // - Inside Warmup section -> Garmin "Warm Up"
  // - Inside Cooldown section -> Garmin "Cool Down"
  // - Otherwise -> Garmin "Run" (active)
  // Plain "Walk" / "Run" cues are treated as free text and produce "Other".
  function stepCue(step: WorkoutStep): string {
    const normalized = step.intensity.toLowerCase();
    if (normalized === "recovery" || normalized === "rest") return "Recovery";
    if (normalized === "warmup") return "Warmup";
    if (normalized === "cooldown") return "Cooldown";
    return "Run";
  }

  function fmtStep(step: WorkoutStep): string {
    return `- ${stepCue(step)} ${fmtDur(step.duration)}${fmtTarget(step)}`;
  }

  const lines: string[] = [];
  let i = 0;
  let prevIntensity = "";

  while (i < workout.steps.length) {
    const step = workout.steps[i];

    if (step.intensity === "Warmup") {
      if (prevIntensity !== "Warmup") lines.push("Warmup");
      lines.push(fmtStep(step));
      prevIntensity = "Warmup";
      i += 1;
    } else if (step.intensity === "Cooldown") {
      if (prevIntensity !== "Cooldown") {
        lines.push("");
        lines.push("Cooldown");
      }
      lines.push(fmtStep(step));
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
        lines.push(fmtStep(workStep));
        if (restDur > 0 && restStep) lines.push(fmtStep(restStep));
        i = j;
      } else {
        if (prevIntensity !== "Active") {
          lines.push("");
          lines.push("Run");
        }
        lines.push(fmtStep(step));
        i += 1;
      }

      prevIntensity = "Active";
    } else {
      if (prevIntensity !== "Active") {
        lines.push("");
        lines.push("Run");
      }
      lines.push(fmtStep(step));
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

    // Step 2: Build events with the description in Intervals.icu's native
    // workout-builder syntax. Intervals.icu parses this server-side and
    // populates `workout_doc` itself — that parsed doc is what gets exported
    // to Garmin. Sending our own `workout_doc` produces malformed output
    // (e.g. "Duration Type cannot be null") because the schema is private and
    // version-coupled to their parser.
    const eventsToSync = workouts.map((workout, idx) => {
      const fullDescription = formatWorkoutDescription(workout);
      const totalDuration = workout.steps.reduce((sum, s) => sum + s.duration, 0);
      const totalDistance = workout.steps.reduce((sum, s) => sum + paceToDistanceMeters(s.duration, s.pace), 0);

      return {
        category: "WORKOUT",
        start_date_local: `${workout.date}T00:00:00`,
        name: workout.name,
        type: "Run",
        target: "PACE",
        targets: ["PACE"],
        moving_time: totalDuration,
        time_target: totalDuration,
        ...(totalDistance > 0 ? { distance: Math.round(totalDistance), distance_target: Math.round(totalDistance) } : {}),
        description: fullDescription,
        external_id: `lovable-${workout.date}-${idx}`,
      };
    });

    console.log(`Syncing ${eventsToSync.length} workouts via Intervals.icu bulk planned-workout endpoint`);
    const resp = await fetch(`${baseUrl}/events/bulk?upsert=true`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify(eventsToSync),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Bulk workout sync error:", resp.status, errText);
      return new Response(
        JSON.stringify({ error: `Intervals.icu bulk sync failed: ${resp.status} ${errText}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await resp.json();
    const syncedEvents = Array.isArray(result) ? result : [];

    console.log(`Structured bulk sync result: ${syncedEvents.length} created/updated, 0 failed`);

    return new Response(
      JSON.stringify({ succeeded: syncedEvents.length, failed: 0, results: syncedEvents.map((r: any) => ({ date: r.start_date_local, name: r.name, success: true })) }),
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
