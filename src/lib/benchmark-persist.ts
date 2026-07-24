/**
 * Confirm/reject writes for benchmark results.
 *
 * `confirmBenchmark` computes the effort window, scores confidence (now
 * including HR_SENSOR_WRIST and slowdown suppression), snapshots the
 * activity, and inserts a benchmark_results row with the FULL structured
 * post-benchmark interview payload. It also advances
 * profiles.next_benchmark_due by 6 weeks.
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
import { deriveLikelySubmaximal } from "@/lib/benchmark-rpe";
import type { InterviewAnswers } from "@/lib/benchmark-interview";
import type { DetectionResult } from "@/lib/benchmark-detection-signals";
import { INJURY_TAG } from "@/lib/benchmark-rpe";

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
  /** Full post-benchmark interview payload. */
  interview: InterviewAnswers;
  /** Detection signals used to drive the interview branching. */
  detection: DetectionResult;
  /**
   * hr_sensor_type resolved for scoring. Comes from Q9 if the athlete
   * answered this sitting, otherwise from the stored profile value.
   */
  hrSensorType: string | null;
}

export async function confirmBenchmark(
  params: ConfirmParams,
): Promise<{
  id: string;
  lthr: number | null;
  thresholdPaceSecPerKm: number;
  protocol: BenchmarkProtocol;
  confidenceDeductions: Array<{ reason: string; points: number }>;
  injuryFlagged: boolean;
}> {
  const {
    userId, planId, scheduledDateIso, protocol,
    activity, laps, manualDurationS, manualDistanceM,
    interview, detection, hrSensorType,
  } = params;

  // Derived once — same boolean feeds scoreConfidence AND the stored flag.
  const likelySubmaximal = deriveLikelySubmaximal(interview.rpe, interview.couldContinue);

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

  const thresholdHr = activity?.avg_heart_rate ?? null;
  const lthr = thresholdHr;

  const wristHrOnThresholdMeasurement =
    hrSensorType === "Watch wrist sensor" && typeof thresholdHr === "number" && thresholdHr > 0;

  const conf = scoreConfidence({
    hrStreamAvailable: !!activity?.avg_heart_rate,
    // Use the same fraction that drove detection so the deduction only fires
    // for detected fades. Suppression rule is applied inside scoreConfidence.
    secondHalfSlowdown: detection.slowdownFraction ?? 0,
    cadencePresent: true,
    gpsConfidence: "High",
    rpeSubmaximal: likelySubmaximal,
    effortWindowSource: effort.source,
    protocol,
    slowdownReason: interview.slowdownReason,
    wristHrOnThresholdMeasurement,
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

  const benchmarkDateIso =
    scheduledDateIso ?? (activity?.start_time?.slice(0, 10)) ?? new Date().toISOString().slice(0, 10);

  // Injury flag surfaces on its own — set true if "Old injury" was picked on
  // Q2, Q5, or Q6.
  const injuryFlagged =
    (interview.heldBackReasons ?? []).includes(INJURY_TAG as any) ||
    interview.slowdownReason === INJURY_TAG ||
    (interview.breaksReasons ?? []).includes(INJURY_TAG as any);

  const redoRequested = interview.redoChoice === "Yes, reschedule";

  const payload = {
    user_id: userId,
    training_plan_id: planId,
    scheduled_date: scheduledDateIso,
    benchmark_date: benchmarkDateIso,
    benchmark_protocol: protocol,
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
    confidence_deductions: conf.deductions,
    // Legacy single-choice columns kept in sync with the interview payload.
    rpe_response: interview.rpe,
    could_continue_response: interview.couldContinue,
    likely_submaximal: likelySubmaximal,
    // New structured columns.
    held_back_reasons: interview.heldBackReasons,
    slowdown_reason: interview.slowdownReason,
    breaks_reasons: interview.breaksReasons,
    stoppage_duration_band: interview.stoppageBand,
    conditions: interview.conditions,
    injury_flagged: injuryFlagged,
    redo_requested: redoRequested,
    post_benchmark_interview: {
      // Only holds items that DO NOT drive scoring or history filtering
      // (the verdict and any future free-form additions). Answers live in
      // their own CHECK-constrained columns above.
      captured_at: new Date().toISOString(),
      detection: {
        slowdown_detected: detection.slowdownDetected,
        slowdown_fraction: detection.slowdownFraction,
        breaks_detected: detection.breaksDetected,
        total_stoppage_s: detection.totalStoppageS,
      },
      hr_sensor_type_at_capture: hrSensorType ?? null,
      injury_note: interview.injuryNote ?? null,
      something_else_note: interview.somethingElseNote ?? null,
    },
    activity_snapshot: snapshot,
  };

  const { data, error } = await supabase
    .from("benchmark_results" as any)
    .insert(payload as any)
    .select("id")
    .single();
  if (error) throw error;

  const id = (data as any).id as string;

  // Persist hr_sensor_type on profile if Q9 was answered this sitting.
  if (interview.hrSensorType) {
    await supabase
      .from("profiles")
      .update({ hr_sensor_type: interview.hrSensorType } as any)
      .eq("user_id", userId);
  }

  // NOTE: hr_zones is written only via applyMeasuredZones (behind the zone
  // comparison dialog).

  await supabase
    .from("profiles")
    .update({ next_benchmark_due: addWeeksIso(benchmarkDateIso, NEXT_BENCHMARK_WEEKS) } as any)
    .eq("user_id", userId);

  return {
    id, lthr, thresholdPaceSecPerKm: pace, protocol,
    confidenceDeductions: conf.deductions, injuryFlagged,
  };
}

/**
 * Save the AI coach verdict onto an existing benchmark row. Failure to save
 * it must never roll back the benchmark itself.
 */
export async function saveBenchmarkVerdict(
  benchmarkId: string,
  verdictMarkdown: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("benchmark_results" as any)
    .select("post_benchmark_interview")
    .eq("id", benchmarkId)
    .maybeSingle();
  const merged = {
    ...(((existing as any)?.post_benchmark_interview as Record<string, unknown>) ?? {}),
    verdict: verdictMarkdown,
    verdict_at: new Date().toISOString(),
  };
  await supabase
    .from("benchmark_results" as any)
    .update({ post_benchmark_interview: merged } as any)
    .eq("id", benchmarkId);
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
