/**
 * Sleep Score Algorithm (0-100)
 * Based on National Sleep Foundation & Matthew Walker's research.
 *
 * Components:
 *  - Duration (30 pts): 7-9h optimal
 *  - Deep sleep % (25 pts): 15-20% optimal
 *  - REM sleep % (25 pts): 20-25% optimal
 *  - Sleep efficiency (20 pts): low awake time
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
  const deepPct = stages.deep / sleepTime * 100;
  const remPct = stages.rem / sleepTime * 100;
  const efficiency = sleepTime / total * 100;

  // Duration score (30 pts) — bell curve around 7-9h
  let durationScore: number;
  if (totalHours >= 7 && totalHours <= 9) {
    durationScore = 30;
  } else if (totalHours >= 6 && totalHours < 7) {
    durationScore = 30 * ((totalHours - 5) / 2);
  } else if (totalHours > 9 && totalHours <= 10) {
    durationScore = 30 * ((10 - totalHours));
  } else if (totalHours < 6) {
    durationScore = Math.max(0, 30 * (totalHours / 6) * 0.5);
  } else {
    durationScore = Math.max(0, 30 * 0.3);
  }

  // Deep sleep score (25 pts) — 15-20% ideal
  let deepScore: number;
  if (deepPct >= 15 && deepPct <= 25) {
    deepScore = 25;
  } else if (deepPct >= 10 && deepPct < 15) {
    deepScore = 25 * ((deepPct - 5) / 10);
  } else if (deepPct > 25) {
    deepScore = Math.max(15, 25 - (deepPct - 25));
  } else {
    deepScore = Math.max(0, 25 * (deepPct / 15) * 0.6);
  }

  // REM score (25 pts) — 20-25% ideal
  let remScore: number;
  if (remPct >= 20 && remPct <= 30) {
    remScore = 25;
  } else if (remPct >= 10 && remPct < 20) {
    remScore = 25 * ((remPct - 5) / 15);
  } else if (remPct > 30) {
    remScore = Math.max(15, 25 - (remPct - 30));
  } else {
    remScore = Math.max(0, 25 * (remPct / 20) * 0.5);
  }

  // Efficiency score (20 pts) — >90% is great
  let effScore: number;
  if (efficiency >= 90) {
    effScore = 20;
  } else if (efficiency >= 75) {
    effScore = 20 * ((efficiency - 60) / 30);
  } else {
    effScore = Math.max(0, 20 * (efficiency / 90) * 0.5);
  }

  return Math.round(Math.min(100, durationScore + deepScore + remScore + effScore));
}

export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: "Excellent", color: "text-primary" };
  if (score >= 70) return { label: "Good", color: "text-primary" };
  if (score >= 50) return { label: "Fair", color: "text-yellow-500" };
  return { label: "Poor", color: "text-destructive" };
}
