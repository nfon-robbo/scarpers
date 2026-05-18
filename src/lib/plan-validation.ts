// Enforces minimum warm-up and cool-down durations on every running session.
// If the AI generated a Warm-up or Cool-down row shorter than the minimum,
// it's bumped up to the minimum and the day's "(Total: Nmin)" heading is
// adjusted by the same delta. Returns a list of corrections for logging.

export interface PlanCorrection {
  day: string;
  segment: "Warm-up" | "Cool-down";
  from: number;
  to: number;
}

export interface PlanValidationResult {
  content: string;
  corrections: PlanCorrection[];
}

const MIN_WARMUP_MINUTES = 5;
const MIN_COOLDOWN_MINUTES = 5;

/**
 * Scan plan markdown for `Warm-up` / `Cool-down` table rows under the minimum
 * duration and bump them to the minimum, also patching the day's Total.
 */
export function enforceWarmupCooldownMinimums(markdown: string): PlanValidationResult {
  if (!markdown) return { content: markdown, corrections: [] };

  const lines = markdown.split("\n");
  const corrections: PlanCorrection[] = [];

  let dayHeadingIdx = -1;
  let dayLabel = "";
  let dayDelta = 0;

  const flushDay = () => {
    if (dayHeadingIdx >= 0 && dayDelta !== 0) {
      const heading = lines[dayHeadingIdx];
      const patched = heading.replace(/\(Total:\s*(\d+)\s*min\)/i, (_m, n) => {
        const newTotal = parseInt(n, 10) + dayDelta;
        return `(Total: ${newTotal}min)`;
      });
      lines[dayHeadingIdx] = patched;
    }
    dayDelta = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Day heading: "### **Friday 15/05/2026** — Easy run (Total: 30min)"
    const headingMatch = line.match(/^###\s+\*\*([^*]+)\*\*/);
    if (headingMatch) {
      flushDay();
      dayHeadingIdx = i;
      dayLabel = headingMatch[1].trim();
      continue;
    }

    // Warm-up / Cool-down row in a 5-col table
    const segMatch = line.match(/^\|\s*(Warm-up|Cool-down)\s*\|\s*([^|]+)\|/i);
    if (!segMatch) continue;

    const segment = (segMatch[1].toLowerCase().startsWith("warm") ? "Warm-up" : "Cool-down") as
      | "Warm-up"
      | "Cool-down";
    const durCell = segMatch[2];
    const numMatch = durCell.match(/(\d+)\s*min/i);
    if (!numMatch) continue;

    const cur = parseInt(numMatch[1], 10);
    const min = segment === "Warm-up" ? MIN_WARMUP_MINUTES : MIN_COOLDOWN_MINUTES;
    if (cur >= min) continue;

    const newDurCell = durCell.replace(/(\d+)(\s*min)/i, `${min}$2`);
    lines[i] = line.replace(durCell, newDurCell);
    dayDelta += min - cur;
    corrections.push({ day: dayLabel, segment, from: cur, to: min });
  }

  flushDay();
  return { content: lines.join("\n"), corrections };
}

/**
 * Convenience wrapper that also logs each correction to the console so there's
 * an audit trail of what the guardrail changed and why.
 */
export function enforceAndLog(markdown: string, source: string): PlanValidationResult {
  const result = enforceWarmupCooldownMinimums(markdown);
  for (const c of result.corrections) {
    console.warn(
      `[plan-validation] ${source}: bumped ${c.segment} on ${c.day} from ${c.from} min → ${c.to} min (minimum 5)`
    );
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Race-day reachability checks. Mirrors the server-side logic in
// supabase/functions/ai-coach/index.ts so client and server stay in sync.
// Used by savePlan() to guarantee no plan is ever written to
// training_plans.content without an entry for the stored race_date.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the LATEST ISO date (YYYY-MM-DD) found in the plan markdown,
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
 *  When raceDateIso is null/empty/"ai-recommend", validation is skipped. */
export function validatePlanReachesRaceDay(content: string, raceDateIso: string | null | undefined): boolean {
  if (!raceDateIso || raceDateIso === "ai-recommend") return true;
  const last = lastIsoDate(content);
  if (!last || last < raceDateIso) return false;
  return hasRaceDayEntry(content, raceDateIso);
}
