import { parseFitBuffer } from "@/lib/fit-parser";
import { buildFitLapRows } from "@/lib/fit-lap-rows";
import { supabase } from "@/integrations/supabase/client";

export interface FitEnrichResult {
  updatedFields: string[];
  lapCount: number;
  gpsPoints: number;
}

/**
 * Enrich an already-detected activity with data parsed from a user-supplied
 * .fit file. FIT is the highest-fidelity source, so its values overwrite the
 * existing row and its laps replace any previously stored laps.
 */
export async function enrichActivityFromFitFile(
  userId: string,
  activityId: string,
  file: File,
): Promise<FitEnrichResult> {
  const buffer = await file.arrayBuffer();
  const parsed = await parseFitBuffer(buffer, file.name);
  if (!parsed.length) throw new Error("No activity data found in that FIT file.");

  // Pick the session with the most distance/duration (usually the only one).
  const a = parsed.reduce((best, cur) =>
    (cur.distance_meters ?? 0) + (cur.duration_seconds ?? 0) >
    (best.distance_meters ?? 0) + (best.duration_seconds ?? 0)
      ? cur
      : best,
  );

  const patch: Record<string, unknown> = {};
  const map: Record<string, unknown> = {
    activity_type: a.activity_type,
    start_time: a.start_time,
    duration_seconds: a.duration_seconds,
    distance_meters: a.distance_meters,
    avg_heart_rate: a.avg_heart_rate,
    max_heart_rate: a.max_heart_rate,
    avg_speed: a.avg_speed,
    max_speed: a.max_speed,
    avg_power: a.avg_power,
    max_power: a.max_power,
    avg_cadence: a.avg_cadence,
    total_ascent: a.total_ascent,
    total_descent: a.total_descent,
    calories: a.calories,
    avg_temperature: a.avg_temperature,
    training_effect: a.training_effect,
  };
  for (const [k, v] of Object.entries(map)) {
    if (v !== null && v !== undefined) patch[k] = v;
  }
  patch.source_file = a.source_file;
  patch.raw_data = { ...(a.raw_data as object), gps_track: a.gps_track };

  const { error } = await supabase
    .from("activities")
    .update(patch as any)
    .eq("id", activityId)
    .eq("user_id", userId);
  if (error) throw error;

  // Replace laps — FIT laps are authoritative.
  let lapCount = 0;
  const lapRows = buildFitLapRows(userId, activityId, a.laps || []);
  if (lapRows.length > 0) {
    await supabase.from("activity_laps").delete().eq("activity_id", activityId).eq("user_id", userId);
    const { error: lapErr } = await supabase.from("activity_laps").insert(lapRows as any);
    if (lapErr) console.warn("[fit-enrich] lap insert failed (non-fatal):", lapErr);
    else lapCount = lapRows.length;
  }

  return {
    updatedFields: Object.keys(map).filter((k) => map[k] !== null && map[k] !== undefined),
    lapCount,
    gpsPoints: a.gps_track?.length ?? 0,
  };
}
