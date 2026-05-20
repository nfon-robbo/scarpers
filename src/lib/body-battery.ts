/**
 * Body Battery — phone-battery model (0–100% energy reserve).
 *
 * Charges overnight from sleep quality. Drains while awake at an
 * accelerating rate, and faster during activities. Single source of
 * truth shared by the client (readiness.ts), the hourly snapshot
 * edge function, and the 48h visualisation.
 */

export interface SleepInputs {
  sleepScore: number | null;     // 0-100 (composite quality)
  sleepHours: number | null;     // total hours slept
  deepPct: number | null;        // 0-100 (% of sleep that was deep)
  remPct?: number | null;        // 0-100 (optional)
  hrv: number | null;
  hrvBaseline: number | null;
  recentSleepAvgHours: number | null;   // 3-night avg
  baselineSleepAvgHours: number | null; // 30-day avg
}

export interface ActivitySpan {
  startIso: string;
  durationSec: number;
  intensityLoad: number; // intensity-weighted minutes (same units as readiness)
}

export type BatteryStatus = "Charged" | "Steady" | "Low" | "Drained";

export interface BodyBatteryResult {
  percent: number;          // 0-100, integer
  startPercent: number;     // 0-100, integer (charge on wake)
  drainAwake: number;       // integer pts lost to passive awake
  drainActive: number;      // integer pts lost to activities
  hoursAwake: number;       // rounded to 1dp
  status: BatteryStatus;
  insight: string;          // short contextual sentence
}

/** Passive drain rate (pts/hour) as a function of how long the user has been awake. */
export function passiveDrainRate(hoursAwake: number): number {
  if (hoursAwake <= 4) return 3;
  if (hoursAwake <= 8) return 4;
  if (hoursAwake <= 12) return 5;
  return 6;
}

/** Total points drained passively across `hoursAwake` hours, integrating the rate. */
export function totalPassiveDrain(hoursAwake: number): number {
  let total = 0;
  let h = 0;
  while (h < hoursAwake) {
    const slice = Math.min(1, hoursAwake - h);
    total += passiveDrainRate(h) * slice;
    h += slice;
  }
  return total;
}

/** Per-activity battery cost (uncapped). intensityLoad is intensity-weighted minutes. */
export function activityDrain(intensityLoad: number): number {
  return Math.max(0, intensityLoad) * 0.05;
}

/** Compute the starting battery on wake, based on last night's sleep. 10–100. */
export function initialBatteryFromSleep(s: SleepInputs): number {
  let charge = 45; // baseline

  // Duration (up to +40)
  if (s.sleepHours != null) {
    const h = s.sleepHours;
    let dur: number;
    if (h <= 0) dur = 0;
    else if (h < 7) dur = (h / 7) * 40;
    else if (h <= 9) dur = 40;                       // full plateau
    else if (h <= 10) dur = 40 - (h - 9) * 3;        // gentle taper
    else dur = Math.max(25, 37 - (h - 10) * 2);      // too much sleep ≠ great
    charge += dur;
  } else if (s.sleepScore != null) {
    // Fall back to sleep score if duration missing
    charge += (s.sleepScore / 100) * 35;
  }

  // Stage quality (up to +20)
  if (s.deepPct != null) {
    const dp = s.deepPct;
    const deepPts = dp >= 15 ? 12 : dp >= 12 ? 9 : dp >= 10 ? 6 : dp >= 7 ? 3 : 0;
    charge += deepPts;
  }
  if (s.remPct != null) {
    const rp = s.remPct;
    const remPts = rp >= 20 ? 8 : rp >= 15 ? 5 : rp >= 10 ? 2 : 0;
    charge += remPts;
  } else if (s.deepPct == null && s.sleepScore != null) {
    // No stage data — partial credit from composite score
    charge += (s.sleepScore / 100) * 10;
  }

  // HRV vs baseline (±10)
  if (s.hrv != null && s.hrvBaseline != null && s.hrvBaseline > 0) {
    const pct = ((s.hrv - s.hrvBaseline) / s.hrvBaseline) * 100;
    let hrvAdj: number;
    if (pct >= 10) hrvAdj = 10;
    else if (pct >= 5) hrvAdj = 7;
    else if (pct >= -5) hrvAdj = 0;
    else if (pct >= -15) hrvAdj = -6;
    else hrvAdj = -10;
    charge += hrvAdj;
  }

  // Sleep debt (±5)
  if (s.recentSleepAvgHours != null && s.baselineSleepAvgHours != null && s.baselineSleepAvgHours > 0) {
    const debt = s.recentSleepAvgHours - s.baselineSleepAvgHours;
    if (debt <= -1) charge -= 5;
    else if (debt <= -0.3) charge -= 3;
    else if (debt >= 0.5) charge += 3;
  }

  return Math.round(Math.max(10, Math.min(100, charge)));
}

function statusFor(percent: number): BatteryStatus {
  if (percent >= 70) return "Charged";
  if (percent >= 40) return "Steady";
  if (percent >= 20) return "Low";
  return "Drained";
}

function insightFor(percent: number, hoursAwake: number, drainActive: number): string {
  if (percent >= 75) return "Strong reserve — green light for a quality session.";
  if (percent >= 55) {
    if (drainActive >= 10) return "Recovering well after today's effort.";
    return "Plenty in the tank — moderate work is fine.";
  }
  if (percent >= 35) {
    if (hoursAwake >= 12) return "Long day showing — keep tonight easy.";
    if (drainActive >= 15) return "Workout drained you — easy evening recommended.";
    return "Energy is dipping — listen to your body.";
  }
  if (percent >= 20) return "Reserves are low — prioritise rest and food.";
  return "Empty tank — rest, refuel, and get to bed early.";
}

export function computeBodyBattery(opts: {
  sleep: SleepInputs;
  wakeTimeIso: string | null;
  todayActivities: ActivitySpan[];
  now?: number;
}): BodyBatteryResult {
  const now = opts.now ?? Date.now();

  // Wake time fallback: 7am today
  let wakeMs: number;
  if (opts.wakeTimeIso) {
    wakeMs = new Date(opts.wakeTimeIso).getTime();
  } else {
    const t = new Date(now);
    t.setHours(7, 0, 0, 0);
    wakeMs = t.getTime();
  }
  const hoursAwake = Math.max(0, Math.min(20, (now - wakeMs) / 3600000));

  const startPercent = initialBatteryFromSleep(opts.sleep);
  const passive = totalPassiveDrain(hoursAwake);

  let active = 0;
  for (const a of opts.todayActivities) {
    const aStart = new Date(a.startIso).getTime();
    if (!isFinite(aStart) || aStart > now) continue;
    active += activityDrain(a.intensityLoad);
  }

  const ambient = hoursAwake * 0.5;
  const rawPercent = startPercent - passive - active - ambient;
  const percent = Math.round(Math.max(0, Math.min(100, rawPercent)));
  const drainAwake = Math.round(passive);
  const drainActive = Math.round(active + ambient);

  return {
    percent,
    startPercent,
    drainAwake,
    drainActive,
    hoursAwake: Math.round(hoursAwake * 10) / 10,
    status: statusFor(percent),
    insight: insightFor(percent, hoursAwake, active),
  };
}
