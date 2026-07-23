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
  zonesFromLthr,
} from "@/lib/benchmark-calculations";

const NEXT_BENCHMARK_WEEKS = 6;

function addWeeksIso(baseIso: string, weeks: number): string {
  const d = new Date(`${baseIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

/** Riegel prediction — same exponent used across all four race distances. */
function riegel(distanceM: number, durationS: number, targetM: number): number {
  const ratio = targetM / distanceM;
  return Math.round(durationS * Math.pow(ratio, BenchmarkConfig.PREDICTED_5K_EXPONENT));
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
  /** True when the athlete flags the effort as submaximal. */
  rpeSubmaximal?: boolean;
}

export async function confirmBenchmark(params: ConfirmParams): Promise<{ id: string }> {
  const {
    userId, planId, scheduledDateIso, protocol,
    activity, laps, manualDurationS, manualDistanceM, rpeSubmaximal,
  } = params;

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

  const pace = thresholdPaceSecPerKm(effort.distanceMeters, effort.durationSeconds);
  const predicted5k = Math.round(predict5kSeconds(effort.distanceMeters, effort.durationSeconds));
  const predicted10k = riegel(effort.distanceMeters, effort.durationSeconds, 10_000);
  const predictedHalf = riegel(effort.distanceMeters, effort.durationSeconds, 21_097);
  const predictedFull = riegel(effort.distanceMeters, effort.durationSeconds, 42_195);

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
    predicted_10k_seconds: predicted10k,
    predicted_half_seconds: predictedHalf,
    predicted_full_seconds: predictedFull,
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

  // Upsert measured HR zones pinned to this benchmark.
  if (lthr && lthr > 0) {
    const z = zonesFromLthr(lthr);
    await supabase.from("hr_zones" as any).insert({
      user_id: userId,
      source: "measured",
      benchmark_result_id: id,
      lthr,
      z1_max: z.z1Max,
      z2_max: z.z2Max,
      z3_max: z.z3Max,
      z4_max: z.z4Max,
      effective_from: effortEndTime ?? new Date().toISOString(),
    } as any);
  }

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
