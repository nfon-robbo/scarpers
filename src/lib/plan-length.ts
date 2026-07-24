// Sensible plan-length caps and defaults by race distance.
// Users kept getting 20-week 5K plans because the plan length is just
// (race_date - start_date). We cap it here and pre-fill a default race
// date so short races can't produce marathon-length plans.

export type RaceDistanceKey = "5k" | "10k" | "half-marathon" | "marathon";

/** Hard upper bound on plan length (weeks) per race distance. */
export const MAX_PLAN_WEEKS: Record<RaceDistanceKey, number> = {
  "5k": 10,
  "10k": 14,
  "half-marathon": 18,
  "marathon": 24,
};

/** Default plan length (weeks) when no race date is set. */
export const DEFAULT_PLAN_WEEKS: Record<RaceDistanceKey, number> = {
  "5k": 8,
  "10k": 10,
  "half-marathon": 14,
  "marathon": 18,
};

export function maxWeeksForDistance(d: string | null | undefined): number {
  const k = (d || "").toLowerCase() as RaceDistanceKey;
  return MAX_PLAN_WEEKS[k] ?? 20;
}

export function defaultWeeksForDistance(d: string | null | undefined): number {
  const k = (d || "").toLowerCase() as RaceDistanceKey;
  return DEFAULT_PLAN_WEEKS[k] ?? 12;
}

export function addWeeks(base: Date, weeks: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

export function weeksBetween(startISO: string, endISO: string): number {
  const s = new Date(startISO + "T00:00:00").getTime();
  const e = new Date(endISO + "T00:00:00").getTime();
  return Math.max(1, Math.round((e - s) / (7 * 86_400_000)));
}
