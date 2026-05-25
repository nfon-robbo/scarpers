/**
 * Sleep Score Algorithm (0-100)
 * Based on National Sleep Foundation & Matthew Walker's research.
 * Calibrated to match Garmin-style harsh scoring.
 *
 * Components (when stage data available):
 *  - Duration (25 pts): 7-9h optimal
 *  - Deep sleep % (30 pts): 15-20% optimal — HEAVIEST, critical for recovery
 *  - REM sleep % (20 pts): 20-25% optimal
 *  - Sleep efficiency (15 pts): low awake time
 *  - Continuity bonus (10 pts): penalises fragmented sleep
 *
 * When only generic "sleep" data is available (no stage breakdown),
 * score is based purely on duration (scaled to 0-100).
 */

export interface SleepStageData {
  deep: number;   // seconds
  light: number;
  rem: number;
  awake: number;
  sleep: number;  // generic sleep (no stage breakdown)
}

/** Optional Garmin-screenshot vitals that adjust the final score. */
export interface AdvancedSleepMetrics {
  spo2_avg?: number | null;            // %
  spo2_lowest?: number | null;         // %
  breathing_pattern?: string | null;   // "Balanced" | "Few" | "Many"
  restless_count?: number | null;
  skin_temp_deviation?: number | null; // °C from baseline (signed)
}

export interface SleepScoreBreakdown {
  core: number;          // pre-adjustment score
  spo2Adj: number;
  breathingAdj: number;
  restlessAdj: number;
  skinTempAdj: number;
  total: number;         // clamped 0-100
}

export function advancedSleepAdjustments(adv?: AdvancedSleepMetrics | null) {
  let spo2 = 0;
  if (adv?.spo2_avg != null) {
    const a = adv.spo2_avg;
    spo2 = a >= 95 ? 5 : a >= 92 ? 3 : a >= 88 ? 1 : -5;
    if (adv.spo2_lowest != null && adv.spo2_lowest < 85) spo2 -= 5;
  }
  let breathing = 0;
  const bp = (adv?.breathing_pattern ?? "").toLowerCase();
  if (bp === "balanced") breathing = 3;
  else if (bp === "few") breathing = 1;
  else if (bp === "many") breathing = -3;

  let restless = 0;
  if (adv?.restless_count != null) {
    const r = adv.restless_count;
    restless = r < 30 ? 0 : r < 60 ? -2 : r <= 100 ? -4 : -5;
  }

  let skin = 0;
  if (adv?.skin_temp_deviation != null) {
    const d = Math.abs(adv.skin_temp_deviation);
    skin = d <= 1 ? 0 : d > 2.5 ? -5 : d > 1.5 ? -3 : 0;
  }
  return { spo2, breathing, restless, skin };
}


export function calculateSleepScore(stages: SleepStageData): number {
  const stageTotal = stages.deep + stages.light + stages.rem + stages.awake;
  const genericSleep = stages.sleep || 0;
  const total = stageTotal + genericSleep;
  if (total === 0) return 0;

  // If we only have generic "sleep" data (no stage breakdown),
  // score based on duration alone
  const hasStages = stageTotal > 0;
  if (!hasStages) {
    const totalHours = genericSleep / 3600;
    if (totalHours >= 7 && totalHours <= 9) return 75;
    if (totalHours >= 6 && totalHours < 7) return Math.round(50 + 25 * ((totalHours - 6)));
    if (totalHours > 9 && totalHours <= 10) return Math.round(65 + 10 * (10 - totalHours));
    if (totalHours < 6) return Math.round(Math.max(15, 50 * (totalHours / 6)));
    return 55; // >10h
  }

  const totalHours = total / 3600;
  const sleepTime = stages.deep + stages.light + stages.rem + genericSleep;
  if (sleepTime === 0) return 0;
  const deepPct = (stages.deep / sleepTime) * 100;
  const remPct = (stages.rem / sleepTime) * 100;
  const efficiency = (sleepTime / total) * 100;

  // Duration score (25 pts) — bell curve around 7-9h
  let durationScore: number;
  if (totalHours >= 7 && totalHours <= 9) {
    durationScore = 25;
  } else if (totalHours >= 6 && totalHours < 7) {
    durationScore = 25 * ((totalHours - 5) / 2);
  } else if (totalHours > 9 && totalHours <= 10) {
    durationScore = 25 * (10 - totalHours);
  } else if (totalHours < 6) {
    durationScore = Math.max(0, 25 * (totalHours / 7) * 0.4);
  } else {
    durationScore = Math.max(0, 25 * 0.25);
  }

  // Deep sleep score (30 pts) — 15-20% ideal, <10% is catastrophic
  let deepScore: number;
  if (deepPct >= 15 && deepPct <= 25) {
    deepScore = 30;
  } else if (deepPct >= 12 && deepPct < 15) {
    deepScore = 30 * ((deepPct - 8) / 7);
  } else if (deepPct >= 10 && deepPct < 12) {
    deepScore = 30 * 0.35;
  } else if (deepPct > 25 && deepPct <= 35) {
    deepScore = Math.max(20, 30 - (deepPct - 25) * 0.5);
  } else if (deepPct < 10) {
    deepScore = Math.max(0, 30 * (deepPct / 15) * 0.15);
  } else {
    deepScore = 15;
  }

  // REM score (20 pts) — 20-25% ideal
  let remScore: number;
  if (remPct >= 20 && remPct <= 30) {
    remScore = 20;
  } else if (remPct >= 12 && remPct < 20) {
    remScore = 20 * ((remPct - 5) / 15);
  } else if (remPct > 30) {
    remScore = Math.max(12, 20 - (remPct - 30) * 0.5);
  } else {
    remScore = Math.max(0, 20 * (remPct / 20) * 0.4);
  }

  // Efficiency score (15 pts) — >90% is great
  let effScore: number;
  if (efficiency >= 92) {
    effScore = 15;
  } else if (efficiency >= 80) {
    effScore = 15 * ((efficiency - 65) / 27);
  } else if (efficiency >= 70) {
    effScore = 15 * 0.3;
  } else {
    effScore = Math.max(0, 15 * (efficiency / 90) * 0.3);
  }

  // Light-heavy penalty: if light sleep dominates (>75% of sleep time), extra penalty
  const lightPct = ((stages.light + genericSleep) / sleepTime) * 100;
  let lightPenalty = 0;
  if (lightPct > 75) {
    lightPenalty = Math.min(10, (lightPct - 75) * 0.5);
  }

  const raw = durationScore + deepScore + remScore + effScore - lightPenalty;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: "Excellent", color: "text-primary" };
  if (score >= 70) return { label: "Good", color: "text-primary" };
  if (score >= 50) return { label: "Fair", color: "text-yellow-500" };
  if (score >= 30) return { label: "Poor", color: "text-destructive" };
  return { label: "Very Poor", color: "text-destructive" };
}
