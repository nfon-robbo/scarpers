import { calculateSleepScore, scoreLabel, type SleepStageData } from "@/lib/sleep-score";

// ── Types ──────────────────────────────────────────────────────────────

export interface ReadinessData {
  // Core
  sleepScore: number | null;
  sleepHours: number | null;
  deepPct: number | null;
  remPct: number | null;
  rhr: number | null;
  rhrBaseline: number | null;
  hrv: number | null;
  hrvBaseline: number | null;
  yesterdayLoad: number | null; // intensity-weighted minutes
  stressScore: number | null;

  // New modifiers
  todayLoad: number | null; // intensity-weighted minutes today
  recoveryHoursSinceLastHard: number | null;
  lastWorkoutIntensity: number | null; // 0-100
  recentSleepAvgHours: number | null; // 3-night avg
  baselineSleepAvgHours: number | null; // 30-day avg
  stressHistory: number[]; // last 3 days
  weeklyLoadAvg: number | null; // 7-day daily avg minutes
  monthlyLoadAvg: number | null; // 28-day daily avg minutes
  currentHour: number;
}

export interface ReadinessFactor {
  label: string;
  status: "good" | "warning" | "poor";
  detail: string;
}

export interface ReadinessResult {
  score: number;
  factors: ReadinessFactor[];
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Estimate intensity-weighted load for a single activity (returns minutes-equivalent). */
export function activityIntensityLoad(act: {
  duration_seconds: number | null;
  training_load: number | null;
  training_effect: number | null;
  avg_heart_rate: number | null;
}): number {
  const mins = (act.duration_seconds || 0) / 60;
  if (mins <= 0) return 0;

  // If training_load exists, use it directly as intensity-weighted minutes
  if (act.training_load != null && act.training_load > 0) return act.training_load;

  // Estimate from training_effect (1-5 scale → multiplier 0.5-2.0)
  if (act.training_effect != null && act.training_effect > 0) {
    const mult = 0.25 + (act.training_effect / 5) * 1.75;
    return mins * mult;
  }

  // Estimate from avg HR (assume ~140 is moderate baseline)
  if (act.avg_heart_rate != null && act.avg_heart_rate > 0) {
    const mult = Math.max(0.5, Math.min(2.0, act.avg_heart_rate / 140));
    return mins * mult;
  }

  return mins; // fallback: raw minutes
}

/** Estimate workout intensity 0-100 from activity fields. */
export function workoutIntensity(act: {
  training_effect: number | null;
  avg_heart_rate: number | null;
  training_load: number | null;
  duration_seconds: number | null;
}): number {
  if (act.training_effect != null && act.training_effect > 0) {
    return Math.min(100, (act.training_effect / 5) * 100);
  }
  if (act.avg_heart_rate != null && act.avg_heart_rate > 0) {
    // Map 100-200 bpm → 20-100 intensity
    return Math.min(100, Math.max(10, ((act.avg_heart_rate - 100) / 100) * 80 + 20));
  }
  if (act.training_load != null && act.training_load > 0) {
    return Math.min(100, (act.training_load / 200) * 100);
  }
  // Duration-only fallback
  const mins = (act.duration_seconds || 0) / 60;
  return Math.min(100, Math.max(10, (mins / 90) * 60 + 20));
}

/** Circadian modifier: energy curve based on local hour.
 *  Late night should aggressively tank readiness — you're not ready to train at midnight. */
function circadianModifier(hour: number): number {
  // 10-12 peak energy
  if (hour >= 10 && hour < 12) return 3;
  // 8-10 warming up
  if (hour >= 8 && hour < 10) return 2;
  // 6-8 early morning
  if (hour >= 6 && hour < 8) return 0;
  // 14-17 afternoon recovery
  if (hour >= 14 && hour < 17) return 0;
  // 12-14 post-lunch dip
  if (hour >= 12 && hour < 14) return -3;
  // 17-20 early evening wind-down
  if (hour >= 17 && hour < 20) return -10;
  // 20-22 late evening
  if (hour >= 20 && hour < 22) return -30;
  // 22-00 night — you should be asleep
  if (hour >= 22) return -50;
  // 00-03 deep night — absolute tank
  if (hour < 3) return -60;
  // 3-6 pre-dawn
  if (hour >= 3 && hour < 6) return -40;
  return 0;
}

// ── Main scoring ───────────────────────────────────────────────────────

export function computeReadiness(d: ReadinessData): ReadinessResult {
  const factors: ReadinessFactor[] = [];
  let weightedSum = 0;
  let weightSum = 0;

  // ── Phase 1: Core factors (weighted average) ──

  // Sleep Quality (30%)
  if (d.sleepScore != null) {
    const s = d.sleepScore;
    weightedSum += s * 0.30;
    weightSum += 0.30;
    const sl = scoreLabel(s);
    factors.push({
      label: "Sleep Quality",
      status: s >= 70 ? "good" : s >= 50 ? "warning" : "poor",
      detail: `${s}/100 (${sl.label})${d.sleepHours != null ? ` · ${d.sleepHours.toFixed(1)}h` : ""}`,
    });
  }

  // RHR vs baseline (20%)
  if (d.rhr != null && d.rhrBaseline != null) {
    const diff = d.rhr - d.rhrBaseline;
    const rhrScore = diff <= 2 ? 90 : diff <= 5 ? 70 : diff <= 10 ? 50 : 30;
    weightedSum += rhrScore * 0.20;
    weightSum += 0.20;
    factors.push({
      label: "Resting HR",
      status: diff <= 3 ? "good" : diff <= 7 ? "warning" : "poor",
      detail: `${Math.round(d.rhr)} bpm (${diff > 0 ? "+" : ""}${Math.round(diff)} vs avg)`,
    });
  } else if (d.rhr != null) {
    factors.push({ label: "Resting HR", status: "good", detail: `${Math.round(d.rhr)} bpm` });
  }

  // HRV vs baseline (25%)
  if (d.hrv != null && d.hrvBaseline != null) {
    const diff = d.hrv - d.hrvBaseline;
    const pct = d.hrvBaseline > 0 ? (diff / d.hrvBaseline) * 100 : 0;
    const hrvScore = pct >= -5 ? 90 : pct >= -15 ? 65 : 40;
    weightedSum += hrvScore * 0.25;
    weightSum += 0.25;
    factors.push({
      label: "HRV",
      status: pct >= -10 ? "good" : pct >= -20 ? "warning" : "poor",
      detail: `${Math.round(d.hrv)} ms (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs avg)`,
    });
  }

  // Stress (15%)
  if (d.stressScore != null) {
    const v = d.stressScore;
    const stressScore = v <= 25 ? 90 : v <= 50 ? 70 : v <= 75 ? 45 : 25;
    weightedSum += stressScore * 0.15;
    weightSum += 0.15;
    factors.push({
      label: "Stress",
      status: v <= 30 ? "good" : v <= 60 ? "warning" : "poor",
      detail: `${Math.round(v)}/100`,
    });
  }

  // Yesterday's Load — intensity-weighted (10%)
  if (d.yesterdayLoad != null) {
    const l = d.yesterdayLoad;
    const loadScore = l <= 30 ? 90 : l <= 60 ? 75 : l <= 120 ? 55 : 35;
    weightedSum += loadScore * 0.10;
    weightSum += 0.10;
    factors.push({
      label: "Yesterday's Load",
      status: l <= 45 ? "good" : l <= 90 ? "warning" : "poor",
      detail: `${Math.round(l)} min training`,
    });
  }

  // Normalise to 0-100
  let baseScore = weightSum > 0 ? weightedSum / weightSum : 50;

  // ── Phase 2: Modifiers (additive) ──

  const modifiers: { label: string; adj: number; detail: string }[] = [];

  // Recovery time
  if (d.recoveryHoursSinceLastHard != null && d.lastWorkoutIntensity != null) {
    const hrs = d.recoveryHoursSinceLastHard;
    const intensity = d.lastWorkoutIntensity;
    // Higher intensity needs more recovery; penalise if within window
    const neededHrs = 8 + (intensity / 100) * 16; // 8-24h based on intensity
    if (hrs < neededHrs) {
      const ratio = hrs / neededHrs;
      const penalty = -Math.round(5 + (1 - ratio) * 10); // -5 to -15
      modifiers.push({
        label: "Recovery",
        adj: penalty,
        detail: `${Math.round(hrs)}h since last session`,
      });
    } else {
      modifiers.push({
        label: "Recovery",
        adj: 0,
        detail: `${Math.round(hrs)}h since last session`,
      });
    }
  }

  // 3-day sleep debt
  if (d.recentSleepAvgHours != null && d.baselineSleepAvgHours != null && d.baselineSleepAvgHours > 0) {
    const debt = d.recentSleepAvgHours - d.baselineSleepAvgHours;
    if (debt < -0.5) {
      const penalty = Math.round(Math.max(-15, debt * 7)); // -7 per hour deficit, max -15
      modifiers.push({
        label: "Sleep Debt",
        adj: penalty,
        detail: `${debt.toFixed(1)}h vs avg (3 nights)`,
      });
    }
  }

  // 3-day stress trend
  if (d.stressHistory.length >= 2) {
    const avg = d.stressHistory.reduce((a, b) => a + b, 0) / d.stressHistory.length;
    if (avg > 50) {
      const penalty = -Math.round(Math.min(10, (avg - 50) / 5)); // -1 to -10
      modifiers.push({
        label: "Stress Trend",
        adj: penalty,
        detail: `avg ${Math.round(avg)}/100 (${d.stressHistory.length}d)`,
      });
    }
  }

  // Training monotony (7d vs 28d)
  if (d.weeklyLoadAvg != null && d.monthlyLoadAvg != null && d.monthlyLoadAvg > 0) {
    const ratio = d.weeklyLoadAvg / d.monthlyLoadAvg;
    if (ratio > 1.5) {
      const penalty = -Math.round(Math.min(10, (ratio - 1.5) * 10)); // -1 to -10
      modifiers.push({
        label: "Training Ramp",
        adj: penalty,
        detail: `${ratio.toFixed(1)}x vs monthly avg`,
      });
    } else if (ratio < 0.5 && d.weeklyLoadAvg > 0) {
      modifiers.push({
        label: "Freshness",
        adj: 3,
        detail: `${ratio.toFixed(1)}x vs monthly avg`,
      });
    }
  }

  // Today's load
  if (d.todayLoad != null && d.todayLoad > 0) {
    const penalty = -Math.round(Math.min(15, (d.todayLoad / 60) * 10)); // -1 to -15
    modifiers.push({
      label: "Today's Effort",
      adj: penalty,
      detail: `${Math.round(d.todayLoad)} min (intensity-weighted)`,
    });
  }

  // Circadian (silent — not shown as a factor row)
  const circAdj = circadianModifier(d.currentHour);

  // Apply modifiers
  let totalAdj = circAdj;
  for (const m of modifiers) {
    totalAdj += m.adj;
  }

  const finalScore = Math.round(Math.max(0, Math.min(100, baseScore + totalAdj)));

  // Add visible modifiers to factors (only if |adj| >= 3)
  for (const m of modifiers) {
    if (Math.abs(m.adj) >= 3 || (m.label === "Recovery" && m.adj === 0)) {
      factors.push({
        label: m.label,
        status: m.adj >= 0 ? "good" : m.adj >= -5 ? "warning" : "poor",
        detail: m.detail,
      });
    }
  }

  return { score: finalScore, factors };
}

// ── Sleep stage grouping (fixes double-count bug) ──

export function groupSleepByDate(
  stages: { stage: string; duration_seconds: number; date: string }[]
): SleepStageData {
  // Group by date, pick the most recent date
  const byDate = new Map<string, SleepStageData>();
  for (const s of stages) {
    const key = s.stage?.toLowerCase();
    if (!byDate.has(s.date)) byDate.set(s.date, { deep: 0, light: 0, rem: 0, awake: 0 });
    const entry = byDate.get(s.date)!;
    if (key === "deep") entry.deep += s.duration_seconds || 0;
    else if (key === "light") entry.light += s.duration_seconds || 0;
    else if (key === "rem") entry.rem += s.duration_seconds || 0;
    else if (key === "awake") entry.awake += s.duration_seconds || 0;
  }

  // Pick most recent date
  const dates = [...byDate.keys()].sort().reverse();
  if (dates.length === 0) return { deep: 0, light: 0, rem: 0, awake: 0 };
  return byDate.get(dates[0])!;
}
