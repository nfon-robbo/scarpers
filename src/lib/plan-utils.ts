/**
 * Plan date utilities shared between TrainingPlan and the pause/resume flow.
 *
 * Markdown plans use DD/MM/YYYY in bold day headers and a "**RACE DAY ... DD/MM/YYYY**"
 * marker. These helpers shift those dates without re-parsing the rest of the markdown.
 */

const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/g;

function parseDmy(d: string, mo: string, y: string): Date | null {
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  return isNaN(date.getTime()) ? null : date;
}

function formatDmy(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${date.getFullYear()}`;
}

export type PauseRaceDateMode = "fixed" | "shift";

export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseIsoDateLocal(value: string | null | undefined): Date | null {
  if (!value || value === "ai-recommend") return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  const parsed = new Date(y, (m || 1) - 1, d || 1);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfLocalDayMs(value: Date): number {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function isPauseActive(pausedUntil: Date | null | undefined, mode: string | null | undefined, today = new Date()): boolean {
  return !!pausedUntil && !!mode && startOfLocalDayMs(pausedUntil) > startOfLocalDayMs(today);
}

export function isPauseReadyToResume(pausedUntil: Date | null | undefined, mode: string | null | undefined, today = new Date()): boolean {
  return !!pausedUntil && !!mode && startOfLocalDayMs(pausedUntil) <= startOfLocalDayMs(today);
}

export function pauseResumeDeltaDays(pausedAt: Date, pausedUntil: Date, today = new Date()): number {
  const targetMs = Math.max(startOfLocalDayMs(pausedUntil), startOfLocalDayMs(today));
  return Math.max(0, Math.round((targetMs - startOfLocalDayMs(pausedAt)) / 86_400_000));
}

export function resumePlanAfterPause(params: {
  content: string;
  pausedAt: Date;
  deltaDays: number;
  raceDateIso?: string | null;
  raceDateMode?: PauseRaceDateMode | string | null;
}): { content: string; raceDateIso: string | null; trimmedDays: number } {
  const fromIso = toLocalISODate(params.pausedAt);
  let content = params.deltaDays > 0 ? shiftPlanDatesFrom(params.content, fromIso, params.deltaDays) : params.content;
  let raceDateIso = params.raceDateIso && params.raceDateIso !== "ai-recommend" ? params.raceDateIso : null;
  let trimmedDays = 0;

  if (params.deltaDays > 0 && params.raceDateMode === "fixed" && raceDateIso) {
    const trimResult = trimPlanAfterRaceDate(content, raceDateIso);
    content = trimResult.content;
    trimmedDays = trimResult.trimmedDays;
  } else if (params.deltaDays > 0 && params.raceDateMode === "shift" && raceDateIso) {
    const raceDate = parseIsoDateLocal(raceDateIso);
    if (raceDate) {
      raceDate.setDate(raceDate.getDate() + params.deltaDays);
      raceDateIso = toLocalISODate(raceDate);
    }
  }

  return { content, raceDateIso, trimmedDays };
}

/** Shift every DD/MM/YYYY in the markdown by deltaDays (positive or negative). */
export function shiftPlanDates(markdown: string, deltaDays: number): string {
  if (!deltaDays) return markdown;
  return markdown.replace(DATE_RE, (m, d, mo, y) => {
    const date = parseDmy(d, mo, y);
    if (!date) return m;
    date.setDate(date.getDate() + deltaDays);
    return formatDmy(date);
  });
}

/**
 * Shift only DD/MM/YYYY dates that are on or after `fromIso` (YYYY-MM-DD).
 * Used when resuming from a pause — earlier weeks stay put, later weeks slide.
 */
export function shiftPlanDatesFrom(markdown: string, fromIso: string, deltaDays: number): string {
  if (!deltaDays) return markdown;
  const [fy, fmo, fd] = fromIso.split("-").map(Number);
  const fromDate = new Date(fy, (fmo || 1) - 1, fd || 1);
  if (isNaN(fromDate.getTime())) return markdown;
  const fromMs = fromDate.getTime();
  return markdown.replace(DATE_RE, (m, d, mo, y) => {
    const date = parseDmy(d, mo, y);
    if (!date) return m;
    if (date.getTime() < fromMs) return m;
    date.setDate(date.getDate() + deltaDays);
    return formatDmy(date);
  });
}

/**
 * For a FIXED race date, drop bold-headed day blocks whose date is past raceIso.
 * Returns markdown with the trimmed sections removed and a count of trimmed days.
 */
export function trimPlanAfterRaceDate(markdown: string, raceIso: string): { content: string; trimmedDays: number } {
  const [ry, rmo, rd] = raceIso.split("-").map(Number);
  const raceDate = new Date(ry, (rmo || 1) - 1, rd || 1);
  if (isNaN(raceDate.getTime())) return { content: markdown, trimmedDays: 0 };
  const raceMs = raceDate.getTime();

  const lines = markdown.split("\n");
  const out: string[] = [];
  let i = 0;
  let trimmed = 0;
  const headerRe = /^\s*\*\*[^*]*\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b[^*]*\*\*\s*$/;

  while (i < lines.length) {
    const ln = lines[i];
    const m = ln.match(headerRe);
    if (m) {
      const date = parseDmy(m[1], m[2], m[3]);
      // Keep race day itself; drop strictly-after dates
      const isRaceDay = /race\s*day/i.test(ln);
      if (date && date.getTime() > raceMs && !isRaceDay) {
        // Skip this block until the next bold-date header or section heading
        trimmed += 1;
        i += 1;
        while (i < lines.length) {
          const peek = lines[i];
          if (headerRe.test(peek)) break;
          if (/^\s*##?\s/.test(peek)) break;
          i += 1;
        }
        continue;
      }
    }
    out.push(ln);
    i += 1;
  }
  // Collapse 3+ blank lines
  return { content: out.join("\n").replace(/\n{3,}/g, "\n\n"), trimmedDays: trimmed };
}

/**
 * Phase-1 "intelligent resume point" for a fixed race date.
 * Given the week the user paused in, weeks remaining to race, and total plan weeks,
 * return the week number to resume at (1-based). Simple heuristic; can be replaced
 * with a workout-criticality model in a later phase.
 */
export function intelligentResumePoint(currentWeek: number, weeksRemaining: number, totalWeeks: number): number {
  if (weeksRemaining <= 1) return totalWeeks; // jump to race week
  if (totalWeeks <= 0) return Math.max(1, currentWeek);

  // Treat last 2 weeks as taper
  const taperStart = Math.max(1, totalWeeks - 1);
  if (currentWeek >= taperStart) return taperStart;

  // Recovery weeks (every 4th) — resume on the recovery week itself if close
  if (currentWeek <= 3) return Math.min(4, totalWeeks);
  if (currentWeek === 4) return 5;

  // Speed / race-pace phase (mid-plan) — keep them where they are if they still fit
  return Math.min(totalWeeks, Math.max(currentWeek, totalWeeks - weeksRemaining + 1));
}
