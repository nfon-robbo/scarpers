/**
 * reprocessBenchmark(benchmarkId)
 *
 * Recomputes every DERIVED field on a benchmark_results row from the
 * stored raw inputs (activity + laps + interview answers). Runs through
 * the SAME code path confirmBenchmark uses so no derived value ever gets
 * hand-patched by SQL.
 *
 * Inputs preserved (never overwritten):
 *   - user_id, training_plan_id, scheduled_date, benchmark_date, protocol,
 *     activity_id, capture_method, status, active
 *   - interview answers: rpe_response, could_continue_response,
 *     held_back_reasons, slowdown_reason, breaks_reasons,
 *     stoppage_duration_band, conditions, injury_flagged, redo_requested,
 *     post_benchmark_interview (verdict, hr_sensor_type_at_capture, notes)
 *
 * Recomputed:
 *   - effort_window_* (start/end/duration/distance/source/stopped)
 *   - threshold_pace_s_per_km (moving-time based)
 *   - threshold_hr, lthr (lap-weighted on moving time)
 *   - predicted_5k_seconds, riegel_exponent
 *   - confidence_score, confidence_band, confidence_deductions
 *   - likely_submaximal
 *
 * Manual entries (capture_method='manual', activity_id=null) skip the
 * effort window recomputation and only re-score confidence / re-derive
 * predictions from the stored effort_window_* values.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  identifyEffortWindow,
  buildManualEffortWindow,
  type ActivityForDetection,
} from "@/lib/benchmark-detection";
import type { BenchmarkLap } from "@/lib/benchmark-lap-matcher";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import {
  BenchmarkConfig,
  scoreConfidence,
  thresholdPaceSecPerKm,
  predict5kSeconds,
} from "@/lib/benchmark-calculations";
import { deriveLikelySubmaximal } from "@/lib/benchmark-rpe";
import { detectBenchmarkSignals } from "@/lib/benchmark-detection-signals";

export interface ReprocessResult {
  benchmarkId: string;
  protocol: BenchmarkProtocol;
  effort: {
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;   // moving
    elapsedSeconds: number;
    stoppedSeconds: number;
    distanceMeters: number;
    source: string;
  };
  thresholdPaceSecPerKm: number;
  thresholdHr: number | null;
  lthr: number | null;
  predicted5kSeconds: number;
  confidence: {
    score: number;
    band: string;
    deductions: Array<{ reason: string; points: number }>;
  };
  detection: {
    slowdownDetected: boolean;
    slowdownFraction: number | null;
    breaksDetected: boolean;
    totalStoppageS: number | null;
  };
}

export async function reprocessBenchmark(
  benchmarkId: string,
): Promise<ReprocessResult> {
  const { data: rowRaw, error: rowErr } = await supabase
    .from("benchmark_results" as any)
    .select("*")
    .eq("id", benchmarkId)
    .single();
  if (rowErr) throw rowErr;
  const row = rowRaw as any;

  const protocol = row.benchmark_protocol as BenchmarkProtocol;
  const isManual = row.capture_method === "manual" || !row.activity_id;

  // Q9 answer (if any) takes precedence over the profile value, matching
  // confirmBenchmark. Fall back to whatever was recorded at capture.
  const hrSensorType =
    (row.post_benchmark_interview?.hr_sensor_type_at_capture as string | null) ??
    null;

  // Interview payload — mirror the shape confirmBenchmark builds.
  const interview = {
    rpe: row.rpe_response ?? null,
    couldContinue: row.could_continue_response ?? null,
    heldBackReasons: row.held_back_reasons ?? [],
    slowdownReason: row.slowdown_reason ?? null,
    breaksReasons: row.breaks_reasons ?? [],
    stoppageBand: row.stoppage_duration_band ?? null,
    conditions: row.conditions ?? [],
  };
  const likelySubmaximal = deriveLikelySubmaximal(
    interview.rpe,
    interview.couldContinue,
  );

  // Load activity + laps for the auto path.
  let activity: ActivityForDetection | null = null;
  let laps: BenchmarkLap[] | null = null;
  if (!isManual) {
    const { data: act, error: actErr } = await supabase
      .from("activities")
      .select(
        "id, start_time, duration_seconds, distance_meters, avg_heart_rate, activity_type",
      )
      .eq("id", row.activity_id)
      .maybeSingle();
    if (actErr) throw actErr;
    if (!act) throw new Error(`activity ${row.activity_id} not found`);
    activity = act as any;
    (activity as any).has_hr_stream = act.avg_heart_rate != null;

    const { data: lapRows, error: lapErr } = await supabase
      .from("activity_laps" as any)
      .select("lap_index, elapsed_time_s, moving_time_s, distance_m, avg_heart_rate")
      .eq("activity_id", row.activity_id)
      .order("lap_index", { ascending: true });
    if (lapErr) throw lapErr;
    laps = (lapRows ?? []) as unknown as BenchmarkLap[];
  }

  // Effort window — same helpers as confirmBenchmark.
  const effort = isManual
    ? buildManualEffortWindow({
        protocol,
        durationSeconds: Number(row.effort_window_duration_s ?? 0),
        distanceMeters: Number(row.effort_window_distance_m ?? 0),
      })
    : identifyEffortWindow({
        protocol,
        laps,
        activityDurationS: Number(activity!.duration_seconds ?? 0),
        activityDistanceM: Number(activity!.distance_meters ?? 0),
      });
  if (!effort || effort.durationSeconds <= 0 || effort.distanceMeters <= 0) {
    throw new Error("reprocessBenchmark: could not identify a valid effort window");
  }

  const pace = thresholdPaceSecPerKm(effort.distanceMeters, effort.durationSeconds);
  const predicted5k = Math.round(
    predict5kSeconds(effort.distanceMeters, effort.durationSeconds),
  );

  // Lap-weighted (moving) HR across the effort laps; fall back to the
  // activity's overall avg only when no lap HR is available.
  let thresholdHr: number | null = null;
  const effortLaps = effort.effortLaps ?? [];
  const lapsWithHr = effortLaps.filter(
    (l) => typeof l.avg_heart_rate === "number" && (l.avg_heart_rate as number) > 0,
  );
  if (lapsWithHr.length > 0) {
    let w = 0, hrSum = 0;
    for (const l of lapsWithHr) {
      const weight =
        typeof l.moving_time_s === "number" && l.moving_time_s > 0
          ? Number(l.moving_time_s)
          : Number(l.elapsed_time_s || 0);
      if (weight > 0) {
        w += weight;
        hrSum += Number(l.avg_heart_rate) * weight;
      }
    }
    if (w > 0) thresholdHr = Math.round(hrSum / w);
  }
  if (thresholdHr == null) thresholdHr = activity?.avg_heart_rate ?? null;
  const lthr = thresholdHr;

  // Detection signals (distance-midpoint half split).
  const detection = detectBenchmarkSignals(
    (laps ?? []).filter((l) => {
      // Only the effort-window laps feed the signal, otherwise warm-up
      // and cool-down laps dominate the split.
      if (effort.effortLaps && effort.effortLaps.length > 0) {
        return effort.effortLaps.some((el) => el.lap_index === l.lap_index);
      }
      return true;
    }),
  );

  const wristHrOnThresholdMeasurement =
    hrSensorType === "Watch wrist sensor" &&
    typeof thresholdHr === "number" &&
    thresholdHr > 0;

  const conf = scoreConfidence({
    hrStreamAvailable: !!activity?.avg_heart_rate,
    secondHalfSlowdown: detection.slowdownFraction ?? 0,
    cadencePresent: true,
    gpsConfidence: "High",
    rpeSubmaximal: likelySubmaximal,
    effortWindowSource: effort.source,
    protocol,
    slowdownReason: interview.slowdownReason,
    wristHrOnThresholdMeasurement,
    timerStoppedSInEffort: effort.stoppedSeconds ?? 0,
  });

  const effortStartTime = activity?.start_time
    ? new Date(new Date(activity.start_time).getTime() + effort.startSeconds * 1000).toISOString()
    : null;
  const effortEndTime = activity?.start_time
    ? new Date(new Date(activity.start_time).getTime() + effort.endSeconds * 1000).toISOString()
    : null;

  // Refresh the detection block on the interview payload but preserve
  // everything else (verdict, notes, hr_sensor_type_at_capture).
  const mergedInterview = {
    ...((row.post_benchmark_interview as Record<string, unknown>) ?? {}),
    detection: {
      slowdown_detected: detection.slowdownDetected,
      slowdown_fraction: detection.slowdownFraction,
      breaks_detected: detection.breaksDetected,
      total_stoppage_s: detection.totalStoppageS,
    },
    reprocessed_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from("benchmark_results" as any)
    .update({
      effort_window_start_time: effortStartTime,
      effort_window_end_time: effortEndTime,
      effort_window_duration_s: effort.durationSeconds,
      effort_window_distance_m: effort.distanceMeters,
      effort_window_source: effort.source,
      effort_window_note: effort.note ?? null,
      effort_window_stopped_s: effort.stoppedSeconds ?? 0,
      threshold_pace_s_per_km: pace,
      threshold_hr: thresholdHr,
      lthr,
      riegel_exponent: BenchmarkConfig.PREDICTED_5K_EXPONENT,
      predicted_5k_seconds: predicted5k,
      confidence_score: conf.score,
      confidence_band: conf.band,
      confidence_deductions: conf.deductions,
      likely_submaximal: likelySubmaximal,
      post_benchmark_interview: mergedInterview,
    } as any)
    .eq("id", benchmarkId);
  if (updErr) throw updErr;

  return {
    benchmarkId,
    protocol,
    effort: {
      startSeconds: effort.startSeconds,
      endSeconds: effort.endSeconds,
      durationSeconds: effort.durationSeconds,
      elapsedSeconds: effort.elapsedSeconds ?? effort.durationSeconds,
      stoppedSeconds: effort.stoppedSeconds ?? 0,
      distanceMeters: effort.distanceMeters,
      source: effort.source,
    },
    thresholdPaceSecPerKm: pace,
    thresholdHr,
    lthr,
    predicted5kSeconds: predicted5k,
    confidence: conf,
    detection,
  };
}
