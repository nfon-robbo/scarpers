// ── Running IQ Calculation Engine ──
// Computes a 0–200 score across 5 weighted pillars

export interface RunActivity {
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_cadence: number | null;
  start_time: string | null;
  /** Optional — when present, used to exclude pure walks from load calculations. */
  activity_type?: string | null;
  raw_data?: unknown;
}

// ── Walk/Run detection ──
// We don't have lap data at this layer, so we use cadence + activity_type
// heuristics to identify walk/run interval sessions. A true running cadence
// floor is ~150 spm; anything well below that with a non-trivial cadence
// reading is almost certainly a blended walk/run average.

/** Activity is pure walking — exclude from running pillars entirely. */
function isWalking(r: RunActivity): boolean {
  return typeof r.activity_type === "string" && /walk|hike/i.test(r.activity_type);
}

/** Blended walk/run interval session — summary metrics are unreliable for pace, cadence, HR:pace. */
function isWalkRunInterval(r: RunActivity): boolean {
  if (isWalking(r)) return false;
  // Cadence reading that's far below normal running cadence = walk/run blend.
  if (r.avg_cadence != null && r.avg_cadence > 40 && r.avg_cadence < 150) return true;
  return false;
}

/** Activity we trust for pace/cadence/HR:pace metrics — pure continuous run. */
function isCleanRun(r: RunActivity): boolean {
  return !isWalking(r) && !isWalkRunInterval(r);
}

/** Count clean continuous runs in the provided activity list (caller filters by window). */
export function countCleanRuns(runs: RunActivity[]): number {
  return runs.filter(isCleanRun).length;
}

/** Minimum clean runs required before Running IQ is considered stable enough to display. */
export const RUNNING_IQ_MIN_CLEAN_RUNS = 6;

function getGpsTrack(r: RunActivity): Array<Record<string, unknown>> {
  const raw = r.raw_data as Record<string, unknown> | null | undefined;
  const track = raw?.gps_track;
  return Array.isArray(track) ? (track as Array<Record<string, unknown>>) : [];
}

function pointSpeedKmh(point: Record<string, unknown>): number | null {
  const speed = Number(point.speed);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  // FIT imports already store km/h; Strava import stores km/h too. Guard m/s just in case.
  return speed <= 12 ? speed * 3.6 : speed;
}

function pointDistanceMeters(point: Record<string, unknown>): number | null {
  const value = Number(point.distance_meters ?? point.distance);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function runLoadDistanceKm(r: RunActivity): number {
  const totalKm = (r.distance_meters || 0) / 1000;
  if (totalKm <= 0 || isWalking(r)) return 0;
  if (!isWalkRunInterval(r)) return totalKm;

  const track = getGpsTrack(r);
  if (track.length >= 2) {
    let runMeters = 0;
    let previousDistance: number | null = pointDistanceMeters(track[0]);

    for (let i = 1; i < track.length; i++) {
      const point = track[i];
      const speedKmh = pointSpeedKmh(point);
      const cadence = Number(point.cadence);
      const isRunPoint = (speedKmh != null && speedKmh >= 7) || (Number.isFinite(cadence) && cadence >= 150);
      const currentDistance = pointDistanceMeters(point);
      const delta = currentDistance != null && previousDistance != null
        ? Math.max(0, currentDistance - previousDistance)
        : 0;

      if (isRunPoint) runMeters += delta;
      if (currentDistance != null) previousDistance = currentDistance;
    }

    if (runMeters > 0) return Math.min(totalKm, runMeters / 1000);
  }

  // Without track samples, keep the session in load instead of treating valid training as zero.
  return totalKm;
}

export interface RunningIQInput {
  runs: RunActivity[];
  vo2Max?: number | null;
  restingHR?: number | null;
  hrv?: number | null;
  sleepScore?: number | null;
  readinessScore?: number | null;
  ageYears: number;
  gender: "MALE" | "FEMALE" | "UNSPECIFIED";
  missedWorkoutsLast4Weeks: number;
  plannedWorkoutsLast4Weeks: number;
  historicalWeeklyDistancesKm?: number[];
}

export interface PillarScore {
  name: string;
  score: number; // 0-100
  weight: number;
  icon: string;
}

export interface RunningIQResult {
  totalScore: number; // 0-200
  adjustedScore: number; // after readiness adjustment
  label: string;
  pillars: PillarScore[];
  lowestPillar: string;
  coachingTip: string;
}

// ── Helpers ──

function getISOWeek(d: Date): string {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  dt.setDate(dt.getDate() + 3 - ((dt.getDay() + 6) % 7));
  const week1 = new Date(dt.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((dt.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${dt.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function linearSlope(values: number[]): number {
  if (values.length < 2) return 0;
  const n = values.length;
  const xs = values.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (values[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function cv(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (mean === 0) return 0;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance) / mean;
}

function thresholdScore(value: number, thresholds: [number, number][]): number {
  for (const [threshold, score] of thresholds) {
    if (value <= threshold) return score;
  }
  return thresholds[thresholds.length - 1][1];
}

// ── ACSM VO2Max Percentile (simplified) ──
function vo2MaxScore(vo2: number, age: number, gender: string): number {
  // Simplified ACSM percentile normalization
  let baseline: number;
  if (gender === "FEMALE") {
    baseline = age < 30 ? 36 : age < 40 ? 34 : age < 50 ? 32 : age < 60 ? 28 : 25;
  } else {
    baseline = age < 30 ? 44 : age < 40 ? 42 : age < 50 ? 40 : age < 60 ? 36 : 32;
  }
  const ratio = vo2 / baseline;
  if (ratio >= 1.5) return 98;
  if (ratio >= 1.35) return 90;
  if (ratio >= 1.2) return 80;
  if (ratio >= 1.1) return 70;
  if (ratio >= 1.0) return 60;
  if (ratio >= 0.9) return 50;
  if (ratio >= 0.8) return 38;
  return 25;
}

function restingHRScore(rhr: number, age: number): number {
  // Lower is better, age-adjusted
  const ageOffset = age > 50 ? 5 : age > 40 ? 3 : 0;
  const adjusted = rhr - ageOffset;
  if (adjusted <= 45) return 98;
  if (adjusted <= 50) return 90;
  if (adjusted <= 55) return 80;
  if (adjusted <= 60) return 68;
  if (adjusted <= 65) return 55;
  if (adjusted <= 72) return 40;
  return 25;
}

// ── Pillar Calculations ──

interface WeekData {
  weekKey: string;
  distances: number[];
  paces: number[]; // min/km
  hrPaceRatios: number[];
  runCount: number;
  totalDistanceKm: number;
  avgPace: number;
  longestRunKm: number;
}

function groupByWeek(runs: RunActivity[]): WeekData[] {
  const weekMap = new Map<string, RunActivity[]>();

  for (const run of runs) {
    if (!run.start_time) continue;
    const key = getISOWeek(new Date(run.start_time));
    if (!weekMap.has(key)) weekMap.set(key, []);
    weekMap.get(key)!.push(run);
  }

  return Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekKey, weekRuns]) => {
      const distances: number[] = [];
      const paces: number[] = [];
      const hrPaceRatios: number[] = [];
      let longestRunKm = 0;

      for (const r of weekRuns) {
        const distKm = runLoadDistanceKm(r);
        distances.push(distKm);
        if (distKm > longestRunKm) longestRunKm = distKm;

        // Pace + HR:pace per week only from clean continuous runs —
        // blended walk/run averages would corrupt the trend.
        if (distKm > 0 && r.duration_seconds && isCleanRun(r)) {
          const paceMinPerKm = (r.duration_seconds / 60) / distKm;
          paces.push(paceMinPerKm);

          if (r.avg_heart_rate && r.avg_heart_rate > 0) {
            hrPaceRatios.push(r.avg_heart_rate / paceMinPerKm);
          }
        }
      }

      const totalDistanceKm = distances.reduce((a, b) => a + b, 0);
      const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : 0;

      return {
        weekKey,
        distances,
        paces,
        hrPaceRatios,
        runCount: weekRuns.length,
        totalDistanceKm,
        avgPace,
        longestRunKm,
      };
    });
}

function calcAerobicCapacity(
  input: RunningIQInput,
  runs: RunActivity[],
): number {
  let vo2Score = 50; // neutral if missing
  if (input.vo2Max) {
    vo2Score = vo2MaxScore(input.vo2Max, input.ageYears, input.gender);
  }

  let rhrScore = 50;
  if (input.restingHR) {
    rhrScore = restingHRScore(input.restingHR, input.ageYears);
  }

  // Aerobic-pace efficiency: median pace on easy *clean* runs only.
  // Walk/run intervals have blended pace and would drag the median.
  const maxAerobicHR = 0.75 * (220 - input.ageYears);
  const cleanRuns = runs.filter(isCleanRun);
  let easyRuns = cleanRuns.filter(
    (r) => r.avg_heart_rate && r.avg_heart_rate <= maxAerobicHR && r.distance_meters && r.duration_seconds
  );

  // Fallback: clean runs >= 40 min
  if (easyRuns.length < 3) {
    easyRuns = cleanRuns.filter(
      (r) => r.duration_seconds && r.duration_seconds >= 2400 && r.distance_meters && r.distance_meters > 0
    );
  }

  let paceScore = 50;
  if (easyRuns.length > 0) {
    const paces = easyRuns.map((r) => ((r.duration_seconds! / 60) / (r.distance_meters! / 1000)));
    const med = median(paces);
    paceScore = thresholdScore(med, [
      [4.5, 98], [5.0, 88], [5.5, 75], [6.0, 60], [6.5, 45], [7.0, 30], [Infinity, 15],
    ]);
  }

  return vo2Score * 0.5 + rhrScore * 0.25 + paceScore * 0.25;
}

function calcEfficiency(runs: RunActivity[]): number {
  // All economy metrics use clean runs only. Walk/run intervals would
  // pollute HR:pace (blended pace) and cadence (blended 0-spm walk segments).
  const clean = runs.filter(isCleanRun);
  if (clean.length < 3) return 50;

  // HR-to-Pace ratio
  const runsWithData = clean.filter(
    (r) => r.avg_heart_rate && r.distance_meters && r.duration_seconds && r.distance_meters > 0
  );

  let hrPaceScore = 50;
  if (runsWithData.length > 0) {
    const ratios = runsWithData.map((r) => {
      const paceMinPerKm = (r.duration_seconds! / 60) / (r.distance_meters! / 1000);
      return r.avg_heart_rate! / paceMinPerKm;
    });
    const med = median(ratios);
    hrPaceScore = thresholdScore(med, [
      [7.5, 98], [9, 85], [10.5, 70], [12, 55], [14, 38], [16, 22], [Infinity, 10],
    ]);
  }

  // Cardiac drift proxy
  const longRuns = clean.filter(
    (r) => r.duration_seconds && r.duration_seconds >= 3600 && r.avg_heart_rate && r.max_heart_rate
  );
  let driftScore = 50;
  if (longRuns.length > 0) {
    const drifts = longRuns.map((r) => (r.max_heart_rate! - r.avg_heart_rate!));
    const med = median(drifts);
    driftScore = thresholdScore(med, [
      [10, 95], [15, 80], [20, 62], [25, 44], [30, 28], [Infinity, 12],
    ]);
  }

  // Cadence — only count clean continuous runs (≥150 spm threshold inside isCleanRun).
  const withCadence = clean.filter((r) => r.avg_cadence && r.avg_cadence >= 150);
  let cadenceScore = 50;
  if (withCadence.length > 0) {
    const avgCad = withCadence.reduce((s, r) => s + r.avg_cadence!, 0) / withCadence.length;
    // Optimal 170-180
    if (avgCad >= 170 && avgCad <= 180) cadenceScore = 95;
    else if (avgCad >= 165 || avgCad <= 185) cadenceScore = 80;
    else if (avgCad >= 160 || avgCad <= 190) cadenceScore = 65;
    else if (avgCad >= 155) cadenceScore = 50;
    else if (avgCad >= 150) cadenceScore = 35;
    else cadenceScore = 20;
  }

  return hrPaceScore * 0.5 + driftScore * 0.3 + cadenceScore * 0.2;
}

function calcDurability(
  weeks: WeekData[],
  historicalWeeklyDistances?: number[],
): number {
  const distances = historicalWeeklyDistances || weeks.map((w) => w.totalDistanceKm);

  // ACWR
  let acwrScore = 55;
  if (distances.length >= 5) {
    const acute = distances[distances.length - 1] || 0;
    // Exponentially weighted chronic (lambda=0.5)
    const chronicWeeks = distances.slice(-5, -1);
    let weightedSum = 0, weightTotal = 0;
    for (let i = 0; i < chronicWeeks.length; i++) {
      const w = Math.pow(0.5, chronicWeeks.length - 1 - i);
      weightedSum += chronicWeeks[i] * w;
      weightTotal += w;
    }
    const chronic = weightTotal > 0 ? weightedSum / weightTotal : 0;
    const acwr = chronic > 0 ? acute / chronic : 1.0;

    if (acwr >= 0.8 && acwr <= 1.3) acwrScore = 95;
    else if (acwr >= 0.6 && acwr < 0.8) acwrScore = 75;
    else if (acwr > 1.3 && acwr <= 1.5) acwrScore = 65;
    else if (acwr >= 0.4 && acwr < 0.6) acwrScore = 45;
    else if (acwr > 1.5 && acwr <= 1.8) acwrScore = 38;
    else if (acwr > 1.8) acwrScore = 15;
    else acwrScore = 30;
  }

  // Weekly mileage level
  let mileageScore = 50;
  if (distances.length >= 4) {
    const recent4 = distances.slice(-4);
    const avg = recent4.reduce((a, b) => a + b, 0) / 4;
    const peak = Math.max(...distances);
    const ratio = peak > 0 ? avg / peak : 0;
    mileageScore = Math.min(100, Math.round(ratio * 100));
  }

  // Long-run proportion
  let longRunScore = 50;
  if (weeks.length >= 2) {
    const recentWeeks = weeks.slice(-4);
    const proportions = recentWeeks
      .filter((w) => w.totalDistanceKm > 0)
      .map((w) => w.longestRunKm / w.totalDistanceKm);
    if (proportions.length > 0) {
      const avgProp = proportions.reduce((a, b) => a + b, 0) / proportions.length;
      // Ideal 25-35%
      if (avgProp >= 0.25 && avgProp <= 0.35) longRunScore = 95;
      else if (avgProp >= 0.20 && avgProp <= 0.40) longRunScore = 80;
      else if (avgProp >= 0.15 && avgProp <= 0.50) longRunScore = 60;
      else longRunScore = 35;
    }
  }

  return acwrScore * 0.5 + mileageScore * 0.3 + longRunScore * 0.2;
}

function calcConsistency(
  weeks: WeekData[],
  missed: number,
  planned: number,
  historicalWeeklyDistances?: number[],
): number {
  if (weeks.length < 6) return 55; // neutral

  // Sessions/week avg over 8w
  const recentWeeks = weeks.slice(-8);
  const avgSessions = recentWeeks.reduce((s, w) => s + w.runCount, 0) / recentWeeks.length;
  const sessionsScore = thresholdScore(-avgSessions, [
    [-5, 98], [-4, 88], [-3, 72], [-2, 55], [-1, 38], [Infinity, 20],
  ]);

  // Missed workout rate
  let missedScore = 65; // neutral if no plan
  if (planned > 0) {
    const rate = missed / planned;
    missedScore = thresholdScore(rate, [
      [0, 100], [0.10, 88], [0.20, 74], [0.33, 58], [0.50, 40], [0.67, 25], [Infinity, 12],
    ]);
  }

  // Weekly distance CV
  const distances = historicalWeeklyDistances || weeks.map((w) => w.totalDistanceKm);
  const recentDist = distances.slice(-Math.min(12, distances.length));
  const distCV = cv(recentDist.filter((d) => d > 0));
  const cvScore = thresholdScore(distCV, [
    [0.10, 98], [0.20, 88], [0.30, 75], [0.40, 60], [0.50, 45], [0.60, 30], [Infinity, 15],
  ]);

  return sessionsScore * 0.35 + missedScore * 0.35 + cvScore * 0.3;
}

function calcProgression(weeks: WeekData[]): number {
  if (weeks.length === 0) return 58; // neutral

  // Pace trend
  const weeklyPaces = weeks.filter((w) => w.avgPace > 0).map((w) => w.avgPace);
  let paceScore = 60;
  if (weeklyPaces.length >= 4) {
    const slope = linearSlope(weeklyPaces); // negative = improving (faster)
    const sPerKmPerWeek = slope * 60; // convert min/km/week to sec/km/week
    if (sPerKmPerWeek <= -4) paceScore = 98;
    else if (sPerKmPerWeek <= -2) paceScore = 85;
    else if (sPerKmPerWeek <= -1) paceScore = 72;
    else if (sPerKmPerWeek <= 1) paceScore = 60;
    else if (sPerKmPerWeek <= 2) paceScore = 42;
    else if (sPerKmPerWeek <= 4) paceScore = 25;
    else paceScore = 12;
  }

  // HR-efficiency trend
  const weeklyHRPace = weeks.filter((w) => w.hrPaceRatios.length > 0).map((w) => median(w.hrPaceRatios));
  let hrEffScore = 60;
  if (weeklyHRPace.length >= 4) {
    const slope = linearSlope(weeklyHRPace);
    // Negative slope = improving (lower bpm per min/km)
    if (slope <= -0.3) hrEffScore = 95;
    else if (slope <= -0.1) hrEffScore = 80;
    else if (slope <= 0.05) hrEffScore = 65;
    else if (slope <= 0.15) hrEffScore = 48;
    else hrEffScore = 30;
  }

  // Distance ramp rate
  const distances = weeks.map((w) => w.totalDistanceKm);
  let rampScore = 60;
  if (distances.length >= 2) {
    const half = Math.max(1, Math.floor(distances.length / 2));
    const recent = distances.slice(-half);
    const prior = distances.slice(-half * 2, -half);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
    if (priorAvg > 0) {
      const ramp = (recentAvg - priorAvg) / priorAvg;
      if (ramp >= 0.05 && ramp <= 0.15) rampScore = 95;
      else if (ramp >= 0 && ramp <= 0.25) rampScore = 78;
      else if (ramp >= -0.05) rampScore = 60;
      else if (ramp >= -0.15) rampScore = 42;
      else rampScore = 25;
      // Penalise excessive ramp
      if (ramp > 0.25) rampScore = Math.min(rampScore, 45);
    }
  }

  return paceScore * 0.4 + hrEffScore * 0.35 + rampScore * 0.25;
}

// ── Coaching Tips ──

const coachingTips: Record<string, string> = {
  "Aerobic Capacity":
    "Focus on building your aerobic base — add more easy-paced runs at a conversational effort. Consistency at low intensity builds the engine.",
  Efficiency:
    "Work on running economy — cadence drills (aim for 170-180 spm), strides after easy runs, and tempo intervals will improve your HR:pace ratio.",
  "Durability":
    "Your load tolerance needs work — gradually increase your weekly volume by 5-10% and include one longer run each week to build endurance.",
  Consistency:
    "Consistency is your biggest lever right now — aim for regular training with less week-to-week variation. Show up 3-4 times per week minimum.",
  Progression:
    "You need a progression stimulus — add one quality session per week (tempo, intervals, or progressive long run) to trigger pace improvements.",
};

// ── Main Calculation ──

export function computeRunningIQ(input: RunningIQInput): RunningIQResult {
  // Filter to last 12 weeks. Pure walks are excluded entirely so they
  // never contribute to weekly distance, ACWR, or run count.
  const cutoff = new Date(Date.now() - 12 * 7 * 86400000);
  const recentRuns = input.runs.filter(
    (r) =>
      r.start_time &&
      new Date(r.start_time) >= cutoff &&
      r.distance_meters &&
      r.distance_meters > 0 &&
      !isWalking(r),
  );

  const weeks = groupByWeek(recentRuns);

  const aerobic = calcAerobicCapacity(input, recentRuns);
  const efficiency = calcEfficiency(recentRuns);
  const durability = calcDurability(weeks, input.historicalWeeklyDistancesKm);
  const consistency = calcConsistency(
    weeks,
    input.missedWorkoutsLast4Weeks,
    input.plannedWorkoutsLast4Weeks,
    input.historicalWeeklyDistancesKm,
  );
  const progression = calcProgression(weeks);

  const pillars: PillarScore[] = [
    { name: "Aerobic Capacity", score: Math.round(aerobic), weight: 0.4, icon: "❤️" },
    { name: "Efficiency", score: Math.round(efficiency), weight: 0.2, icon: "⚡" },
    { name: "Durability", score: Math.round(durability), weight: 0.2, icon: "🛡️" },
    { name: "Consistency", score: Math.round(consistency), weight: 0.1, icon: "📅" },
    { name: "Progression", score: Math.round(progression), weight: 0.1, icon: "📈" },
  ];

  const weighted =
    aerobic * 0.4 + efficiency * 0.2 + durability * 0.2 + consistency * 0.1 + progression * 0.1;

  const totalScore = Math.round(weighted * 2); // 0-200

  // Readiness adjustment
  const readiness = input.readinessScore ?? 50;
  const adjustedScore = Math.round(totalScore * (0.9 + (readiness / 100) * 0.2));

  // Label
  let label: string;
  if (adjustedScore >= 180) label = "World Class";
  else if (adjustedScore >= 160) label = "Elite";
  else if (adjustedScore >= 140) label = "Strong";
  else if (adjustedScore >= 110) label = "Solid";
  else if (adjustedScore >= 80) label = "Developing";
  else if (adjustedScore >= 50) label = "Building";
  else label = "Beginner";

  // Find lowest pillar
  const lowestPillar = pillars.reduce((min, p) => (p.score < min.score ? p : min), pillars[0]);

  return {
    totalScore,
    adjustedScore: Math.min(200, Math.max(0, adjustedScore)),
    label,
    pillars,
    lowestPillar: lowestPillar.name,
    coachingTip: coachingTips[lowestPillar.name] || "Keep training consistently!",
  };
}
