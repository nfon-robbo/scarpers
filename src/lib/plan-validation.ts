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

// ─────────────────────────────────────────────────────────────────────────────
// Auto-recompute session totals from the segment table.
// The AI often gets `(Total: Nmin)` in the session heading wrong (estimates
// instead of summing). This walks each `### **Day…**` block, parses every
// table row's Duration cell (including `N x M min` and `N x M min / R min walk`
// repeats), sums them, and rewrites the heading total. This guarantees the
// derived label and the heading agree, on every write path.
// ─────────────────────────────────────────────────────────────────────────────

const parseDurSecs = (text: string): number => {
  const cleaned = text.replace(/[()]/g, " ").trim();
  const colon = cleaned.match(/(\d{1,3}):(\d{2})/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const hour = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)s?\b/i);
  const min = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:m|min|minute)s?\b/i);
  const sec = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|second)s?\b/i);
  let total = 0;
  if (hour) total += parseFloat(hour[1]) * 3600;
  if (min) total += parseFloat(min[1]) * 60;
  if (sec) total += parseFloat(sec[1]);
  return Math.round(total);
};

const parseSegmentSeconds = (cell: string): number => {
  const c = cell.replace(/×/g, "x");
  const repeat = c.match(/(\d+)\s*x\s*(.+)$/i);
  if (repeat) {
    const reps = parseInt(repeat[1], 10);
    const [workPart, restPart] = repeat[2].split(/\s*\/\s*/);
    const w = parseDurSecs(workPart || "");
    const r = parseDurSecs(restPart || "");
    if (reps && w) return reps * (w + r);
  }
  return parseDurSecs(c);
};

export interface TotalCorrection {
  day: string;
  from: number;
  to: number;
}

export function recomputeSessionTotals(markdown: string): {
  content: string;
  corrections: TotalCorrection[];
} {
  if (!markdown) return { content: markdown, corrections: [] };
  const lines = markdown.split("\n");
  const corrections: TotalCorrection[] = [];

  let dayIdx = -1;
  let dayLabel = "";
  let daySecs = 0;

  const flush = () => {
    if (dayIdx < 0 || daySecs <= 0) return;
    const heading = lines[dayIdx];
    const m = heading.match(/\(Total:\s*(\d+)\s*min\)/i);
    const newTotal = Math.round(daySecs / 60);
    if (m) {
      const cur = parseInt(m[1], 10);
      if (cur !== newTotal) {
        lines[dayIdx] = heading.replace(/\(Total:\s*\d+\s*min\)/i, `(Total: ${newTotal}min)`);
        corrections.push({ day: dayLabel, from: cur, to: newTotal });
      }
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^###\s+\*\*([^*]+)\*\*/);
    if (h) {
      flush();
      dayIdx = i;
      dayLabel = h[1].trim();
      daySecs = 0;
      continue;
    }
    // 5-col table row: | Segment | Duration | ... | ... |
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!row) continue;
    const seg = row[1];
    const dur = row[2];
    if (/^segment$/i.test(seg) || /^[-:\s]+$/.test(seg)) continue;
    if (/mobility|stretch|foam|yoga/i.test(seg)) continue;
    const secs = parseSegmentSeconds(dur);
    if (secs > 0) daySecs += secs;
  }
  flush();
  return { content: lines.join("\n"), corrections };
}

export function recomputeAndLog(markdown: string, source: string): { content: string; corrections: TotalCorrection[] } {
  const result = recomputeSessionTotals(markdown);
  for (const c of result.corrections) {
    console.warn(
      `[plan-validation] ${source}: recomputed Total on ${c.day} from ${c.from} min → ${c.to} min (sum of segments)`
    );
  }
  return result;
}
