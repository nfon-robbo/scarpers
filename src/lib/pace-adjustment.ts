/**
 * Cross-plan pace adjustment.
 *
 * When a runner says "that pace was too slow", we recommend a new pace (AI,
 * with a deterministic benchmark-based fallback) and then apply it across the
 * plan:
 *
 *   - Only FUTURE dated sessions (>= the reference date).
 *   - Only rows of the SAME session type (easy stays with easy, tempo with
 *     tempo, ...).
 *   - Only rows whose slower (upper) bound is at or slower than the new pace —
 *     anything already faster is left alone.
 *   - Never warm-up / cool-down / walk / mobility rows, never race day,
 *     never past or completed sessions.
 *
 * Everything here is pure: callers get `{ newContent, changes }` and decide
 * whether to persist.
 */

import { parseWorkoutsFromPlan, type ParsedWorkout } from "@/lib/plan-export";
import { paceRangeFromThreshold, type SessionPaceCategory } from "@/lib/benchmark-calculations";

export type SessionType = SessionPaceCategory;

const CATEGORY_KEYWORDS: Array<{ re: RegExp; category: SessionType }> = [
  { re: /\b(vo\s*2\s*max|vo2)\b/i, category: "vo2" },
  { re: /\b(rep|reps|repetition|repetitions|r-pace|stride)\b/i, category: "rep" },
  { re: /\b(cv|cruise|critical\s*velocity|10k)\b/i, category: "cv" },
  { re: /\b(threshold|tempo|lt|lactate)\b/i, category: "threshold" },
  { re: /\b(marathon|race\s*pace|mp)\b/i, category: "marathon" },
  { re: /\b(steady|moderate|progression)\b/i, category: "steady" },
  { re: /\b(easy|recovery|long\s*run|jog|z2|zone\s*2)\b/i, category: "easy" },
];

export const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  easy: "Easy / recovery",
  steady: "Steady",
  marathon: "Race pace",
  threshold: "Threshold / tempo",
  cv: "Cruise / 10k",
  rep: "Reps / strides",
  vo2: "VO2 max",
};

const PACE_RE = /(\d{1,2}):(\d{2})(?:\s*[-–]\s*(\d{1,2}):(\d{2}))?\s*(?:\/|per\s*)\s*km/i;
const PACE_RE_G = /(\d{1,2}):(\d{2})(?:\s*[-–]\s*(\d{1,2}):(\d{2}))?\s*(?:\/|per\s*)\s*km/gi;

export interface PaceRange {
  minSec: number; // faster bound
  maxSec: number; // slower bound
  raw: string;
}

export function parsePaceRange(text: string): PaceRange | null {
  if (!text) return null;
  const m = text.match(PACE_RE);
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = m[3] ? Number(m[3]) * 60 + Number(m[4]) : a;
  return { minSec: Math.min(a, b), maxSec: Math.max(a, b), raw: m[0].trim() };
}

export function fmtPaceSec(sec: number): string {
  const t = Math.max(60, Math.round(sec));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export function formatPaceRange(minSec: number, maxSec: number): string {
  return minSec === maxSec
    ? `${fmtPaceSec(minSec)}/km`
    : `${fmtPaceSec(minSec)}-${fmtPaceSec(maxSec)}/km`;
}

/** Accepts "8:30", "8:30-8:50", "8:30-8:50/km". Returns a normalised range. */
export function parseUserPaceInput(input: string): PaceRange | null {
  const s = (input || "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):([0-5]\d)(?:\s*[-–]\s*(\d{1,2}):([0-5]\d))?\s*(?:\/\s*km)?$/);
  if (!m) return null;
  const a = Number(m[1]) * 60 + Number(m[2]);
  const b = m[3] ? Number(m[3]) * 60 + Number(m[4]) : a;
  if (a < 120 || a > 1200 || b < 120 || b > 1200) return null;
  return { minSec: Math.min(a, b), maxSec: Math.max(a, b), raw: formatPaceRange(Math.min(a, b), Math.max(a, b)) };
}

/** Rows that must never carry (or receive) a pace. */
export function isNonPacedRow(segmentCell: string): boolean {
  const s = (segmentCell || "").toLowerCase();
  if (/warm|cool/.test(s)) return true;
  if (/mobility|stretch|foam|yoga|rest|drill/.test(s)) return true;
  if (/^walk/.test(s) && !/run|interval|main|rep/.test(s)) return true;
  return false;
}

export function isRaceDay(title: string): boolean {
  return /\brace\s*day\b|\bgoal\s*race\b|\brace:\b/i.test(title || "");
}

export function classifySessionType(text: string): SessionType | null {
  for (const { re, category } of CATEGORY_KEYWORDS) {
    if (re.test(text || "")) return category;
  }
  return null;
}

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export interface PaceContext {
  dateUk: string;
  iso: string;
  title: string;
  sessionType: SessionType;
  currentPace: PaceRange;
}

/**
 * Look up the paced session on a given day so a trigger (chat, review popup,
 * workout screen) can open the dialog pre-filled. Returns null when the day
 * has no paced running row.
 */
export function getPaceContextForDate(planContent: string, dateUk: string): PaceContext | null {
  const m = (dateUk || "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const w = parseWorkoutsFromPlan(planContent).find((x) => x.dateObj && toIso(x.dateObj) === iso);
  if (!w) return null;
  return paceContextForWorkout(w, iso);
}

export function paceContextForWorkout(w: ParsedWorkout, iso?: string): PaceContext | null {
  const isoDate = iso ?? (w.dateObj ? toIso(w.dateObj) : "");
  const titleType = classifySessionType(w.title);
  for (const seg of w.segments) {
    if (isNonPacedRow(seg.segment)) continue;
    const pace = parsePaceRange(seg.target || "");
    if (!pace) continue;
    const type =
      classifySessionType(`${seg.segment} ${seg.target} ${seg.notes ?? ""}`) ?? titleType ?? "easy";
    return {
      dateUk: w.date,
      iso: isoDate,
      title: w.title,
      sessionType: type,
      currentPace: pace,
    };
  }
  return null;
}

export interface PaceChangeRow {
  iso: string;
  dateUk: string;
  title: string;
  segment: string;
  before: string;
  after: string;
}

export interface PacePreview {
  newContent: string;
  changes: PaceChangeRow[];
  /** Future same-type sessions that were left alone because they're already faster. */
  skippedFaster: number;
}

export interface PacePreviewOptions {
  /** Sessions on or after this ISO date are eligible. */
  fromIso: string;
  sessionType: SessionType;
  /** New pace, e.g. "8:30-8:50/km". */
  newPace: string;
  /** Dates that are already completed and must never change. */
  completedIso?: Set<string>;
}

/**
 * Pure preview + rewrite of the plan markdown.
 */
export function planPaceChangePreview(
  planContent: string,
  opts: PacePreviewOptions,
): PacePreview {
  const target = parsePaceRange(opts.newPace);
  if (!planContent || !target) {
    return { newContent: planContent ?? "", changes: [], skippedFaster: 0 };
  }
  const newText = formatPaceRange(target.minSec, target.maxSec);

  const workouts = parseWorkoutsFromPlan(planContent);
  let out = planContent;
  let cursor = 0;
  const changes: PaceChangeRow[] = [];
  let skippedFaster = 0;

  for (const w of workouts) {
    if (!w.rawText || !w.dateObj) continue;
    const iso = toIso(w.dateObj);
    if (iso < opts.fromIso) continue;
    if (opts.completedIso?.has(iso)) continue;
    if (isRaceDay(w.title)) continue;

    const idx = out.indexOf(w.rawText, cursor);
    if (idx === -1) continue;

    const titleType = classifySessionType(w.title);
    const rowChanges: PaceChangeRow[] = [];
    let touchedFasterOnly = false;

    const rewritten = w.rawText
      .split("\n")
      .map((line) => {
        if (!line.trim().startsWith("|")) return line;
        const cells = line.split("|");
        const segmentCell = (cells[1] ?? "").trim();
        if (!segmentCell || /^-+$/.test(segmentCell) || /^segment$/i.test(segmentCell)) return line;
        if (isNonPacedRow(segmentCell)) return line;
        const existing = parsePaceRange(line);
        if (!existing) return line;
        const rowType =
          classifySessionType(`${segmentCell} ${cells.slice(2).join(" ")}`) ?? titleType;
        if (rowType !== opts.sessionType) return line;
        // Only change sessions at the same pace or slower than the new pace.
        if (existing.maxSec < target.maxSec) {
          touchedFasterOnly = true;
          return line;
        }
        if (existing.minSec === target.minSec && existing.maxSec === target.maxSec) return line;
        rowChanges.push({
          iso,
          dateUk: w.date,
          title: w.title,
          segment: segmentCell,
          before: existing.raw,
          after: newText,
        });
        return line.replace(PACE_RE_G, newText);
      })
      .join("\n");

    if (touchedFasterOnly && rowChanges.length === 0) skippedFaster += 1;
    if (rowChanges.length === 0) {
      cursor = idx + w.rawText.length;
      continue;
    }
    out = out.slice(0, idx) + rewritten + out.slice(idx + w.rawText.length);
    cursor = idx + rewritten.length;
    changes.push(...rowChanges);
  }

  return { newContent: out, changes, skippedFaster };
}

/**
 * Deterministic fallback recommendation, used when the AI call fails.
 *
 * With a measured threshold we anchor to the benchmark-derived range for that
 * session type; otherwise we simply take 5% off the current pace. Either way
 * the result is capped at 10% faster than the current pace so a single piece
 * of feedback can't produce a reckless jump.
 */
export function recommendPaceDeterministic(
  current: PaceRange,
  sessionType: SessionType,
  thresholdSecPerKm?: number | null,
): { pace: string; rationale: string } {
  const capMin = current.minSec * 0.9;
  const capMax = current.maxSec * 0.9;

  if (thresholdSecPerKm && thresholdSecPerKm > 120) {
    const r = paceRangeFromThreshold(thresholdSecPerKm, sessionType);
    const minSec = Math.max(r.minSecPerKm, capMin);
    const maxSec = Math.max(r.maxSecPerKm, capMax);
    if (maxSec < current.maxSec) {
      return {
        pace: formatPaceRange(minSec, maxSec),
        rationale: `Anchored to your measured threshold pace for ${SESSION_TYPE_LABEL[sessionType].toLowerCase()} running, capped at 10% faster than your current target.`,
      };
    }
  }

  const minSec = Math.max(current.minSec * 0.95, capMin);
  const maxSec = Math.max(current.maxSec * 0.95, capMax);
  return {
    pace: formatPaceRange(minSec, maxSec),
    rationale: "A 5% step down from your current target — enough to feel better without a risky jump.",
  };
}

/** How much faster (as a fraction) `candidate` is than `current`. */
export function speedUpFraction(current: PaceRange, candidate: PaceRange): number {
  if (!current.maxSec) return 0;
  return (current.maxSec - candidate.maxSec) / current.maxSec;
}
