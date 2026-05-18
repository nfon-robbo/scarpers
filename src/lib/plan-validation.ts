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

// ─────────────────────────────────────────────────────────────────────────────
// Day-block helpers. A "day block" is the lines from `### **Day DD/MM/YYYY**`
// (exclusive of higher-level `##` or `---`-only) up to the next `###` heading.
// ─────────────────────────────────────────────────────────────────────────────

interface DayBlock {
  startLine: number; // index of the `### **...**` line
  endLine: number;   // exclusive
  date: string;      // DD/MM/YYYY (or "" if non-dated)
  weekday: string;   // Monday/Tuesday/...
  heading: string;   // full heading line
}

const WEEKDAY_LIST = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const WEEKDAY_SHORT: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};

const MARKDOWN_DAY_HEADING_RE = /^###\s+\*\*([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\*\*/;
const PLAIN_DAY_HEADING_RE = /^([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[—–-]|:)\s*\S+/;

function matchDayHeading(line: string): { weekday: string; date: string; markdown: boolean } | null {
  const markdown = line.match(MARKDOWN_DAY_HEADING_RE);
  if (markdown) return { weekday: markdown[1], date: markdown[2], markdown: true };
  const plain = line.match(PLAIN_DAY_HEADING_RE);
  if (plain) return { weekday: plain[1], date: plain[2], markdown: false };
  return null;
}

function findDayBlocks(lines: string[]): DayBlock[] {
  const blocks: DayBlock[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = matchDayHeading(lines[i]);
    if (!m) continue;
    // Find next markdown section heading or plain date heading.
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^##\s+/.test(lines[j]) || matchDayHeading(lines[j])) { end = j; break; }
    }
    blocks.push({ startLine: i, endLine: end, date: m.date, weekday: m.weekday, heading: lines[i] });
  }
  return blocks;
}

function normaliseDate(dmy: string): string {
  const [d, m, y] = dmy.split("/");
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 1 — No duplicate dates. Keep the first occurrence, drop subsequent ones.
// Also strips back-to-back duplicate `### **WEEK N: …**` headings that share
// the same "Week of DD/MM – DD/MM" sub-line.
// ─────────────────────────────────────────────────────────────────────────────
export interface DedupeCorrection { kind: "date" | "week" | "plain-date-line"; label: string; }

export function dedupeDates(markdown: string): { content: string; corrections: DedupeCorrection[] } {
  if (!markdown) return { content: markdown, corrections: [] };
  let lines = markdown.split("\n");
  const corrections: DedupeCorrection[] = [];

  // Pass 0: collapse consecutive lines that start with the same
  // `Weekday DD/MM/YYYY` date — regardless of markdown heading syntax or
  // plain text format. Catches "Monday 18/05/2026 — Rest Day" appearing
  // immediately after the same line (markdown or plain), and mixed pairs.
  const dateStartRe = /^\s*(?:#{1,6}\s+)?\**\s*([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/;
  const dateKey = (line: string): string | null => {
    const m = line.match(dateStartRe);
    if (!m) return null;
    return `${m[1].toLowerCase()} ${m[2]}`;
  };
  const collapsed: string[] = [];
  let prevDateKey: string | null = null;
  let prevDateLine = "";
  for (const line of lines) {
    const key = dateKey(line);
    if (key && key === prevDateKey && line.trim() === prevDateLine.trim()) {
      corrections.push({ kind: "plain-date-line", label: line.trim() });
      continue;
    }
    if (key) { prevDateKey = key; prevDateLine = line; }
    else if (line.trim() !== "") { prevDateKey = null; prevDateLine = ""; }
    collapsed.push(line);
  }
  lines = collapsed;

  // Pass 1: drop duplicate `### **WEEK N: …**` headings sharing the same
  // immediate `*Week of …*` sub-line (handles 3× WEEK 2 case).
  const dropMask = new Array<boolean>(lines.length).fill(false);
  const seenWeekRanges = new Set<string>();
  let currentMarkdownDate = "";
  const seenPlainLines = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const markdownDay = lines[i].match(MARKDOWN_DAY_HEADING_RE);
    if (markdownDay) {
      currentMarkdownDate = markdownDay[2];
      seenPlainLines.clear();
      continue;
    }
    if (/^##\s+/.test(lines[i])) {
      currentMarkdownDate = "";
      seenPlainLines.clear();
    }

    const plainDay = lines[i].match(PLAIN_DAY_HEADING_RE);
    if (plainDay) {
      const label = `${plainDay[1]} ${plainDay[2]}`;
      const key = lines[i].trim().replace(/\s+/g, " ");
      if (plainDay[2] === currentMarkdownDate || seenPlainLines.has(key)) {
        dropMask[i] = true;
        corrections.push({ kind: "plain-date-line", label });
        continue;
      }
      seenPlainLines.add(key);
    }

    const wh = lines[i].match(/^###\s+\*\*WEEK\s+\d+/i);
    if (!wh) continue;
    // Peek next non-blank line for `*Week of …*`
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const sub = lines[j]?.match(/^\*Week of\s+(.+?)\*\s*$/i);
    if (!sub) continue;
    const key = sub[1].trim();
    if (seenWeekRanges.has(key)) {
      // Drop this heading + the sub line + a trailing blank/--- if present.
      dropMask[i] = true;
      dropMask[j] = true;
      let k = j + 1;
      while (k < lines.length && (lines[k].trim() === "" || lines[k].trim() === "---")) {
        dropMask[k] = true; k++;
        if (lines[k - 1].trim() === "---") break;
      }
      corrections.push({ kind: "week", label: `WEEK heading for "${key}"` });
    } else {
      seenWeekRanges.add(key);
    }
  }

  // Pass 2: drop subsequent day-blocks sharing the same date.
  // (Operate on the post-pass-1 view via dropMask so deleted weeks don't
  // interfere with block boundaries.)
  const liveLines = lines.map((l, i) => (dropMask[i] ? null : l));
  const compact = liveLines.filter((l): l is string => l !== null);
  const indexMap: number[] = []; // compact index -> original index
  for (let i = 0; i < lines.length; i++) if (!dropMask[i]) indexMap.push(i);
  const blocks = findDayBlocks(compact);
  const seenDates = new Set<string>();
  for (const b of blocks) {
    if (seenDates.has(b.date)) {
      // Drop original-indexed range [b.startLine, b.endLine) of compact -> mark drop
      const startOrig = indexMap[b.startLine];
      const endOrigExclusive = b.endLine < indexMap.length ? indexMap[b.endLine] : lines.length;
      for (let k = startOrig; k < endOrigExclusive; k++) dropMask[k] = true;
      corrections.push({ kind: "date", label: `${b.weekday} ${b.date}` });
    } else {
      seenDates.add(b.date);
    }
  }

  const out = lines.filter((_, i) => !dropMask[i]).join("\n");
  return { content: out, corrections };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 2 — Every running session with a "main set" / interval row must have a
// Warm-up row first and a Cool-down row last. Inject 5-min defaults if missing.
// ─────────────────────────────────────────────────────────────────────────────
export interface WCCorrection { day: string; added: ("Warm-up" | "Cool-down")[]; }

const MAIN_ROW_RE = /\|\s*(Main\s*Set|Interval(?:\s*Set)?|Threshold|Tempo|Steady|VO2|Hill|Fartlek|Strides|Long\s*Run|Race\s*Pace|Race|Easy\s*Run|Cruise|Sharpening|Repeats?|Reps?|Pre-?Race)\b/i;
const WU_RE = /^\|\s*Warm-?up\s*\|/i;
const CD_RE = /^\|\s*Cool-?down\s*\|/i;
const RACE_DAY_RE = /race\s*day/i;
const REST_DAY_RE = /rest\s*day/i;

export function enforceWarmupCooldown(markdown: string): { content: string; corrections: WCCorrection[] } {
  if (!markdown) return { content: markdown, corrections: [] };
  const lines = markdown.split("\n");
  const corrections: WCCorrection[] = [];
  const blocks = findDayBlocks(lines);

  // Walk blocks in reverse so line insertions don't shift earlier indices.
  for (let bi = blocks.length - 1; bi >= 0; bi--) {
    const b = blocks[bi];
    const heading = lines[b.startLine];
    if (RACE_DAY_RE.test(heading) || REST_DAY_RE.test(heading)) continue;

    // Locate the segment table inside the block.
    let firstRowIdx = -1, lastRowIdx = -1, hasMain = false;
    for (let i = b.startLine + 1; i < b.endLine; i++) {
      const ln = lines[i];
      if (!/^\|/.test(ln)) continue;
      // Skip header + separator rows
      if (/^\|\s*Segment\s*\|/i.test(ln)) continue;
      if (/^\|\s*[-:\s|]+\|\s*$/.test(ln)) continue;
      if (firstRowIdx === -1) firstRowIdx = i;
      lastRowIdx = i;
      if (MAIN_ROW_RE.test(ln)) hasMain = true;
    }
    if (firstRowIdx === -1 || !hasMain) continue;

    const hasWU = WU_RE.test(lines[firstRowIdx]);
    const hasCD = CD_RE.test(lines[lastRowIdx]);
    if (hasWU && hasCD) continue;

    const added: ("Warm-up" | "Cool-down")[] = [];
    let addedMins = 0;
    if (!hasCD) {
      lines.splice(lastRowIdx + 1, 0, "| Cool-down | 5 min | Walk | 🎵 150 BPM |");
      added.push("Cool-down");
      addedMins += 5;
    }
    if (!hasWU) {
      lines.splice(firstRowIdx, 0, "| Warm-up | 5 min | Easy walk | 🎵 150 BPM |");
      added.push("Warm-up");
      addedMins += 5;
    }
    // Bump heading Total by addedMins.
    if (addedMins > 0) {
      lines[b.startLine] = lines[b.startLine].replace(/\(Total:\s*(\d+)\s*min\)/i, (_m, n) =>
        `(Total: ${parseInt(n, 10) + addedMins}min)`
      );
    }
    corrections.push({ day: `${b.weekday} ${b.date}`, added });
  }
  return { content: lines.join("\n"), corrections };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 3 — Sessions only on scheduled training days. Drop any session on a
// non-scheduled weekday unless it's a rest day or race day.
// ─────────────────────────────────────────────────────────────────────────────
export interface DayScheduleCorrection { day: string; reason: string; }

/** Compute the canonical weekday name for a DD/MM/YYYY date string.
 *  Uses UTC to avoid timezone drift. Returns "" on parse failure. */
function weekdayFromDate(dmy: string): string {
  const [d, m, y] = dmy.split("/").map((s) => parseInt(s, 10));
  if (!d || !m || !y) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return "";
  // getUTCDay: Sun=0..Sat=6 → remap to Mon=0..Sun=6 then index into WEEKDAY_LIST.
  return WEEKDAY_LIST[(dt.getUTCDay() + 6) % 7];
}

export function enforceScheduledDays(
  markdown: string,
  trainingDays: string[] | null | undefined,
): { content: string; corrections: DayScheduleCorrection[] } {
  if (!markdown || !trainingDays?.length) return { content: markdown, corrections: [] };
  const allowed = new Set<string>(
    trainingDays.map((d) => WEEKDAY_SHORT[d] || (WEEKDAY_LIST.includes(d) ? d : "")).filter(Boolean)
  );
  if (!allowed.size) return { content: markdown, corrections: [] };

  const lines = markdown.split("\n");
  const blocks = findDayBlocks(lines);
  const corrections: DayScheduleCorrection[] = [];
  const dropMask = new Array<boolean>(lines.length).fill(false);

  for (const b of blocks) {
    const isRest = REST_DAY_RE.test(b.heading);
    const isRace = RACE_DAY_RE.test(b.heading);
    // Trust the *actual* calendar weekday, not the label — the AI sometimes
    // mislabels (e.g. "Wednesday 14/05/2026" when 14/05/2026 is a Thursday).
    const actual = weekdayFromDate(b.date) || b.weekday;
    if (allowed.has(actual)) continue;
    if (isRest || isRace) continue;
    for (let k = b.startLine; k < b.endLine; k++) dropMask[k] = true;
    const reason = actual !== b.weekday
      ? `label says ${b.weekday} but ${b.date} is ${actual}; not in scheduled days (${[...allowed].join(",")})`
      : `not in scheduled days (${[...allowed].join(",")})`;
    corrections.push({ day: `${b.weekday} ${b.date}`, reason });
  }
  const out = lines.filter((_, i) => !dropMask[i]).join("\n");
  return { content: out, corrections };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public combined wrapper. Order matters:
//   dedupe → schedule → warm-up/cool-down inject → warm-up min ≥5 → totals
// ─────────────────────────────────────────────────────────────────────────────
export interface ValidatePlanOptions {
  trainingDays?: string[] | null;
  source?: string;
}

export interface ValidatePlanResult {
  content: string;
  corrections: {
    dedupes: DedupeCorrection[];
    scheduleDrops: DayScheduleCorrection[];
    warmupsAdded: WCCorrection[];
    warmupBumps: PlanCorrection[];
    totalsRecomputed: TotalCorrection[];
  };
}

export function validatePlanForSave(markdown: string, opts: ValidatePlanOptions = {}): ValidatePlanResult {
  const source = opts.source || "plan-save";
  let content = markdown;

  const d = dedupeDates(content);
  content = d.content;
  for (const c of d.corrections) {
    console.warn(`[plan-validation] ${source}: dropped duplicate ${c.kind} → ${c.label}`);
  }

  const s = enforceScheduledDays(content, opts.trainingDays);
  content = s.content;
  for (const c of s.corrections) {
    console.warn(`[plan-validation] ${source}: removed off-schedule session ${c.day} (${c.reason})`);
  }

  const wc = enforceWarmupCooldown(content);
  content = wc.content;
  for (const c of wc.corrections) {
    console.warn(`[plan-validation] ${source}: added ${c.added.join("+")} to ${c.day}`);
  }

  const wu = enforceAndLog(content, source);
  content = wu.content;

  const totals = recomputeAndLog(content, source);
  content = totals.content;

  return {
    content,
    corrections: {
      dedupes: d.corrections,
      scheduleDrops: s.corrections,
      warmupsAdded: wc.corrections,
      warmupBumps: wu.corrections,
      totalsRecomputed: totals.corrections,
    },
  };
}
