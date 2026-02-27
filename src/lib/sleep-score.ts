/**
 * Sleep Score Algorithm (0-100)
 * Based on National Sleep Foundation & Matthew Walker's research.
 * Calibrated to match Garmin-style harsh scoring.
 *
 * Components:
 *  - Duration (25 pts): 7-9h optimal
 *  - Deep sleep % (30 pts): 15-20% optimal — HEAVIEST, critical for recovery
 *  - REM sleep % (20 pts): 20-25% optimal
 *  - Sleep efficiency (15 pts): low awake time
 *  - Continuity bonus (10 pts): penalises fragmented sleep
 */

export interface SleepStageData {
  deep: number;   // seconds
  light: number;
  rem: number;
  awake: number;
}

export function calculateSleepScore(stages: SleepStageData): number {
  const total = stages.deep + stages.light + stages.rem + stages.awake;
  if (total === 0) return 0;

  const totalHours = total / 3600;
  const sleepTime = stages.deep + stages.light + stages.rem;
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
    // Harsh: under 6h is terrible
    durationScore = Math.max(0, 25 * (totalHours / 7) * 0.4);
  } else {
    durationScore = Math.max(0, 25 * 0.25);
  }

  // Deep sleep score (30 pts) — 15-20% ideal, <10% is catastrophic
  let deepScore: number;
  if (deepPct >= 15 && deepPct <= 25) {
    deepScore = 30;
  } else if (deepPct >= 12 && deepPct < 15) {
    deepScore = 30 * ((deepPct - 8) / 7); // 8-15 range maps to 0-30
  } else if (deepPct >= 10 && deepPct < 12) {
    deepScore = 30 * 0.35; // ~10.5 pts
  } else if (deepPct > 25 && deepPct <= 35) {
    deepScore = Math.max(20, 30 - (deepPct - 25) * 0.5);
  } else if (deepPct < 10) {
    // CATASTROPHIC — below 10% means almost no physical recovery
    // 7% → ~2.1pts, 5% → ~1pts, 3% → ~0.4pts
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
  const lightPct = (stages.light / sleepTime) * 100;
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
