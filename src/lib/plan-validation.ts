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
