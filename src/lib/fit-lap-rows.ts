import type { ParsedLap } from "@/lib/fit-parser";

/**
 * Pure mapping: FIT-parsed laps → `activity_laps` insert payload.
 * Extracted from Upload.tsx so it can be regression-tested against a
 * checked-in fixture without needing a Supabase client or browser.
 *
 * Contract: given the same (userId, activityId, laps) input the output
 * must be byte-identical run-to-run. Any change here is a behavior change
 * to activity import and must update the golden snapshot deliberately.
 */
export function buildFitLapRows(
  userId: string,
  activityId: string,
  laps: ParsedLap[],
): Array<Record<string, unknown>> {
  return laps.map((lap) => ({
    user_id: userId,
    activity_id: activityId,
    lap_index: lap.lap_index,
    start_time: lap.start_time,
    elapsed_time_s: lap.elapsed_time_s,
    moving_time_s: lap.moving_time_s,
    distance_m: lap.distance_m,
    avg_heart_rate: lap.avg_heart_rate,
    max_heart_rate: lap.max_heart_rate,
    avg_speed_mps: lap.avg_speed_mps,
    max_speed_mps: lap.max_speed_mps,
    avg_cadence: lap.avg_cadence,
    avg_power: lap.avg_power,
    max_power: lap.max_power,
    total_ascent_m: lap.total_ascent_m,
    total_descent_m: lap.total_descent_m,
    lap_trigger: lap.lap_trigger,
    source: "fit",
    raw: lap.raw ?? {},
  }));
}
