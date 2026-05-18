// Pure helpers to compute "Plan Stats" from the existing plan markdown
// and the linkedActivities map already loaded on the Training Plan page.
// No network calls, no extra database reads.

import { parseWorkoutsFromPlan, type ParsedWorkout } from "@/lib/plan-export";

export interface PlanStats {
  totalSessions: number;        // non-rest scheduled sessions in the whole plan
  scheduledToDate: number;      // non-rest sessions whose date <= today
  completedToDate: number;      // of those, count that have a linked activity meeting threshold
  adherencePct: number;         // completedToDate / scheduledToDate * 100 (0 if denom 0)
  sessionsRemaining: number;    // non-rest sessions with date > today (and <= race date if present)
  daysToRace: number | null;    // calendar days from today to raceDate (null if no race date)
  plannedKm: number;            // sum of planned km across scheduledToDate sessions that quote km
  actualKm: number;             // sum of linked-activity distance for those same sessions
  plannedMinutes: number;       // sum of planned minutes across scheduledToDate sessions that quote minutes only
  actualMinutes: number;        // sum of linked-activity duration for those same sessions
  hasKmTargets: boolean;
  hasMinuteTargets: boolean;
  currentStreak: number;        // consecutive completed non-rest past sessions, counting back from latest past session
}

const COMPLETED_MIN_DISTANCE_M = 500;
const COMPLETED_MIN_DURATION_S = 60;

function isRest(w: ParsedWorkout): boolean {
  if (!w.segments || w.segments.length === 0) return true;
  return /\brest\b/i.test(w.title);
}

// Returns { km, minutes } extracted from a workout's title or rawText.
// Prefers explicit "Total: X km" / "Total: X min". Returns 0 when missing.
function plannedVolume(w: ParsedWorkout): { km: number; minutes: number } {
  const text = `${w.title}\n${w.rawText || ""}`;
  let km = 0;
  let minutes = 0;
  const kmMatch = text.match(/Total:\s*~?\s*([\d.]+)\s*k(?:m|ilo)/i);
  if (kmMatch) km = parseFloat(kmMatch[1]) || 0;
  const minMatch = text.match(/Total:\s*~?\s*(\d+(?:\.\d+)?)\s*min/i);
  if (minMatch) minutes = parseFloat(minMatch[1]) || 0;
  return { km, minutes };
}

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function activityIsCompletion(act: any): boolean {
  if (!act) return false;
  const dist = Number(act.distance_meters || 0);
  const dur = Number(act.duration_seconds || 0);
  return dist >= COMPLETED_MIN_DISTANCE_M && dur >= COMPLETED_MIN_DURATION_S;
}

export function computePlanStats(
  planContent: string | null | undefined,
  linkedActivities: Record<string, any>,
  raceDateIso: string | null | undefined,
  today: Date = new Date(),
): PlanStats {
  const empty: PlanStats = {
    totalSessions: 0,
    scheduledToDate: 0,
    completedToDate: 0,
    adherencePct: 0,
    sessionsRemaining: 0,
    daysToRace: null,
    plannedKm: 0,
    actualKm: 0,
    plannedMinutes: 0,
    actualMinutes: 0,
    hasKmTargets: false,
    hasMinuteTargets: false,
    currentStreak: 0,
  };
  if (!planContent) return empty;

  const todayIso = toIsoLocal(today);
  const workouts = parseWorkoutsFromPlan(planContent)
    .filter((w) => w.dateObj)
    .sort((a, b) => a.dateObj!.getTime() - b.dateObj!.getTime());

  const nonRest = workouts.filter((w) => !isRest(w));
  const totalSessions = nonRest.length;

  const past = nonRest.filter((w) => toIsoLocal(w.dateObj!) <= todayIso);
  const future = nonRest.filter((w) => toIsoLocal(w.dateObj!) > todayIso);

  let completedToDate = 0;
  let plannedKm = 0;
  let actualKm = 0;
  let plannedMinutes = 0;
  let actualMinutes = 0;
  let hasKmTargets = false;
  let hasMinuteTargets = false;

  for (const w of past) {
    const dateKey = toIsoLocal(w.dateObj!);
    const act = linkedActivities[dateKey];
    const completed = activityIsCompletion(act);
    if (completed) completedToDate += 1;

    const { km, minutes } = plannedVolume(w);
    if (km > 0) {
      hasKmTargets = true;
      plannedKm += km;
      if (act) actualKm += Number(act.distance_meters || 0) / 1000;
    } else if (minutes > 0) {
      hasMinuteTargets = true;
      plannedMinutes += minutes;
      if (act) actualMinutes += Number(act.duration_seconds || 0) / 60;
    }
  }

  // Sessions remaining: future non-rest sessions, optionally bounded by race date.
  let remaining = future.length;
  let daysToRace: number | null = null;
  if (raceDateIso) {
    const [ry, rm, rd] = raceDateIso.split("-").map(Number);
    if (ry && rm && rd) {
      const race = new Date(ry, rm - 1, rd);
      const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      daysToRace = Math.round((race.getTime() - t0.getTime()) / (1000 * 60 * 60 * 24));
      remaining = future.filter((w) => toIsoLocal(w.dateObj!) <= raceDateIso).length;
    }
  }

  // Current streak: walk past sessions from most recent backwards, counting
  // consecutive completions. Stops at the first miss.
  let currentStreak = 0;
  for (let i = past.length - 1; i >= 0; i--) {
    const dateKey = toIsoLocal(past[i].dateObj!);
    if (activityIsCompletion(linkedActivities[dateKey])) currentStreak += 1;
    else break;
  }

  const adherencePct = past.length > 0
    ? Math.round((completedToDate / past.length) * 100)
    : 0;

  return {
    totalSessions,
    scheduledToDate: past.length,
    completedToDate,
    adherencePct,
    sessionsRemaining: remaining,
    daysToRace,
    plannedKm: Math.round(plannedKm * 10) / 10,
    actualKm: Math.round(actualKm * 10) / 10,
    plannedMinutes: Math.round(plannedMinutes),
    actualMinutes: Math.round(actualMinutes),
    hasKmTargets,
    hasMinuteTargets,
    currentStreak,
  };
}
