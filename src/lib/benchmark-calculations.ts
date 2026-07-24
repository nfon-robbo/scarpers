/**
 * Benchmark calculations — pure module, no I/O, no side effects.
 * Every constant lives in BenchmarkConfig so the numbers can be tuned in
 * one place and asserted by tests.
 */

export const BenchmarkConfig = {
  /** Cooper-style scaling exponent used for race-time predictions. */
  PREDICTED_5K_EXPONENT: 1.06,

  /**
   * LTHR-relative zone boundaries. Each value is the UPPER bound of the
   * named zone, expressed as a fraction of LTHR. Z5 has no upper bound.
   *   Z1 <= 0.85 * LTHR
   *   Z2 (0.85, 0.90]
   *   Z3 (0.90, 0.95]
   *   Z4 (0.95, 1.02]
   *   Z5 >  1.02
   */
  LTHR_ZONE_UPPER_PCT: {
    z1: 0.85,
    z2: 0.90,
    z3: 0.95,
    z4: 1.02,
  },

  /** Confidence starts at 100 and each condition below deducts. */
  CONFIDENCE_BASE: 100,
  CONFIDENCE_DEDUCTIONS: {
    NO_HR_STREAM: 30,
    /** Applied when second-half average pace is >=10% slower than first-half. */
    SECOND_HALF_SLOWDOWN: 20,
    CADENCE_MISSING: 15,
    GPS_LOW: 20,
    RPE_SUBMAXIMAL: 15,
    /** Effort window derived from moving averages rather than watch laps. */
    EFFORT_WINDOW_DERIVED: 15,
    /**
     * Applied when threshold HR was measured AND the athlete records HR from
     * a wrist optical sensor. Wrist optical HR is unreliable at threshold
     * intensity — the primary output of this test.
     */
    HR_SENSOR_WRIST: 10,
    /**
     * Applied when the FIT timer was STOPPED for longer than
     * `TIMER_STOPPED_MIN_S` inside the effort window. A timer stop means the
     * athlete paused their watch mid-effort — the test is no longer
     * continuous and the resulting threshold estimate is less trustworthy.
     * Walk breaks with the timer STILL RUNNING are fine and do not trigger
     * this deduction.
     */
    TIMER_STOPPED_IN_EFFORT: 15,
  },
  /** Threshold (seconds) of timer-stopped time inside the effort window
   *  that triggers the TIMER_STOPPED_IN_EFFORT deduction. */
  TIMER_STOPPED_MIN_S: 60,
  /** Above HIGH_MIN => High; at or above MEDIUM_MIN => Medium; else Low. */
  CONFIDENCE_BANDS: { HIGH_MIN: 70, MEDIUM_MIN: 40 },

  /** Seconds of warm-up excluded when computing threshold HR from a stream. */
  THRESHOLD_HR_WARMUP_EXCLUDE_S: 10 * 60,

  /** Fractional slowdown that triggers the SECOND_HALF_SLOWDOWN deduction. */
  SECOND_HALF_SLOWDOWN_THRESHOLD: 0.10,

  /**
   * Session-type pace ratios expressed as a multiplier on THRESHOLD pace
   * (LT = 1.000). Slower paces are > 1, faster paces are < 1. Ranges give the
   * min/max target so downstream code can emit "5:46-6:13/km"-style windows.
   *
   * Anchor: LT (0.98-1.02) — deliberately narrow around threshold.
   * Easy/Steady/Marathon derived from Daniels' vDOT at LT-equivalent effort,
   * reality-checked against Pfitzinger easy-pace conventions (28-38% slower).
   * CV/VO2/Rep from Coggan-style CV≈95%LT, 5K≈90%LT, 3K≈85%LT.
   *
   * Tune here, nowhere else — every consumer imports this constant.
   */
  THRESHOLD_PACE_RATIOS: {
    easy:      { min: 1.28, max: 1.38 },
    steady:    { min: 1.18, max: 1.24 },
    marathon:  { min: 1.10, max: 1.14 },
    threshold: { min: 0.98, max: 1.02 },
    cv:        { min: 0.94, max: 0.97 },
    vo2:       { min: 0.88, max: 0.92 },
    rep:       { min: 0.82, max: 0.86 },
  },
} as const;

export type SessionPaceCategory = keyof typeof BenchmarkConfig.THRESHOLD_PACE_RATIOS;

/** Compute a pace RANGE (sec/km) for a session category from a threshold pace. */
export function paceRangeFromThreshold(
  thresholdSecPerKm: number,
  category: SessionPaceCategory,
): { minSecPerKm: number; maxSecPerKm: number } {
  const r = BenchmarkConfig.THRESHOLD_PACE_RATIOS[category];
  return {
    minSecPerKm: thresholdSecPerKm * r.min,
    maxSecPerKm: thresholdSecPerKm * r.max,
  };
}

/** Convert seconds-per-km to metres-per-second (intervals.icu native unit). */
export function secPerKmToMPerSec(secPerKm: number): number {
  if (secPerKm <= 0) throw new Error("pace must be > 0");
  return 1000 / secPerKm;
}

export type GpsConfidence = "High" | "Medium" | "Low";
export type EffortWindowSource = "lap" | "laps" | "derived" | "manual";
export type ConfidenceBand = "High" | "Medium" | "Low";

// ---------------------------------------------------------------------------
// Pace / prediction
// ---------------------------------------------------------------------------

/** Threshold pace (seconds per km) from distance (metres) and duration (s). */
export function thresholdPaceSecPerKm(distanceM: number, durationS: number): number {
  if (distanceM <= 0 || durationS <= 0) throw new Error("distance and duration must be > 0");
  return durationS / (distanceM / 1000);
}

/** Format seconds/km as "m:ss/km" (rounded to the nearest second). */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

/**
 * Predict a 5K time (seconds) from an effort of `distanceM` in `durationS`
 * using t2 = t1 * (d2/d1)^exponent.
 */
export function predict5kSeconds(distanceM: number, durationS: number): number {
  if (distanceM <= 0 || durationS <= 0) throw new Error("distance and duration must be > 0");
  const ratio = 5000 / distanceM;
  return durationS * Math.pow(ratio, BenchmarkConfig.PREDICTED_5K_EXPONENT);
}

/** Format seconds as "m:ss". */
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// HR zones
// ---------------------------------------------------------------------------

// Zone computation lives in the canonical shared resolver. The benchmark
// module never derives zones locally — pass the measured LTHR to
// `resolveZonesForUser` (or `zonesFromLthr` for pure unit inputs) and use
// what it returns.
export { zonesFromLthr } from "@shared/hr-zones";

// ---------------------------------------------------------------------------
// Threshold HR from stream
// ---------------------------------------------------------------------------

export interface HrStreamSample {
  /** Seconds since activity start. */
  t: number;
  /** Heart rate in bpm. */
  hr: number;
}

/**
 * Threshold HR from a full-activity HR stream.
 * Excludes the first THRESHOLD_HR_WARMUP_EXCLUDE_S seconds (default 10 min)
 * so the warm-up doesn't drag the average down.
 */
export function thresholdHrFromStream(stream: HrStreamSample[]): number {
  const cutoff = BenchmarkConfig.THRESHOLD_HR_WARMUP_EXCLUDE_S;
  const kept = stream.filter((s) => s.t >= cutoff && Number.isFinite(s.hr));
  if (kept.length === 0) throw new Error("no HR samples after warm-up cutoff");
  const sum = kept.reduce((a, s) => a + s.hr, 0);
  return sum / kept.length;
}

/** Mean HR of samples with t < cutoff — exposed for diagnostics/tests. */
export function meanHrBeforeCutoff(stream: HrStreamSample[], cutoffS = BenchmarkConfig.THRESHOLD_HR_WARMUP_EXCLUDE_S): number {
  const kept = stream.filter((s) => s.t < cutoffS && Number.isFinite(s.hr));
  if (kept.length === 0) return NaN;
  return kept.reduce((a, s) => a + s.hr, 0) / kept.length;
}

// ---------------------------------------------------------------------------
// Confidence score
// ---------------------------------------------------------------------------

export interface ConfidenceInputs {
  hrStreamAvailable: boolean;
  /** Fraction slower the second half was vs the first half (e.g. 0.12 for 12%). */
  secondHalfSlowdown: number;
  cadencePresent: boolean;
  gpsConfidence: GpsConfidence;
  /** True if the athlete reported the effort was submaximal. */
  rpeSubmaximal: boolean;
  effortWindowSource: EffortWindowSource;
  /**
   * Protocol the effort was performed under. The `effort_window_derived`
   * penalty only applies to the 30-min protocol, where laps are the expected
   * primary path. 3k / 5k time trials often have no matching lap boundary
   * because the watch was configured for auto-lap-per-km — penalising them
   * for that is unfair, so the deduction is suppressed.
   */
  protocol?: "30min" | "3k" | "5k";
  /**
   * Athlete's Q5 answer, if any. When it is "Deliberate, felt strong early"
   * or "Hills or terrain" the SECOND_HALF_SLOWDOWN deduction is suppressed —
   * the fade has an explanation that is not pacing failure.
   */
  slowdownReason?: string | null;
  /**
   * True if a threshold HR was measured AND the athlete records HR from a
   * wrist optical sensor. Applies HR_SENSOR_WRIST deduction.
   */
  wristHrOnThresholdMeasurement?: boolean;
  /**
   * Timer-stopped seconds inside the effort window. When >
   * `BenchmarkConfig.TIMER_STOPPED_MIN_S` the TIMER_STOPPED_IN_EFFORT
   * deduction fires. Detected from the elapsed-vs-moving gap on the effort
   * laps, NOT from a speed threshold — a walk break with the timer running
   * has elapsed == moving and does not qualify.
   */
  timerStoppedSInEffort?: number;
}

export interface ConfidenceDeduction {
  reason: string;
  points: number;
}

export interface ConfidenceResult {
  score: number;
  band: ConfidenceBand;
  deductions: ConfidenceDeduction[];
}

export function scoreConfidence(inputs: ConfidenceInputs): ConfidenceResult {
  const D = BenchmarkConfig.CONFIDENCE_DEDUCTIONS;
  const deductions: ConfidenceDeduction[] = [];

  if (!inputs.hrStreamAvailable) {
    deductions.push({ reason: "no_hr_stream", points: D.NO_HR_STREAM });
  }
  const slowdownSuppressed =
    inputs.slowdownReason === "Deliberate, felt strong early" ||
    inputs.slowdownReason === "Hills or terrain";
  if (
    inputs.secondHalfSlowdown >= BenchmarkConfig.SECOND_HALF_SLOWDOWN_THRESHOLD &&
    !slowdownSuppressed
  ) {
    deductions.push({ reason: "second_half_slowdown", points: D.SECOND_HALF_SLOWDOWN });
  }
  if (!inputs.cadencePresent) {
    deductions.push({ reason: "cadence_missing", points: D.CADENCE_MISSING });
  }
  if (inputs.gpsConfidence === "Low") {
    deductions.push({ reason: "gps_low", points: D.GPS_LOW });
  }
  if (inputs.rpeSubmaximal) {
    deductions.push({ reason: "rpe_submaximal", points: D.RPE_SUBMAXIMAL });
  }
  const derivedPenaltyApplies =
    inputs.effortWindowSource === "derived" &&
    (!inputs.protocol || inputs.protocol === "30min");
  if (derivedPenaltyApplies) {
    deductions.push({ reason: "effort_window_derived", points: D.EFFORT_WINDOW_DERIVED });
  }
  if (inputs.wristHrOnThresholdMeasurement) {
    deductions.push({ reason: "hr_sensor_wrist", points: D.HR_SENSOR_WRIST });
  }
  if (
    typeof inputs.timerStoppedSInEffort === "number" &&
    inputs.timerStoppedSInEffort > BenchmarkConfig.TIMER_STOPPED_MIN_S
  ) {
    deductions.push({ reason: "timer_stopped_in_effort", points: D.TIMER_STOPPED_IN_EFFORT });
  }

  const totalDeducted = deductions.reduce((a, d) => a + d.points, 0);
  const score = Math.max(0, BenchmarkConfig.CONFIDENCE_BASE - totalDeducted);
  const { HIGH_MIN, MEDIUM_MIN } = BenchmarkConfig.CONFIDENCE_BANDS;
  const band: ConfidenceBand = score >= HIGH_MIN ? "High" : score >= MEDIUM_MIN ? "Medium" : "Low";
  return { score, band, deductions };
}
