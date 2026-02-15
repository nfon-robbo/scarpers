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

  // Body battery drain
  wakeTimeIso: string | null; // ISO timestamp of when user woke up
  todayActivities: { startIso: string; durationSec: number; intensityLoad: number }[];
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

/** Body-battery drain: passive drain from hours awake + active drain from activities.
 *  Returns a negative modifier (0 to ~-50). */
function bodyBatteryDrain(d: ReadinessData): { drain: number; hoursAwake: number; passiveDrain: number; activeDrain: number } {
  const now = Date.now();

  // Determine hours awake
  let hoursAwake: number;
  if (d.wakeTimeIso) {
    hoursAwake = Math.max(0, (now - new Date(d.wakeTimeIso).getTime()) / 3600000);
  } else {
    // Fallback: assume woke up at 7am local
    const today7am = new Date();
    today7am.setHours(7, 0, 0, 0);
    hoursAwake = Math.max(0, (now - today7am.getTime()) / 3600000);
  }

  // Cap at 20 hours (after that you're in a bad state anyway)
  hoursAwake = Math.min(20, hoursAwake);

  // Passive drain: gentle accelerating curve
  // Target: ~25-30 pts total after 16h awake
  // 0-4h: ~1pt/hr, 4-8h: ~1.5pts/hr, 8-12h: ~2pts/hr, 12-16h: ~2.5pts/hr, 16+: ~3pts/hr
  let passiveDrain = 0;
  if (hoursAwake <= 4) {
    passiveDrain = hoursAwake * 1;
  } else if (hoursAwake <= 8) {
    passiveDrain = 4 + (hoursAwake - 4) * 1.5;
  } else if (hoursAwake <= 12) {
    passiveDrain = 10 + (hoursAwake - 8) * 2;
  } else if (hoursAwake <= 16) {
    passiveDrain = 18 + (hoursAwake - 12) * 2.5;
  } else {
    passiveDrain = 28 + (hoursAwake - 16) * 3;
  }

  // Active drain: each activity drains based on intensity-weighted load
  // ~0.2 pts per intensity-weighted minute
  let activeDrain = 0;
  for (const act of d.todayActivities) {
    activeDrain += act.intensityLoad * 0.2;
  }
  activeDrain = Math.min(20, activeDrain); // cap active drain

  return {
    drain: -(passiveDrain + activeDrain),
    hoursAwake: Math.round(hoursAwake * 10) / 10,
    passiveDrain: Math.round(passiveDrain),
    activeDrain: Math.round(activeDrain),
  };
}

// ── Main scoring ───────────────────────────────────────────────────────

export function computeReadiness(d: ReadinessData): ReadinessResult {
  const factors: ReadinessFactor[] = [];
  let weightedSum = 0;
  const TOTAL_WEIGHT = 1.0;

  // ── Phase 1: Core factors (fixed-weight average) ──

  // Sleep Quality (30%) — primary recovery indicator
  if (d.sleepScore == null) {
    // Missing sleep = assume very poor — you can't recover without data
    weightedSum += 15 * 0.30;
    factors.push({
      label: "Sleep Quality",
      status: "poor",
      detail: "Not synced",
    });
  } else {
    const s = d.sleepScore;
    // Aggressive curve: scores below 70 get hammered
    const adjustedSleep = s >= 80 ? s : s >= 60 ? s * 0.75 : s * 0.55;
    weightedSum += adjustedSleep * 0.30;
    const sl = scoreLabel(s);
    factors.push({
      label: "Sleep Quality",
      status: s >= 75 ? "good" : s >= 55 ? "warning" : "poor",
      detail: `${s}/100 (${sl.label})${d.sleepHours != null ? ` · ${d.sleepHours.toFixed(1)}h` : ""}`,
    });
  }

  // Deep Sleep (15%) — standalone factor, critical for physical recovery
  if (d.deepPct != null) {
    const dp = d.deepPct;
    let deepReadiness: number;
    if (dp >= 15) {
      deepReadiness = 90;
    } else if (dp >= 12) {
      deepReadiness = 65;
    } else if (dp >= 10) {
      deepReadiness = 45;
    } else if (dp >= 7) {
      deepReadiness = 25;
    } else {
      deepReadiness = 10; // catastrophic
    }
    weightedSum += deepReadiness * 0.15;
    factors.push({
      label: "Deep Sleep",
      status: dp >= 13 ? "good" : dp >= 10 ? "warning" : "poor",
      detail: `${Math.round(dp)}% of sleep${dp < 10 ? " ⚠️ critically low" : ""}`,
    });
  } else {
    weightedSum += 10 * 0.15; // missing = assume terrible
  }

  // RHR vs baseline (12%)
  if (d.rhr != null && d.rhrBaseline != null) {
    const diff = d.rhr - d.rhrBaseline;
    const rhrScore = diff <= 0 ? 85 : diff <= 2 ? 75 : diff <= 4 ? 55 : diff <= 7 ? 35 : 15;
    weightedSum += rhrScore * 0.12;
    factors.push({
      label: "Resting HR",
      status: diff <= 3 ? "good" : diff <= 7 ? "warning" : "poor",
      detail: `${Math.round(d.rhr)} bpm (${diff > 0 ? "+" : ""}${Math.round(diff)} vs avg)`,
    });
  } else if (d.rhr != null) {
    weightedSum += 40 * 0.12;
    factors.push({ label: "Resting HR", status: "warning", detail: `${Math.round(d.rhr)} bpm (no baseline)` });
  } else {
    weightedSum += 15 * 0.12; // missing = bad
  }

  // HRV vs baseline (20%)
  if (d.hrv != null && d.hrvBaseline != null) {
    const diff = d.hrv - d.hrvBaseline;
    const pct = d.hrvBaseline > 0 ? (diff / d.hrvBaseline) * 100 : 0;
    const hrvScore = pct >= 10 ? 90 : pct >= 0 ? 75 : pct >= -10 ? 55 : pct >= -20 ? 35 : 15;
    weightedSum += hrvScore * 0.20;
    factors.push({
      label: "HRV",
      status: pct >= -5 ? "good" : pct >= -15 ? "warning" : "poor",
      detail: `${Math.round(d.hrv)} ms (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs avg)`,
    });
  } else {
    weightedSum += 10 * 0.20; // missing HRV = heavy penalty
    factors.push({ label: "HRV", status: "poor", detail: "No data" });
  }

  // Stress (10%)
  if (d.stressScore != null) {
    const v = d.stressScore;
    const stressScore = v <= 20 ? 85 : v <= 35 ? 65 : v <= 55 ? 45 : v <= 75 ? 25 : 10;
    weightedSum += stressScore * 0.10;
    factors.push({
      label: "Stress",
      status: v <= 30 ? "good" : v <= 55 ? "warning" : "poor",
      detail: `${Math.round(v)}/100`,
    });
  } else {
    weightedSum += 20 * 0.10; // missing stress = assume moderate-poor
  }

  // Yesterday's Load — intensity-weighted (13%)
  if (d.yesterdayLoad != null) {
    const l = d.yesterdayLoad;
    const loadScore = l <= 15 ? 85 : l <= 40 ? 70 : l <= 80 ? 45 : l <= 140 ? 25 : 10;
    weightedSum += loadScore * 0.13;
    factors.push({
      label: "Yesterday's Load",
      status: l <= 40 ? "good" : l <= 80 ? "warning" : "poor",
      detail: `${Math.round(l)} min training`,
    });
  } else {
    weightedSum += 50 * 0.13; // rest day = decent
  }

  // Normalise to 0-100 with fixed denominator
  let baseScore = weightedSum / TOTAL_WEIGHT;

  // ── Phase 2: Modifiers (additive) ──

  const modifiers: { label: string; adj: number; detail: string }[] = [];

  // Recovery time — more aggressive
  if (d.recoveryHoursSinceLastHard != null && d.lastWorkoutIntensity != null) {
    const hrs = d.recoveryHoursSinceLastHard;
    const intensity = d.lastWorkoutIntensity;
    const neededHrs = 8 + (intensity / 100) * 16;
    if (hrs < neededHrs) {
      const ratio = hrs / neededHrs;
      const penalty = -Math.round(6 + (1 - ratio) * 14); // -6 to -20
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

  // 3-day sleep debt — harsher
  if (d.recentSleepAvgHours != null && d.baselineSleepAvgHours != null && d.baselineSleepAvgHours > 0) {
    const debt = d.recentSleepAvgHours - d.baselineSleepAvgHours;
    if (debt < -0.3) {
      const penalty = Math.round(Math.max(-20, debt * 10)); // -10 per hour deficit, max -20
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
    if (avg > 45) {
      const penalty = -Math.round(Math.min(12, (avg - 45) / 4)); // -1 to -12
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
    if (ratio > 1.4) {
      const penalty = -Math.round(Math.min(12, (ratio - 1.4) * 12)); // -1 to -12
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
    const penalty = -Math.round(Math.min(18, (d.todayLoad / 50) * 10)); // -1 to -18
    modifiers.push({
      label: "Today's Effort",
      adj: penalty,
      detail: `${Math.round(d.todayLoad)} min (intensity-weighted)`,
    });
  }

  // Body battery drain (replaces old circadian modifier)
  const battery = bodyBatteryDrain(d);

  // Apply modifiers
  let totalAdj = battery.drain;
  for (const m of modifiers) {
    totalAdj += m.adj;
  }

  // Add body battery drain as a visible factor
  if (battery.hoursAwake > 0.5) {
    const drainTotal = battery.passiveDrain + battery.activeDrain;
    factors.push({
      label: "Body Battery",
      status: drainTotal <= 15 ? "good" : drainTotal <= 30 ? "warning" : "poor",
      detail: `${battery.hoursAwake}h awake · -${drainTotal} drain${battery.activeDrain > 0 ? ` (${battery.activeDrain} from activity)` : ""}`,
    });
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
