import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

// Build a pace range from a single pace string. Intervals.icu / Garmin
// require a target *range* for the workout step to display a pace target;
// a single value falls back to "No Target". We use the supplied pace as
// the fast bound and add 60s/km for the slow bound.
function paceRange(pace: string): string {
  const cleaned = pace.replace(/\s+/g, "");
  const m = cleaned.match(/^(\d{1,2}):(\d{2})(?:\/(km|mi))?$/i);
  if (!m) return cleaned.replace(/\/$/, "");
  // Centre the range on the target pace so Garmin's displayed (midpoint)
  // pace matches what the app shows. ±15s/km gives a sensible window.
  const targetSec = Number(m[1]) * 60 + Number(m[2]);
  const fastSec = Math.max(1, targetSec - 15);
  const slowSec = targetSec + 15;
  const unit = (m[3] || "km").toLowerCase();
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  // intervals.icu absolute pace range syntax confirmed working in forum:
  // "fast-slow/unit Pace" — unit specified once, trailing "Pace" keyword.
  // Putting the unit on both bounds (e.g. "6:27/km-7:27/km Pace") parses
  // visually in intervals.icu but the Garmin exporter drops the target.
  return `${fmt(fastSec)}-${fmt(slowSec)}/${unit} Pace`;
}

function paceTarget(step: WorkoutStep): string {
  const normalized = step.intensity.toLowerCase();
  // Warm-up, cool-down, recovery and rest steps must have NO target so the
  // watch shows "No Target" — matches Garmin's expected workout structure.
  if (["warmup", "cooldown", "recovery", "rest"].includes(normalized)) {
    return "";
  }
  if (step.pace) return paceRange(step.pace);
  if (normalized === "interval") return paceRange("5:00/km");
  return paceRange("6:27/km");
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

  const target = paceTarget(step);
  return {
    type,
    duration: Math.max(1, Math.round(step.duration)),
    durationType: "TIME",
    ...(target ? { target } : {}),
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

  function stepLabel(step: WorkoutStep): string {
    const n = step.intensity.toLowerCase();
    if (n === "warmup") return "Warm up";
    if (n === "cooldown") return "Cool down";
    if (n === "recovery" || n === "rest") return "Rest";
    if (n === "interval") return "Run";
    return "Steady";
  }

  function garminIntensity(step: WorkoutStep): string {
    const n = step.intensity.toLowerCase();
    if (n === "warmup") return "warmup";
    if (n === "cooldown") return "cooldown";
    if (n === "recovery" || n === "rest") return "rest";
    // Garmin only recognises warmup/cooldown/interval/recovery/rest/repeat.
    // "active" is silently dropped on export, leaving the watch with NO steps.
    // Map every work step (Interval, Active, Steady, etc.) to "interval".
    return "interval";
  }

  function fmtStep(step: WorkoutStep): string {
    // intervals.icu native syntax (per official docs): any text BEFORE the
    // duration becomes the step name (wktStepName on Garmin). Without it,
    // every step on the watch falls back to "Run".
    // The explicit intensity= flag controls Garmin's actual step type:
    // warmup / active (shown as Run) / rest / cooldown.
    //   - Warm up 10m 9:25-10:25/km Pace
    const pace = paceTarget(step);
    const name = stepLabel(step);
    const intensity = `intensity=${garminIntensity(step)}`;
    return pace
      ? `- ${name} ${fmtDur(step.duration)} ${pace} ${intensity}`
      : `- ${name} ${fmtDur(step.duration)} ${intensity}`;
  }

  const lines: string[] = [];
  let i = 0;

  while (i < workout.steps.length) {
    const step = workout.steps[i];

    if (step.intensity === "Interval") {
      // Only collapse into "Nx" when consecutive work+rest pairs are IDENTICAL
      // (same work duration, work pace, rest duration, rest pace). If any rep
      // diverges (e.g. user overrode Run 2's pace) emit steps individually so
      // the per-rep edits actually reach Garmin.
      const workStep = step;
      const restStep = workout.steps[i + 1];
      const hasRest = restStep && (restStep.intensity === "Recovery" || restStep.intensity === "Rest");
      const workPace = paceTarget(workStep);
      const restPace = hasRest ? paceTarget(restStep) : "";

      let reps = 1;
      let j = i + (hasRest ? 2 : 1);
      while (j < workout.steps.length) {
        const nextWork = workout.steps[j];
        const nextRest = workout.steps[j + 1];
        if (nextWork?.intensity !== "Interval") break;
        if (nextWork.duration !== workStep.duration) break;
        if (paceTarget(nextWork) !== workPace) break;
        if (hasRest) {
          if (!nextRest || (nextRest.intensity !== "Recovery" && nextRest.intensity !== "Rest")) break;
          if (nextRest.duration !== restStep!.duration) break;
          if (paceTarget(nextRest) !== restPace) break;
          j += 2;
        } else {
          j += 1;
        }
        reps += 1;
      }

      if (reps > 1) {
        if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
        lines.push(`${reps}x`);
        lines.push(fmtStep(workStep));
        if (hasRest && restStep) lines.push(fmtStep(restStep));
        lines.push("");
        i = j;
      } else {
        // Singleton (or first of a heterogeneous run) — emit just this work step.
        lines.push(fmtStep(step));
        i += 1;
      }
    } else {
      lines.push(fmtStep(step));
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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: creds } = await supabase
      .from("intervals_credentials")
      .select("athlete_id, api_key")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!creds?.athlete_id || !creds?.api_key) {
      return new Response(
        JSON.stringify({ error: "Intervals.icu not connected. Add your athlete ID and API key in Settings." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const INTERVALS_API_KEY = creds.api_key;
    const INTERVALS_ATHLETE_ID = creds.athlete_id;

    const body = await req.json();
    const { workouts, clearRange, deleteRange, pauseEvent, clearPauseEvent } = body as {
      workouts?: WorkoutInput[];
      clearRange?: { oldest: string; newest: string };
      deleteRange?: { oldest: string; newest: string };
      pauseEvent?: { category: "HOLIDAY" | "SICK" | "INJURED" | "NOTE"; name: string; start: string; end: string; planId: string };
      clearPauseEvent?: { planId: string; oldest?: string; newest?: string; pauseStart?: string; pauseEnd?: string };
    };


    const basicAuth = btoa(`API_KEY:${INTERVALS_API_KEY}`);
    const baseUrl = `https://intervals.icu/api/v1/athlete/${INTERVALS_ATHLETE_ID}`;
    const authHeaders = {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/json",
    };

    // Ensure a Run threshold_pace is set on intervals.icu. Without it, the
    // Garmin export silently strips all pace targets and the watch shows
    // "No Target" — regardless of workout description syntax.
    try {
      const settingsResp = await fetch(`${baseUrl}/sport-settings`, { headers: authHeaders });
      if (settingsResp.ok) {
        const allSettings = await settingsResp.json();
        const runSettings = Array.isArray(allSettings)
          ? allSettings.find((s: { types?: string[] }) => Array.isArray(s.types) && s.types.includes("Run"))
          : null;
        if (runSettings && (runSettings.threshold_pace == null || runSettings.threshold_pace === 0)) {
          await fetch(`${baseUrl}/sport-settings/${runSettings.id}`, {
            method: "PUT",
            headers: authHeaders,
            body: JSON.stringify({ threshold_pace: 3.03 }),
          });
          console.log("Set default Run threshold_pace=3.03 m/s on intervals.icu");
        }
      }
    } catch (e) {
      console.error("Failed to verify/set threshold_pace:", e);
    }

    // Clear pause marker events created previously for this plan.
    // Used on resume/cancel to wipe the HOLIDAY/SICK/INJURED/NOTE block.
    if (clearPauseEvent) {
      try {
        const oldest = clearPauseEvent.oldest ?? "2000-01-01";
        const newest = clearPauseEvent.newest ?? "2100-01-01";
        const eventsResp = await fetch(
          `${baseUrl}/events?oldest=${oldest}&newest=${newest}`,
          { headers: authHeaders }
        );
        if (eventsResp.ok) {
          const events = await eventsResp.json();
          const markerId = `lovable-pause-${clearPauseEvent.planId}`;
          const pauseCategories = new Set(["HOLIDAY", "SICK", "INJURED", "NOTE"]);
          // Primary match: our external_id stamp.
          // Fallback match: any HOLIDAY/SICK/INJURED/NOTE event whose name
          // contains "Scarpers pause" — covers events created before we had
          // external_id, and any case where intervals.icu dropped the stamp.
          const markers = events.filter((e: { external_id?: string; category?: string; name?: string }) => {
            if (e.external_id === markerId) return true;
            if (e.category && pauseCategories.has(e.category) && typeof e.name === "string" && /Scarpers/i.test(e.name)) return true;
            return false;
          });
          console.log(`[clearPauseEvent] planId=${clearPauseEvent.planId} range=${oldest}..${newest} scanned=${events.length} matched=${markers.length}`);
          let deleted = 0;
          for (const evt of markers) {
            const delResp = await fetch(`${baseUrl}/events/${evt.id}`, {
              method: "DELETE",
              headers: authHeaders,
            });
            if (delResp.ok) deleted++;
            else console.warn(`[clearPauseEvent] DELETE failed for ${evt.id}: ${delResp.status}`);
          }
          return new Response(
            JSON.stringify({ deleted, total: markers.length, scanned: events.length }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errText = await eventsResp.text();
        console.warn(`[clearPauseEvent] events fetch failed ${eventsResp.status}: ${errText}`);
        return new Response(
          JSON.stringify({ error: `events fetch failed ${eventsResp.status}`, detail: errText }),
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

    // Create a multi-day pause marker event on Intervals.icu.
    // Supported categories: HOLIDAY, SICK, INJURED, NOTE.
    if (pauseEvent) {
      try {
        const markerId = `lovable-pause-${pauseEvent.planId}`;
        // Clear any prior marker for this plan first so re-pauses don't stack.
        try {
          const existingResp = await fetch(
            `${baseUrl}/events?oldest=2000-01-01&newest=2100-01-01`,
            { headers: authHeaders }
          );
          if (existingResp.ok) {
            const existing = await existingResp.json();
            const stale = existing.filter((e: { external_id?: string }) => e.external_id === markerId);
            for (const evt of stale) {
              await fetch(`${baseUrl}/events/${evt.id}`, { method: "DELETE", headers: authHeaders });
            }
          }
        } catch { /* ignore */ }

        const payload = {
          category: pauseEvent.category,
          start_date_local: `${pauseEvent.start}T00:00:00`,
          end_date_local: `${pauseEvent.end}T23:59:59`,
          name: pauseEvent.name,
          external_id: markerId,
        };
        const resp = await fetch(`${baseUrl}/events`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          return new Response(
            JSON.stringify({ error: `Pause event create failed: ${resp.status} ${errText}` }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const created = await resp.json();
        return new Response(
          JSON.stringify({ created: true, id: created?.id, category: pauseEvent.category }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return new Response(
          JSON.stringify({ error: msg }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

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

    // Validate + log every workout before constructing the payload so any
    // date/title/duration mismatch is visible in the edge function logs.
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
    const seenDates = new Set<string>();
    const validationIssues: string[] = [];
    for (const w of workouts) {
      if (!ISO_DATE.test(w.date)) {
        validationIssues.push(`Invalid date "${w.date}" for "${w.name}"`);
      }
      if (seenDates.has(w.date)) {
        validationIssues.push(`Duplicate date ${w.date} — second occurrence: "${w.name}"`);
      }
      seenDates.add(w.date);
      const segSecs = w.steps.reduce((sum, s) => sum + s.duration, 0);
      const titleMin = Number(w.name.match(/\((?:Total:\s*)?(\d+)\s*min\)/i)?.[1] ?? NaN);
      if (Number.isFinite(titleMin) && Math.abs(titleMin - Math.round(segSecs / 60)) > 2) {
        validationIssues.push(
          `Duration mismatch on ${w.date} "${w.name}": title=${titleMin}min vs segments=${Math.round(segSecs/60)}min`,
        );
      }
      console.log(`[intervals-sync] IN  ${w.date} | ${w.name} | ${Math.round(segSecs/60)}min | ${w.steps.length} steps`);
    }
    if (validationIssues.length) {
      console.warn("[intervals-sync] validation issues:", validationIssues);
    }

    const eventsToSync = workouts.map((workout, idx) => {
      const fullDescription = formatWorkoutDescription(workout);
      const totalDuration = workout.steps.reduce((sum, s) => sum + s.duration, 0);
      const totalDistance = workout.steps.reduce((sum, s) => sum + paceToDistanceMeters(s.duration, s.pace), 0);

      const event = {
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
      console.log(`[intervals-sync] OUT ${event.start_date_local} | ${event.name} | ${Math.round(totalDuration/60)}min`);
      return event;
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
