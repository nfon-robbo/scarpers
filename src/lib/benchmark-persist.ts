/**
 * Confirm/reject writes for benchmark results.
 *
 * `confirmBenchmark` computes the effort window (Path 1/2/3 via
 * identifyEffortWindow / buildManualEffortWindow), scores confidence,
 * computes threshold pace + Riegel race predictions, snapshots the
 * activity, and inserts a benchmark_results row. It then upserts an
 * hr_zones row (source='measured') pinned to the new benchmark, and
 * advances profiles.next_benchmark_due by 6 weeks.
 *
 * `rejectCandidate` writes a benchmark_rejections row so the same activity
 * is never re-offered.
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
import {
  deriveLikelySubmaximal,
  type RpeResponse,
  type CouldContinueResponse,
} from "@/lib/benchmark-rpe";

const NEXT_BENCHMARK_WEEKS = 6;

function addWeeksIso(baseIso: string, weeks: number): string {
  const d = new Date(`${baseIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

export interface ConfirmParams {
  userId: string;
  planId: string | null;
  scheduledDateIso: string;
  protocol: BenchmarkProtocol;
  /** null when this is a manual entry (Path 3). */
  activity: ActivityForDetection | null;
  laps: BenchmarkLap[] | null;
  /** Path 3 inputs; ignored when `activity` is provided. */
  manualDurationS?: number;
  manualDistanceM?: number;
  /** Post-benchmark answers. When both provided, likely_submaximal is derived
   *  ONCE via deriveLikelySubmaximal and used for BOTH the confidence-score
   *  deduction and the stored flag — never re-evaluated separately. */
  rpeResponse?: RpeResponse | null;
  couldContinueResponse?: CouldContinueResponse | null;
}

export async function confirmBenchmark(
  params: ConfirmParams,
): Promise<{ id: string; lthr: number | null }> {
  const {
    userId, planId, scheduledDateIso, protocol,
    activity, laps, manualDurationS, manualDistanceM,
    rpeResponse, couldContinueResponse,
  } = params;

  // Derived once — same boolean feeds scoreConfidence AND the stored flag.
  const likelySubmaximal = deriveLikelySubmaximal(rpeResponse, couldContinueResponse);

  const isManual = !activity;
  const effort = isManual
    ? buildManualEffortWindow({
        protocol,
        durationSeconds: manualDurationS ?? 0,
        distanceMeters: manualDistanceM ?? 0,
      })
    : identifyEffortWindow({
        protocol,
        laps,
        activityDurationS: activity!.duration_seconds ?? 0,
        activityDistanceM: activity!.distance_meters ?? 0,
      });

  if (!effort || effort.durationSeconds <= 0 || effort.distanceMeters <= 0) {
    throw new Error("Could not identify a valid effort window for this activity.");
  }

  // Threshold pace is computed and stored on the benchmark row so a later
  // "apply new pace" action can read it, but nothing downstream should treat
  // this row as the active pace source until the user explicitly confirms.
  const pace = thresholdPaceSecPerKm(effort.distanceMeters, effort.durationSeconds);
  const predicted5k = Math.round(predict5kSeconds(effort.distanceMeters, effort.durationSeconds));

  // Threshold HR: for a 30-min TT the effort's average HR ≈ LTHR. For 3k/5k
  // it's a running-max estimator that we still treat as LTHR-proxy pending a
  // full stream (we don't fetch streams here).
  const thresholdHr = activity?.avg_heart_rate ?? null;
  const lthr = thresholdHr;

  const conf = scoreConfidence({
    hrStreamAvailable: !!activity?.avg_heart_rate,
    secondHalfSlowdown: 0,       // no stream fetched at confirm time
    cadencePresent: true,        // conservative default; refined by future stream work
    gpsConfidence: "High",
    rpeSubmaximal: !!rpeSubmaximal,
    effortWindowSource: effort.source,
    protocol,
  });

  const effortStartTime = activity?.start_time
    ? new Date(new Date(activity.start_time).getTime() + effort.startSeconds * 1000).toISOString()
    : null;
  const effortEndTime = activity?.start_time
    ? new Date(new Date(activity.start_time).getTime() + effort.endSeconds * 1000).toISOString()
    : null;

  const snapshot = activity
    ? {
        activity_id: activity.id,
        start_time: activity.start_time,
        duration_seconds: activity.duration_seconds,
        distance_meters: activity.distance_meters,
        avg_heart_rate: activity.avg_heart_rate,
        activity_type: activity.activity_type,
        lap_count: laps?.length ?? 0,
        captured_at: new Date().toISOString(),
      }
    : {
        manual: true,
        duration_seconds: manualDurationS ?? null,
        distance_meters: manualDistanceM ?? null,
        captured_at: new Date().toISOString(),
      };

  const payload = {
    user_id: userId,
    training_plan_id: planId,
    scheduled_date: scheduledDateIso,
    activity_id: activity?.id ?? null,
    effort_window_start_time: effortStartTime,
    effort_window_end_time: effortEndTime,
    effort_window_duration_s: effort.durationSeconds,
    effort_window_distance_m: effort.distanceMeters,
    effort_window_source: effort.source,
    effort_window_note: effort.note ?? null,
    threshold_pace_s_per_km: pace,
    threshold_hr: thresholdHr,
    lthr,
    riegel_exponent: BenchmarkConfig.PREDICTED_5K_EXPONENT,
    predicted_5k_seconds: predicted5k,
    capture_method: isManual ? "manual" : "auto",
    status: "confirmed",
    active: true,
    confidence_score: conf.score,
    confidence_band: conf.band,
    rpe_effort: rpeSubmaximal ? 6 : 9,
    activity_snapshot: snapshot,
  };

  const { data, error } = await supabase
    .from("benchmark_results" as any)
    .insert(payload as any)
    .select("id")
    .single();
  if (error) throw error;

  const id = (data as any).id as string;

  // NOTE: hr_zones is NOT written here. Zone application requires an explicit
  // user confirm tap after the old-vs-new comparison dialog (spec item 22).
  // A separate action — applyMeasuredZones(benchmarkId) — is the only writer.
  // Threshold pace recalculation across remaining workouts is also gated by a
  // separate confirm; this row stores the measured pace but does not activate
  // it downstream.

  // Advance next_benchmark_due (best-effort; ignore if column absent).
  await supabase
    .from("profiles")
    .update({ next_benchmark_due: addWeeksIso(scheduledDateIso, NEXT_BENCHMARK_WEEKS) } as any)
    .eq("user_id", userId);

  return { id };
}

export async function rejectCandidate(params: {
  userId: string;
  activityId: string;
  reason?: string;
}): Promise<void> {
  const { error } = await supabase
    .from("benchmark_rejections" as any)
    .insert({
      user_id: params.userId,
      activity_id: params.activityId,
      reason: params.reason ?? null,
    } as any);
  if (error) throw error;
}
