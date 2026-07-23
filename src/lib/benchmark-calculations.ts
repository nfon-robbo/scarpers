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
    GPS_LOW: 15,
    GPS_MEDIUM: 5,
    RPE_SUBMAXIMAL: 15,
    /** Effort window derived from moving averages rather than watch laps. */
    EFFORT_WINDOW_DERIVED: 15,
  },
  /** Threshold at or above HIGH_MIN => High; at or above MEDIUM_MIN => Medium; else Low. */
  CONFIDENCE_BANDS: { HIGH_MIN: 80, MEDIUM_MIN: 40 },

  /** Seconds of warm-up excluded when computing threshold HR from a stream. */
  THRESHOLD_HR_WARMUP_EXCLUDE_S: 10 * 60,

  /** Fractional slowdown that triggers the SECOND_HALF_SLOWDOWN deduction. */
  SECOND_HALF_SLOWDOWN_THRESHOLD: 0.10,
} as const;

export type GpsConfidence = "High" | "Medium" | "Low";
export type EffortWindowSource = "lap" | "derived" | "manual";
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

export interface HrZoneBoundaries {
  lthr: number;
  z1: { min: 0; max: number };
  z2: { min: number; max: number };
  z3: { min: number; max: number };
  z4: { min: number; max: number };
  z5: { min: number; max: null };
}

/** Compute Z1–Z5 boundaries from LTHR. All values rounded to whole bpm. */
export function computeHrZonesFromLthr(lthr: number): HrZoneBoundaries {
  if (lthr <= 0) throw new Error("LTHR must be > 0");
  const pct = BenchmarkConfig.LTHR_ZONE_UPPER_PCT;
  const z1Max = Math.round(lthr * pct.z1);
  const z2Max = Math.round(lthr * pct.z2);
  const z3Max = Math.round(lthr * pct.z3);
  const z4Max = Math.round(lthr * pct.z4);
  return {
    lthr,
    z1: { min: 0, max: z1Max },
    z2: { min: z1Max + 1, max: z2Max },
    z3: { min: z2Max + 1, max: z3Max },
    z4: { min: z3Max + 1, max: z4Max },
    z5: { min: z4Max + 1, max: null },
  };
}

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
  if (inputs.secondHalfSlowdown >= BenchmarkConfig.SECOND_HALF_SLOWDOWN_THRESHOLD) {
    deductions.push({ reason: "second_half_slowdown", points: D.SECOND_HALF_SLOWDOWN });
  }
  if (!inputs.cadencePresent) {
    deductions.push({ reason: "cadence_missing", points: D.CADENCE_MISSING });
  }
  if (inputs.gpsConfidence === "Low") {
    deductions.push({ reason: "gps_low", points: D.GPS_LOW });
  } else if (inputs.gpsConfidence === "Medium") {
    deductions.push({ reason: "gps_medium", points: D.GPS_MEDIUM });
  }
  if (inputs.rpeSubmaximal) {
    deductions.push({ reason: "rpe_submaximal", points: D.RPE_SUBMAXIMAL });
  }
  if (inputs.effortWindowSource === "derived") {
    deductions.push({ reason: "effort_window_derived", points: D.EFFORT_WINDOW_DERIVED });
  }

  const totalDeducted = deductions.reduce((a, d) => a + d.points, 0);
  const score = Math.max(0, BenchmarkConfig.CONFIDENCE_BASE - totalDeducted);
  const { HIGH_MIN, MEDIUM_MIN } = BenchmarkConfig.CONFIDENCE_BANDS;
  const band: ConfidenceBand = score >= HIGH_MIN ? "High" : score >= MEDIUM_MIN ? "Medium" : "Low";
  return { score, band, deductions };
}
