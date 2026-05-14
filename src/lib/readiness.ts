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

/** Body-battery drain & daytime charging.
 *  Passive drain ramps from 1 to 3 pts/hr based on hours awake only.
 *  When prior-2h activity load <5, the battery charges at 1-3 pts/hr
 *  (scaled by HRV vs baseline), capped at 15 pts/day. */
function bodyBatteryDrain(d: ReadinessData): {
  drain: number;
  hoursAwake: number;
  passiveDrain: number;
  activeDrain: number;
  passiveCharge: number;
} {
  const now = Date.now();

  // Determine hours awake
  let wakeMs: number;
  if (d.wakeTimeIso) {
    wakeMs = new Date(d.wakeTimeIso).getTime();
  } else {
    const today7am = new Date();
    today7am.setHours(7, 0, 0, 0);
    wakeMs = today7am.getTime();
  }
  let hoursAwake = Math.max(0, (now - wakeMs) / 3600000);
  hoursAwake = Math.min(20, hoursAwake); // 20h cap unchanged

  // ── Passive drain: hours-awake-only ramp from 1 → 3 pts/hr ──
  // rate = min(3, 1 + hoursAwake/8) integrated hour-by-hour
  let passiveDrain = 0;
  for (let h = 0; h < hoursAwake; h++) {
    const slice = Math.min(1, hoursAwake - h);
    const rate = Math.min(3, 1 + h / 8);
    passiveDrain += rate * slice;
  }

  // ── Active drain (unchanged) ──
  let activeDrain = 0;
  for (const act of d.todayActivities) {
    activeDrain += act.intensityLoad * 0.1;
  }
  activeDrain = Math.min(10, activeDrain);

  // ── Daytime charging ──
  // For each hour-slice since wake, if prior-2h intensity load <5,
  // charge at 1/2/3 pts based on HRV vs baseline. Cap total at 15 pts.
  let passiveCharge = 0;
  let chargeRate = 2; // at baseline
  if (d.hrv != null && d.hrvBaseline != null && d.hrvBaseline > 0) {
    if (d.hrv > d.hrvBaseline * 1.05) chargeRate = 3;
    else if (d.hrv < d.hrvBaseline * 0.95) chargeRate = 1;
  }

  for (let h = 0; h < hoursAwake && passiveCharge < 15; h++) {
    const sliceStart = wakeMs + h * 3600000;
    const sliceEnd = Math.min(now, sliceStart + 3600000);
    const sliceHours = (sliceEnd - sliceStart) / 3600000;
    if (sliceHours <= 0) break;

    // Intensity-weighted minutes in the prior 2h window
    const windowStart = sliceStart - 2 * 3600000;
    let recentLoad = 0;
    for (const act of d.todayActivities) {
      const aStart = new Date(act.startIso).getTime();
      const aEnd = aStart + (act.durationSec || 0) * 1000;
      if (aEnd < windowStart || aStart > sliceStart) continue;
      const overlap = Math.max(0, Math.min(aEnd, sliceStart) - Math.max(aStart, windowStart));
      const total = Math.max(1, aEnd - aStart);
      recentLoad += act.intensityLoad * (overlap / total);
    }

    if (recentLoad < 5) {
      passiveCharge = Math.min(15, passiveCharge + chargeRate * sliceHours);
    }
  }

  const netDrain = passiveDrain + activeDrain - passiveCharge;

  return {
    drain: -netDrain,
    hoursAwake: Math.round(hoursAwake * 10) / 10,
    passiveDrain: Math.round(passiveDrain),
    activeDrain: Math.round(activeDrain),
    passiveCharge: Math.round(passiveCharge),
  };
}

// ── Main scoring ───────────────────────────────────────────────────────

export type ReadinessMode = "morning" | "eod";

export function computeReadiness(d: ReadinessData, mode: ReadinessMode = "eod"): ReadinessResult {
  const factors: ReadinessFactor[] = [];
  const isMorning = mode === "morning";
  let weightedSum = 0;
  const TOTAL_WEIGHT = 1.0;

  // ── Phase 1: Core factors (fixed-weight average) ──

  // Sleep Quality (34%) — primary recovery indicator
  if (d.sleepScore == null) {
    // Missing sleep = assume moderate-poor
    weightedSum += 30 * 0.34;
    factors.push({
      label: "Sleep Quality",
      status: "poor",
      detail: "Not synced",
    });
  } else {
    const s = d.sleepScore;
    // Aggressive curve: scores below 70 get hammered
    const adjustedSleep = s >= 80 ? s : s >= 60 ? s * 0.75 : s * 0.55;
    weightedSum += adjustedSleep * 0.34;
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
      detail: `${Math.round(dp)}% of sleep · ${dp < 10 ? "Critically low" : dp < 13 ? "Low" : "Healthy"}`,
    });
  } else {
    weightedSum += 25 * 0.15; // missing = assume poor but not catastrophic
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

  // HRV vs baseline (23%)
  if (d.hrv != null && d.hrvBaseline != null) {
    const diff = d.hrv - d.hrvBaseline;
    const pct = d.hrvBaseline > 0 ? (diff / d.hrvBaseline) * 100 : 0;
    const hrvScore = pct >= 10 ? 90 : pct >= 0 ? 75 : pct >= -10 ? 55 : pct >= -20 ? 35 : 15;
    weightedSum += hrvScore * 0.23;
    factors.push({
      label: "HRV",
      status: pct >= -5 ? "good" : pct >= -15 ? "warning" : "poor",
      detail: `${Math.round(d.hrv)} ms (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs avg)`,
    });
  } else {
    weightedSum += 25 * 0.23; // missing HRV = moderate penalty
    factors.push({ label: "HRV", status: "poor", detail: "No data" });
  }

  // Yesterday's Load — intensity-weighted (16%)
  if (d.yesterdayLoad != null) {
    const l = d.yesterdayLoad;
    const loadScore = l <= 15 ? 85 : l <= 40 ? 70 : l <= 80 ? 45 : l <= 140 ? 25 : 10;
    weightedSum += loadScore * 0.16;
    factors.push({
      label: "Yesterday's Load",
      status: l <= 40 ? "good" : l <= 80 ? "warning" : "poor",
      detail: `${Math.floor(l / 60)}:${String(Math.round(l % 60)).padStart(2, "0")} training`,
    });
  } else {
    weightedSum += 50 * 0.16; // rest day = decent
  }

  // Normalise to 0-100 with fixed denominator
  let baseScore = weightedSum / TOTAL_WEIGHT;

  // ── Phase 2: Modifiers (additive) ──

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

  // Body battery drain (replaces old circadian modifier)
  const battery = bodyBatteryDrain(d);

  // Apply modifiers
  let totalAdj = battery.drain;
  for (const m of modifiers) {
    totalAdj += m.adj;
  }

  // Add body battery drain as a visible factor (Charged & Drained framing)
  if (battery.hoursAwake > 0.5) {
    const drainTotal = battery.passiveDrain + battery.activeDrain;
    const charged = Math.round(baseScore) + battery.passiveCharge;
    const chargeNote = battery.passiveCharge > 0 ? ` (+${battery.passiveCharge} rest)` : "";
    factors.push({
      label: "Body Battery",
      status: drainTotal - battery.passiveCharge <= 15 ? "good" : drainTotal - battery.passiveCharge <= 30 ? "warning" : "poor",
      detail: `⚡${charged} charged${chargeNote} · 🔋-${drainTotal} drained (${battery.hoursAwake}h awake)`,
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
