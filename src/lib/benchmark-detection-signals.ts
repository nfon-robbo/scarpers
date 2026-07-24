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
 * Detect a second-half slowdown from laps: split laps by cumulative elapsed
 * time into first/second half, compute avg pace (s/km) for each, return
 * (second - first) / first. Positive means the second half was slower.
 * Uses the same threshold as the SECOND_HALF_SLOWDOWN deduction.
 */
export function detectSecondHalfSlowdownFromLaps(
  laps: DetectionLap[] | null | undefined,
): { detected: boolean; fraction: number | null } {
  const valid = (laps ?? []).filter(
    (l) => (l.elapsed_time_s ?? 0) > 0 && (l.distance_m ?? 0) > 0,
  );
  if (valid.length < 2) return { detected: false, fraction: null };

  const totalElapsed = valid.reduce((s, l) => s + (l.elapsed_time_s ?? 0), 0);
  if (totalElapsed <= 0) return { detected: false, fraction: null };

  const half = totalElapsed / 2;
  let cum = 0;
  const firstHalf: DetectionLap[] = [];
  const secondHalf: DetectionLap[] = [];
  for (const l of valid) {
    if (cum + (l.elapsed_time_s ?? 0) / 2 < half) firstHalf.push(l);
    else secondHalf.push(l);
    cum += l.elapsed_time_s ?? 0;
  }
  if (firstHalf.length === 0 || secondHalf.length === 0) {
    return { detected: false, fraction: null };
  }

  const pace = (arr: DetectionLap[]): number => {
    const t = arr.reduce((s, l) => s + (l.elapsed_time_s ?? 0), 0);
    const d = arr.reduce((s, l) => s + (l.distance_m ?? 0), 0);
    if (d <= 0) return 0;
    return t / (d / 1000);
  };
  const p1 = pace(firstHalf);
  const p2 = pace(secondHalf);
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
