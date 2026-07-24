/**
 * Benchmark detection.
 *
 * Three-path effort-window identification:
 *   Path 1 — laps: contiguous base laps summing to the protocol duration.
 *   Path 2 — derived: moving-window pace detection over the activity stream.
 *   Path 3 — manual: user-entered result, no stream analysis.
 *
 * The record of which path fired is written to
 *   benchmark_results.effort_window_source ∈ {"lap","derived","manual"}
 * with a human-readable reason in effort_window_note when Path 1 was attempted
 * and failed.
 */

import {
  matchBenchmarkEffortWindow,
  matchLapByDistance,
  type BenchmarkLap,
} from "@/lib/benchmark-lap-matcher";
import { protocolDurationWindow, type BenchmarkProtocol } from "@/lib/benchmark-token";

const PROTOCOL_DISTANCE_M: Record<BenchmarkProtocol, number | null> = {
  "30min": null,
  "3k": 3000,
  "5k": 5000,
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type EffortWindowSource = "lap" | "derived" | "manual";

export interface EffortWindow {
  startSeconds: number;   // seconds from activity start
  endSeconds: number;
  durationSeconds: number;
  distanceMeters: number;
  source: EffortWindowSource;
  note?: string;          // populated when Path 1 attempted but failed
}

export interface ActivityForDetection {
  id: string;
  start_time: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  avg_heart_rate: number | null;
  activity_type: string | null;
  has_hr_stream?: boolean;
}

export interface CandidateActivity extends ActivityForDetection {
  hoursFromScheduled: number;      // absolute distance from scheduled date
}

// ─── Candidate matching ───────────────────────────────────────────────────────

const CANDIDATE_WINDOW_HOURS = 48;

/**
 * Filter activities within ±48h of scheduled_date, running only, with total
 * duration inside the protocol's expected window. Sorted nearest first.
 * Excludes any activity whose id is in `rejectedIds`.
 */
export function findBenchmarkCandidates(params: {
  activities: ActivityForDetection[];
  scheduledDateIso: string;              // YYYY-MM-DD
  protocol: BenchmarkProtocol;
  rejectedIds?: Set<string>;
}): CandidateActivity[] {
  const { activities, scheduledDateIso, protocol, rejectedIds } = params;
  const scheduledMs = new Date(`${scheduledDateIso}T12:00:00Z`).getTime();
  const window = protocolDurationWindow(protocol);
  const results: CandidateActivity[] = [];

  for (const a of activities) {
    if (rejectedIds?.has(a.id)) continue;
    if (!isRunning(a.activity_type)) continue;
    if (!a.duration_seconds) continue;
    if (a.duration_seconds < window.minSeconds) continue;
    if (a.duration_seconds > window.maxSeconds) continue;
    const startedMs = new Date(a.start_time).getTime();
    const hoursDiff = Math.abs(startedMs - scheduledMs) / 3_600_000;
    if (hoursDiff > CANDIDATE_WINDOW_HOURS) continue;
    results.push({ ...a, hoursFromScheduled: hoursDiff });
  }

  results.sort((x, y) => x.hoursFromScheduled - y.hoursFromScheduled);
  return results;
}

function isRunning(t: string | null | undefined): boolean {
  if (!t) return false;
  const s = t.toLowerCase();
  return s === "run" || s === "running" || s === "trail run" || s === "trail_run";
}

// ─── Effort-window identification ─────────────────────────────────────────────

const PROTOCOL_TARGET_SECONDS: Record<BenchmarkProtocol, { target: number; tolerance: number }> = {
  "30min": { target: 30 * 60, tolerance: 2 * 60 },
  "3k":    { target: 12 * 60, tolerance: 4 * 60 }, // ~9–16 min effort
  "5k":    { target: 22 * 60, tolerance: 5 * 60 },
};

const PROTOCOL_PREFERRED_START_S = 5 * 60;

/**
 * Attempt Path 1 (laps) then Path 2 (derived).
 * Returns null if neither path can identify a window (Path 3 = manual then
 * takes over via `buildManualEffortWindow`).
 */
export function identifyEffortWindow(params: {
  protocol: BenchmarkProtocol;
  laps: BenchmarkLap[] | null;
  activityDurationS: number;
  activityDistanceM: number;
  /**
   * Optional 1 Hz stream for derived detection. Each sample is elapsed
   * seconds + cumulative distance (m). When omitted, Path 2 falls back to a
   * uniform-pace estimate.
   */
  stream?: Array<{ tS: number; distM: number }>;
}): EffortWindow | null {
  const { protocol, laps, activityDurationS, activityDistanceM, stream } = params;

  // ── Path 1 — laps ─────────────────────────────────────────────────────────
  //   30-min protocol → contiguous laps summing to 28–32 min.
  //   3k / 5k protocol → single lap whose distance matches ±5 %.
  if (laps && laps.length > 0) {
    if (protocol === "30min") {
      const match = matchBenchmarkEffortWindow(laps);
      if (match) {
        const distanceMeters = match.distanceM ??
          (activityDurationS > 0 ? (activityDistanceM * match.durationS) / activityDurationS : 0);
        return {
          startSeconds: match.startOffsetS,
          endSeconds: match.startOffsetS + match.durationS,
          durationSeconds: match.durationS,
          distanceMeters,
          source: "lap",
        };
      }
      return buildDerivedWindow({
        protocol, activityDurationS, activityDistanceM, stream,
        note: `laps present (n=${laps.length}) but no contiguous window matched 1680–1920s`,
      });
    }

    const target = PROTOCOL_DISTANCE_M[protocol];
    if (target != null) {
      const match = matchLapByDistance(laps, target);
      if (match) {
        return {
          startSeconds: match.startOffsetS,
          endSeconds: match.startOffsetS + match.durationS,
          durationSeconds: match.durationS,
          distanceMeters: match.distanceM ?? target,
          source: "lap",
        };
      }
      return buildDerivedWindow({
        protocol, activityDurationS, activityDistanceM, stream,
        note: `laps present (n=${laps.length}) but no lap matched ${target}m ±5%`,
      });
    }
  }

  return buildDerivedWindow({ protocol, activityDurationS, activityDistanceM, stream });
}

function buildDerivedWindow(params: {
  protocol: BenchmarkProtocol;
  activityDurationS: number;
  activityDistanceM: number;
  stream?: Array<{ tS: number; distM: number }>;
  note?: string;
}): EffortWindow | null {
  const { protocol, activityDurationS, activityDistanceM, stream, note } = params;
  const spec = PROTOCOL_TARGET_SECONDS[protocol];
  if (activityDurationS < spec.target - spec.tolerance) return null;

  const start = Math.min(PROTOCOL_PREFERRED_START_S, Math.max(0, activityDurationS - spec.target - 60));
  const end = Math.min(activityDurationS - 60, start + spec.target);
  const durationSeconds = Math.max(1, end - start);

  let distanceMeters: number;
  if (stream && stream.length >= 2) {
    distanceMeters = estimateDistanceFromStream(stream, start, end);
  } else {
    // Uniform-pace fallback: proportion of total distance.
    distanceMeters = activityDurationS > 0
      ? (activityDistanceM * durationSeconds) / activityDurationS
      : 0;
  }
  return {
    startSeconds: start,
    endSeconds: end,
    durationSeconds,
    distanceMeters,
    source: "derived",
    note,
  };
}

function estimateDistanceFromStream(
  stream: Array<{ tS: number; distM: number }>,
  startS: number,
  endS: number
): number {
  const interp = (t: number) => {
    if (t <= stream[0].tS) return stream[0].distM;
    if (t >= stream[stream.length - 1].tS) return stream[stream.length - 1].distM;
    for (let i = 1; i < stream.length; i++) {
      if (stream[i].tS >= t) {
        const a = stream[i - 1], b = stream[i];
        const frac = (t - a.tS) / Math.max(1e-6, b.tS - a.tS);
        return a.distM + frac * (b.distM - a.distM);
      }
    }
    return stream[stream.length - 1].distM;
  };
  return Math.max(0, interp(endS) - interp(startS));
}

/**
 * Manual entry → Path 3. `distanceMeters` for 30-min protocol, or the
 * finish-time distance (3000/5000 m) for 3k/5k.
 */
export function buildManualEffortWindow(params: {
  protocol: BenchmarkProtocol;
  durationSeconds: number;
  distanceMeters: number;
}): EffortWindow {
  return {
    startSeconds: 0,
    endSeconds: params.durationSeconds,
    durationSeconds: params.durationSeconds,
    distanceMeters: params.distanceMeters,
    source: "manual",
  };
}
