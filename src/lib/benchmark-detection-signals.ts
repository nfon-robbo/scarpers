/**
 * Post-benchmark detection signals — pure functions over the activity row
 * and its laps. Used to decide whether Q5 (slowdown) and Q6 (breaks) should
 * appear in the interview.
 *
 * ONE slowdown threshold — reused from BenchmarkConfig so detection and
 * scoring can never disagree.
 */
import { BenchmarkConfig } from "@/lib/benchmark-calculations";

/** Stoppage threshold: sum(elapsed - moving) across laps > this triggers Q6. */
export const BREAK_STOPPAGE_THRESHOLD_S = 30;

export interface DetectionLap {
  lap_index?: number | null;
  elapsed_time_s?: number | null;
  moving_time_s?: number | null;
  distance_m?: number | null;
}

export interface DetectionResult {
  slowdownDetected: boolean;
  breaksDetected: boolean;
  /** Diagnostic values, not persisted — helpful for logs/tests. */
  slowdownFraction: number | null;
  totalStoppageS: number | null;
}

/**
 * Detect a second-half slowdown from laps: split laps at the MIDPOINT OF
 * DISTANCE (with linear interpolation inside the lap where the midpoint
 * falls), compute avg pace (s/km) per half using MOVING time, return
 * (second - first) / first. Positive means the second half was slower.
 *
 * Distance midpoint — not time midpoint. Lap boundaries never fall exactly
 * on the halfway mark, so a cumulative-time split gives one half more
 * distance than the other and the pace comparison is not apples-to-apples.
 * Interpolating on distance guarantees equal-distance halves regardless of
 * lap boundaries.
 *
 * MOVING time — not elapsed. Timer stops (auto-pause, watch pauses) inflate
 * elapsed on affected laps and can make a genuine second-half fade look
 * like a first-half fade. The stoppage penalty is already scored separately
 * via TIMER_STOPPED_IN_EFFORT; this signal is about pacing so it must
 * ignore paused time. Falls back to elapsed only when NO lap carries
 * moving_time_s.
 *
 * Uses the same threshold as the SECOND_HALF_SLOWDOWN deduction.
 */
export function detectSecondHalfSlowdownFromLaps(
  laps: DetectionLap[] | null | undefined,
): { detected: boolean; fraction: number | null } {
  const anyMoving = (laps ?? []).some((l) => (l.moving_time_s ?? 0) > 0);
  const timeOf = (l: DetectionLap): number =>
    anyMoving
      ? Number(l.moving_time_s ?? 0)
      : Number(l.elapsed_time_s ?? 0);

  const valid = (laps ?? []).filter(
    (l) => timeOf(l) > 0 && (l.distance_m ?? 0) > 0,
  );
  if (valid.length < 2) return { detected: false, fraction: null };

  const totalDist = valid.reduce((s, l) => s + Number(l.distance_m ?? 0), 0);
  if (totalDist <= 0) return { detected: false, fraction: null };

  const half = totalDist / 2;
  let cumDist = 0;
  let t1 = 0, d1 = 0, t2 = 0, d2 = 0;
  for (const l of valid) {
    const ld = Number(l.distance_m ?? 0);
    const lt = timeOf(l);
    if (ld <= 0 || lt <= 0) continue;
    const lapEnd = cumDist + ld;
    if (lapEnd <= half) {
      // Entire lap is in first half.
      t1 += lt; d1 += ld;
    } else if (cumDist >= half) {
      // Entire lap is in second half.
      t2 += lt; d2 += ld;
    } else {
      // Lap straddles the midpoint — split by distance fraction and assume
      // uniform pace inside the lap for the time allocation.
      const distToMid = half - cumDist;
      const frac = distToMid / ld;
      t1 += lt * frac;      d1 += distToMid;
      t2 += lt * (1 - frac); d2 += ld - distToMid;
    }
    cumDist = lapEnd;
  }
  if (d1 <= 0 || d2 <= 0) return { detected: false, fraction: null };

  const p1 = t1 / (d1 / 1000);
  const p2 = t2 / (d2 / 1000);
  if (p1 <= 0) return { detected: false, fraction: null };

  const frac = (p2 - p1) / p1;
  const detected = frac >= BenchmarkConfig.SECOND_HALF_SLOWDOWN_THRESHOLD;
  return { detected, fraction: frac };
}


/**
 * Detect breaks from laps: sum(elapsed - moving) across laps. Requires
 * moving_time_s populated on at least one lap; otherwise inconclusive
 * (returns detected=false so we don't ask a question we can't back up).
 */
export function detectBreaksFromLaps(
  laps: DetectionLap[] | null | undefined,
): { detected: boolean; totalStoppageS: number | null } {
  const withMoving = (laps ?? []).filter(
    (l) => (l.elapsed_time_s ?? 0) > 0 && (l.moving_time_s ?? 0) > 0,
  );
  if (withMoving.length === 0) return { detected: false, totalStoppageS: null };

  const total = withMoving.reduce(
    (s, l) => s + Math.max(0, (l.elapsed_time_s ?? 0) - (l.moving_time_s ?? 0)),
    0,
  );
  return {
    detected: total >= BREAK_STOPPAGE_THRESHOLD_S,
    totalStoppageS: total,
  };
}

/** Combined detection helper used by the confirm card. */
export function detectBenchmarkSignals(
  laps: DetectionLap[] | null | undefined,
): DetectionResult {
  const slow = detectSecondHalfSlowdownFromLaps(laps);
  const brks = detectBreaksFromLaps(laps);
  return {
    slowdownDetected: slow.detected,
    breaksDetected: brks.detected,
    slowdownFraction: slow.fraction,
    totalStoppageS: brks.totalStoppageS,
  };
}
