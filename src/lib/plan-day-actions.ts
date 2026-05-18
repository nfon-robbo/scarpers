/**
 * Deterministic single-day plan edits used by the in-chat "adjust this
 * session" buttons (Skip / Move to tomorrow / Replace with recovery).
 *
 * These run client-side against the plan markdown so the user knows exactly
 * what will happen before they tap. No AI rewrite is involved.
 */

import { parseWorkoutsFromPlan } from "@/lib/plan-export";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toUk = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

function getHeadingPrefix(rawText: string): string {
  const m = rawText.split("\n")[0].match(/^(#{1,6}\s+)/);
  return m ? m[1] : "### ";
}

/** Rewrites a heading line's weekday + DD/MM/YYYY in place. */
function rewriteHeadingDate(firstLine: string, newDate: Date): string {
  const ukOld = firstLine.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
  if (!ukOld) return firstLine;
  let line = firstLine.replace(ukOld[1], toUk(newDate));
  const dayName = DAY_NAMES[newDate.getDay()];
  line = line.replace(
    /(\*\*[^*]*?)(Sun|Mon|Tues?|Wed(?:nes)?|Thur?s?|Fri|Sat)[a-z]*([^*]*\d{1,2}\/\d{1,2}\/\d{4})/i,
    `$1${dayName}$3`,
  );
  return line;
}

function makeRestBlock(date: Date, prefix: string, reason: string): string {
  const dayName = DAY_NAMES[date.getDay()];
  return `${prefix}**${dayName} ${toUk(date)}** — Rest Day (${reason})\n\n`;
}

function makeRecoveryWalkBlock(date: Date, prefix: string): string {
  const dayName = DAY_NAMES[date.getDay()];
  return (
    `${prefix}**${dayName} ${toUk(date)}** — Recovery Walk (Total: 20min)\n\n` +
    `| Segment | Duration | Target | HR Zone | Notes |\n` +
    `|---------|----------|--------|---------|-------|\n` +
    `| Walk | 20 min | very easy | Z1 | 🎵 150 BPM; low-stress recovery to preserve the training day |\n\n`
  );
}

export interface DayActionResult {
  updatedPlan: string;
  summary: string;
}

function locateTargetBlock(planContent: string, dateUk: string) {
  const m = dateUk.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const workouts = parseWorkoutsFromPlan(planContent);
  const target = workouts.find((w) => w.dateObj && toIso(w.dateObj) === iso);
  if (!target?.rawText || !target.dateObj) return null;
  const idx = planContent.indexOf(target.rawText);
  if (idx === -1) return null;
  return { target, idx, iso, dateObj: target.dateObj, workouts };
}

export function applySkipSession(planContent: string, dateUk: string): DayActionResult | null {
  const loc = locateTargetBlock(planContent, dateUk);
  if (!loc) return null;
  const prefix = getHeadingPrefix(loc.target.rawText!);
  const rest = makeRestBlock(loc.dateObj, prefix, "session skipped");
  const updated =
    planContent.slice(0, loc.idx) + rest + planContent.slice(loc.idx + loc.target.rawText!.length);
  return { updatedPlan: updated, summary: `Session on ${dateUk} skipped — that day is now a rest day.` };
}

export function applyReplaceWithRecovery(planContent: string, dateUk: string): DayActionResult | null {
  const loc = locateTargetBlock(planContent, dateUk);
  if (!loc) return null;
  const prefix = getHeadingPrefix(loc.target.rawText!);
  const recovery = makeRecoveryWalkBlock(loc.dateObj, prefix);
  const updated =
    planContent.slice(0, loc.idx) + recovery + planContent.slice(loc.idx + loc.target.rawText!.length);
  return {
    updatedPlan: updated,
    summary: `Session on ${dateUk} replaced with a 20-minute very easy Z1 walk.`,
  };
}

export function applyMoveToTomorrow(planContent: string, dateUk: string): DayActionResult | null {
  const loc = locateTargetBlock(planContent, dateUk);
  if (!loc) return null;

  // Chain = consecutive scheduled workouts starting at the target date.
  // We stop at the first day that has no workout block (= rest day) and
  // shift every block in the chain forward by one day, restoring a rest day
  // at the very end of the chain (the previously-rest day absorbs the shift).
  const chain = [loc.target];
  let cursor = loc.dateObj;
  while (true) {
    const nextDay = addDays(cursor, 1);
    const nextIso = toIso(nextDay);
    const found = loc.workouts.find(
      (w) => w !== loc.target && w.dateObj && toIso(w.dateObj) === nextIso,
    );
    if (!found?.rawText) break;
    chain.push(found);
    cursor = nextDay;
  }

  const lastBlock = chain[chain.length - 1];
  const startIdx = loc.idx;
  const endIdx = planContent.indexOf(lastBlock.rawText!) + lastBlock.rawText!.length;
  if (endIdx <= startIdx) return null;

  const prefix = getHeadingPrefix(loc.target.rawText!);
  let replacement = makeRestBlock(loc.dateObj, prefix, "session moved to tomorrow");
  for (const block of chain) {
    const lines = block.rawText!.split("\n");
    const newDate = addDays(block.dateObj!, 1);
    lines[0] = rewriteHeadingDate(lines[0], newDate);
    let blockText = lines.join("\n");
    if (!blockText.endsWith("\n")) blockText += "\n";
    if (!blockText.endsWith("\n\n")) blockText += "\n";
    replacement += blockText;
  }

  const updated = planContent.slice(0, startIdx) + replacement + planContent.slice(endIdx);
  const movedTo = addDays(loc.dateObj, 1);
  const movedDayName = DAY_NAMES[movedTo.getDay()];
  const extra =
    chain.length > 1
      ? ` (${chain.length - 1} subsequent session${chain.length - 1 === 1 ? "" : "s"} also shifted by one day)`
      : "";
  return {
    updatedPlan: updated,
    summary: `Session moved to ${movedDayName} ${toUk(movedTo)}${extra}.`,
  };
}
