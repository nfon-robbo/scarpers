// Client-side helpers that mirror the edge function's race-day detection.
// Used by savePlan() to guarantee no plan is ever written to
// training_plans.content without an entry for the stored race_date.

/** Returns the last ISO date (YYYY-MM-DD) found in the plan markdown,
 *  accepting both ISO and UK (DD/MM/YYYY) date formats. */
export function lastIsoDate(txt: string): string | null {
  const matches = [...txt.matchAll(/\b(?:(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])|([0-3]?\d)\/(0?\d)\/(20\d{2}))\b/g)];
  if (!matches.length) return null;
  let best: string | null = null;
  for (const m of matches) {
    let iso: string;
    if (m[1] && m[2] && m[3]) iso = `${m[1]}-${m[2]}-${m[3]}`;
    else {
      const dd = String(m[4]).padStart(2, "0");
      const mm = String(m[5]).padStart(2, "0");
      iso = `${m[6]}-${mm}-${dd}`;
    }
    if (!best || iso > best) best = iso;
  }
  return best;
}

/** Returns true if the plan contains a "race day" line referencing the
 *  target race date (in either ISO or UK form). */
export function hasRaceDayEntry(txt: string, targetIso: string): boolean {
  const [y, m, d] = targetIso.split("-");
  const targetUk = `${d}/${m}/${y}`;
  const lines = txt.split("\n").filter((line) => /race\s*day/i.test(line));
  return lines.some((line) => line.includes(targetIso) || line.includes(targetUk));
}

/** Returns true when the plan reaches race day on the stored race_date.
 *  When raceDateIso is null/empty, validation is skipped (returns true). */
export function validatePlanReachesRaceDay(content: string, raceDateIso: string | null | undefined): boolean {
  if (!raceDateIso || raceDateIso === "ai-recommend") return true;
  const last = lastIsoDate(content);
  if (!last || last < raceDateIso) return false;
  return hasRaceDayEntry(content, raceDateIso);
}
