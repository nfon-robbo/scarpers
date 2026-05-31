import { calculateSleepScore, scoreLabel, type SleepStageData } from "@/lib/sleep-score";
import { computeBodyBattery, type BodyBatteryResult } from "@/lib/body-battery";

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

  // Optional sleep-respiration metrics (Garmin screenshot)
  spo2Avg?: number | null;
  breathingPattern?: string | null;   // Balanced/Few/Many
  restlessCount?: number | null;
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

// Battery math now lives in src/lib/body-battery.ts (shared with edge fn + 48h chart).


// ── Main scoring ───────────────────────────────────────────────────────

export type ReadinessMode = "morning" | "eod";

export function computeReadiness(d: ReadinessData, mode: ReadinessMode = "eod"): ReadinessResult {
  const factors: ReadinessFactor[] = [];
  const isMorning = mode === "morning";
  let weightedSum = 0;
  const TOTAL_WEIGHT = 1.0;

  // ── Phase 1: Core factors (fixed-weight average) ──

  // Sleep Quality (32%) — primary recovery indicator
  if (d.sleepScore == null) {
    // Missing sleep = assume moderate-poor
    weightedSum += 30 * 0.32;
    factors.push({
      label: "Sleep Quality",
      status: "poor",
      detail: "Not synced",
    });
  } else {
    const s = d.sleepScore;
    // Aggressive curve: scores below 70 get hammered
    const adjustedSleep = s >= 80 ? s : s >= 60 ? s * 0.75 : s >= 50 ? s * 0.65 : s * 0.55;
    weightedSum += adjustedSleep * 0.32;
    const sl = scoreLabel(s);
    factors.push({
      label: "Sleep Quality",
      status: s >= 75 ? "good" : s >= 55 ? "warning" : "poor",
      detail: `${s}/100 (${sl.label})${d.sleepHours != null ? ` · ${d.sleepHours.toFixed(1)}h` : ""}`,
    });
  }


  // Deep Sleep (14%) — standalone factor, critical for physical recovery
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
    weightedSum += deepReadiness * 0.14;
    factors.push({
      label: "Deep Sleep",
      status: dp >= 13 ? "good" : dp >= 10 ? "warning" : "poor",
      detail: `${Math.round(dp)}% of sleep · ${dp < 10 ? "Critically low" : dp < 13 ? "Low" : "Healthy"}`,
    });
  } else {
    weightedSum += 25 * 0.14; // missing = assume poor but not catastrophic
  }

  // RHR vs baseline (11%)
  if (d.rhr != null && d.rhrBaseline != null) {
    const diff = d.rhr - d.rhrBaseline;
    const rhrScore = diff <= 0 ? 85 : diff <= 2 ? 75 : diff <= 4 ? 55 : diff <= 7 ? 35 : 15;
    weightedSum += rhrScore * 0.11;
    factors.push({
      label: "Resting HR",
      status: diff <= 3 ? "good" : diff <= 7 ? "warning" : "poor",
      detail: `${Math.round(d.rhr)} bpm (${diff > 0 ? "+" : ""}${Math.round(diff)} vs avg)`,
    });
  } else if (d.rhr != null) {
    weightedSum += 40 * 0.11;
    factors.push({ label: "Resting HR", status: "warning", detail: `${Math.round(d.rhr)} bpm (no baseline)` });
  } else {
    weightedSum += 15 * 0.11; // missing = bad
  }

  // HRV vs baseline (21%)
  if (d.hrv != null && d.hrvBaseline != null) {
    const diff = d.hrv - d.hrvBaseline;
    const pct = d.hrvBaseline > 0 ? (diff / d.hrvBaseline) * 100 : 0;
    const hrvScore = pct >= 10 ? 90 : pct >= 0 ? 75 : pct >= -10 ? 55 : pct >= -20 ? 35 : 15;
    weightedSum += hrvScore * 0.21;
    factors.push({
      label: "HRV",
      status: pct >= -5 ? "good" : pct >= -15 ? "warning" : "poor",
      detail: `${Math.round(d.hrv)} ms (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs avg)`,
    });
  } else {
    weightedSum += 40 * 0.21; // missing HRV = mild penalty (data-timing, not recovery)
    factors.push({ label: "HRV", status: "warning", detail: "Not synced" });
  }

  // Yesterday's Load — intensity-weighted (15%)
  if (d.yesterdayLoad != null) {
    const l = d.yesterdayLoad;
    const loadScore = l <= 15 ? 85 : l <= 40 ? 70 : l <= 80 ? 45 : l <= 140 ? 25 : 10;
    weightedSum += loadScore * 0.15;
    factors.push({
      label: "Yesterday's Load",
      status: l <= 40 ? "good" : l <= 80 ? "warning" : "poor",
      detail: `${Math.floor(l / 60)}:${String(Math.round(l % 60)).padStart(2, "0")} training`,
    });
  } else {
    weightedSum += 50 * 0.15; // rest day = decent
  }

  // Respiration Health (7%) — Garmin screenshot vitals; neutral when missing
  {
    const hasAny = d.spo2Avg != null || d.breathingPattern != null || d.restlessCount != null;
    if (!hasAny) {
      weightedSum += 50 * 0.07;
    } else {
      let r = 50;
      if (d.spo2Avg != null) {
        if (d.spo2Avg >= 95) r += 20;
        else if (d.spo2Avg < 90) r -= 30;
      }
      const bp = (d.breathingPattern ?? "").toLowerCase();
      if (bp === "balanced") r += 15;
      else if (bp === "many") r -= 15;
      if (d.restlessCount != null) {
        if (d.restlessCount < 40) r += 15;
        else if (d.restlessCount > 80) r -= 20;
      }
      r = Math.max(0, Math.min(100, r));
      weightedSum += r * 0.07;
      const parts: string[] = [];
      if (d.spo2Avg != null) parts.push(`SpO₂ ${Math.round(d.spo2Avg)}%`);
      if (bp) parts.push(`breathing ${bp}`);
      if (d.restlessCount != null) parts.push(`${d.restlessCount} restless`);
      factors.push({
        label: "Respiration Health",
        status: r >= 70 ? "good" : r >= 45 ? "warning" : "poor",
        detail: parts.join(" · ") || `${r}/100`,
      });
    }
  }


  // Normalise to 0-100 with fixed denominator
  let baseScore = weightedSum / TOTAL_WEIGHT;

  // ── Phase 2: Modifiers (EOD only) ──

  if (isMorning) {
    // Morning score = pure overnight recovery snapshot. No daytime drain,
    // no today's effort, no recovery-clock penalty. Floor at 5.
    const finalScore = Math.round(Math.max(5, Math.min(100, baseScore)));
    return { score: finalScore, factors };
  }

  const modifiers: { label: string; adj: number; detail: string }[] = [];

  // Determine if the last workout was TODAY (to avoid double-counting)
  const lastWorkoutWasToday = d.todayLoad != null && d.todayLoad > 0;

  // Recovery time — only penalise if last hard session was YESTERDAY or earlier
  // If you trained today, recovery is already captured by Today's Effort
  if (d.recoveryHoursSinceLastHard != null && d.lastWorkoutIntensity != null && !lastWorkoutWasToday) {
    const hrs = d.recoveryHoursSinceLastHard;
    const intensity = d.lastWorkoutIntensity;
    const neededHrs = 8 + (intensity / 100) * 16;
    if (hrs < neededHrs) {
      const ratio = hrs / neededHrs;
      const penalty = -Math.round(4 + (1 - ratio) * 10); // -4 to -14 (softened)
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
  } else if (!lastWorkoutWasToday && d.recoveryHoursSinceLastHard != null) {
    modifiers.push({
      label: "Recovery",
      adj: 0,
      detail: `${Math.round(d.recoveryHoursSinceLastHard)}h since last session`,
    });
  }

  // 3-day sleep debt — harsher
  if (d.recentSleepAvgHours != null && d.baselineSleepAvgHours != null && d.baselineSleepAvgHours > 0) {
    const debt = d.recentSleepAvgHours - d.baselineSleepAvgHours;
    if (debt < -0.3) {
      const penalty = Math.round(Math.max(-15, debt * 8)); // softened: -8 per hour deficit, max -15
      modifiers.push({
        label: "Sleep Debt",
        adj: penalty,
        detail: `${debt.toFixed(1)}h vs avg (3 nights)`,
      });
    }
  }



  // Training monotony (7d vs 28d)
  if (d.weeklyLoadAvg != null && d.monthlyLoadAvg != null && d.monthlyLoadAvg > 0) {
    const ratio = d.weeklyLoadAvg / d.monthlyLoadAvg;
    if (ratio > 1.4) {
      const penalty = -Math.round(Math.min(10, (ratio - 1.4) * 10)); // softened
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

  // Today's load — moderate penalty, this is the ONLY penalty for today's workout
  if (d.todayLoad != null && d.todayLoad > 0) {
    const penalty = -Math.round(Math.min(12, (d.todayLoad / 60) * 8)); // -1 to -12 (softened)
    modifiers.push({
      label: "Today's Effort",
      adj: penalty,
      detail: `${Math.floor(d.todayLoad / 60)}:${String(Math.round(d.todayLoad % 60)).padStart(2, "0")} (intensity-weighted)`,
    });
  }

  // Body battery (phone-style 0-100% reserve)
  const battery = computeBodyBattery({
    sleep: {
      sleepScore: d.sleepScore,
      sleepHours: d.sleepHours,
      deepPct: d.deepPct,
      remPct: d.remPct,
      hrv: d.hrv,
      hrvBaseline: d.hrvBaseline,
      recentSleepAvgHours: d.recentSleepAvgHours,
      baselineSleepAvgHours: d.baselineSleepAvgHours,
    },
    wakeTimeIso: d.wakeTimeIso,
    todayActivities: d.todayActivities,
  });

  // Readiness penalty derived from battery — fully drained shaves at most 25 pts.
  const batteryPenalty = -Math.round(Math.min(25, ((100 - battery.percent) * 0.25)));
  let totalAdj = batteryPenalty;
  for (const m of modifiers) totalAdj += m.adj;

  {
    const warmingUp = battery.hoursAwake <= 0.5;
    const status: "good" | "warning" | "poor" = warmingUp
      ? "good"
      : battery.percent >= 60 ? "good" : battery.percent >= 30 ? "warning" : "poor";
    const breakdown = `Started ${battery.startPercent}% · -${battery.drainAwake} awake${battery.drainActive > 0 ? ` · -${battery.drainActive} activity` : ""} (${battery.hoursAwake}h awake)`;
    factors.push({
      label: "Body Battery",
      status,
      detail: warmingUp
        ? `UPDATING · Started ${battery.startPercent}% — fresh readings within the hour`
        : `${battery.percent}% · ${battery.status} — ${breakdown}`,
    });
  }


  // Overdrawn state: floor at 5 — never fully zero
  const finalScore = Math.round(Math.max(5, Math.min(100, baseScore + totalAdj)));

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
    if (!byDate.has(s.date)) byDate.set(s.date, { deep: 0, light: 0, rem: 0, awake: 0, sleep: 0 });
    const entry = byDate.get(s.date)!;
    if (key === "deep") entry.deep += s.duration_seconds || 0;
    else if (key === "light") entry.light += s.duration_seconds || 0;
    else if (key === "rem") entry.rem += s.duration_seconds || 0;
    else if (key === "awake") entry.awake += s.duration_seconds || 0;
    else if (key === "sleep") entry.sleep += s.duration_seconds || 0;
  }

  // Pick most recent date
  const dates = [...byDate.keys()].sort().reverse();
  if (dates.length === 0) return { deep: 0, light: 0, rem: 0, awake: 0, sleep: 0 };
  return byDate.get(dates[0])!;
}
