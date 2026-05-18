/**
 * Deterministic single-day plan edits used by the in-chat "adjust this
 * session" buttons (Skip / Move / Replace with recovery).
 *
 * These run client-side against the plan markdown so the user knows exactly
 * what will happen before they tap. No AI rewrite is involved.
 */

import { parseWorkoutsFromPlan } from "@/lib/plan-export";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const toUk = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
};

/** Human label for the move button — e.g. "tomorrow" or "Wednesday 20 May". */
export function formatMoveTargetLabel(source: Date, target: Date): string {
  const tomorrow = addDays(source, 1);
  if (toIso(target) === toIso(tomorrow)) return "tomorrow";
  return `${DAY_NAMES[target.getDay()]} ${target.getDate()} ${SHORT_MONTHS[target.getMonth()]}`;
}

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

/**
 * The date the "Move" action will move the session TO.
 *
 * Logic: the next existing scheduled workout day strictly after `dateUk`.
 * If there isn't one (no future workouts in the plan), we fall back to
 * the literal next calendar day so we always have something to show.
 *
 * This matches what the user sees in the button label and what the action
 * performs — they always refer to the same date.
 */
export function getMoveTargetDate(planContent: string, dateUk: string): Date | null {
  const loc = locateTargetBlock(planContent, dateUk);
  if (!loc) return null;
  const future = loc.workouts
    .filter((w) => w !== loc.target && w.dateObj && toIso(w.dateObj) > loc.iso)
    .sort((a, b) => toIso(a.dateObj!).localeCompare(toIso(b.dateObj!)));
  return future[0]?.dateObj ?? addDays(loc.dateObj, 1);
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

/**
 * Move the session at `dateUk` to the next existing training day.
 *
 * - Inserts a Rest Day at the original date.
 * - If the target date currently has no workout (e.g. the plan ended), we
 *   simply place the moved block right after the rest at the original date.
 * - If the target date has a workout, we shift the target's consecutive
 *   workout chain forward by one day to make room, then insert the moved
 *   session at the target's original position.
 */
export function applyMoveSession(planContent: string, dateUk: string): DayActionResult | null {
  const loc = locateTargetBlock(planContent, dateUk);
  if (!loc) return null;

  const futureWorkouts = loc.workouts
    .filter((w) => w !== loc.target && w.dateObj && toIso(w.dateObj) > loc.iso)
    .sort((a, b) => toIso(a.dateObj!).localeCompare(toIso(b.dateObj!)));

  const targetDate = futureWorkouts[0]?.dateObj ?? addDays(loc.dateObj, 1);
  const prefix = getHeadingPrefix(loc.target.rawText!);

  // Build the moved session block, rewriting its heading date.
  const movedLines = loc.target.rawText!.split("\n");
  movedLines[0] = rewriteHeadingDate(movedLines[0], targetDate);
  let movedBlock = movedLines.join("\n");
  if (!movedBlock.endsWith("\n")) movedBlock += "\n";
  if (!movedBlock.endsWith("\n\n")) movedBlock += "\n";

  const restAtOriginal = makeRestBlock(loc.dateObj, prefix, "session moved");
  const movedToLabel = `${DAY_NAMES[targetDate.getDay()]} ${toUk(targetDate)}`;

  // Case A: target date has no existing workout — just drop the moved block
  // in after the rest at the original position.
  if (!futureWorkouts[0]) {
    const updated =
      planContent.slice(0, loc.idx) +
      restAtOriginal +
      movedBlock +
      planContent.slice(loc.idx + loc.target.rawText!.length);
    return { updatedPlan: updated, summary: `Session moved to ${movedToLabel}.` };
  }

  // Case B: target date has a workout — shift its consecutive chain by +1 day.
  const chain = [futureWorkouts[0]];
  let cursor = futureWorkouts[0].dateObj!;
  while (true) {
    const next = addDays(cursor, 1);
    const found = loc.workouts.find((w) => w.dateObj && toIso(w.dateObj) === toIso(next));
    if (!found?.rawText) break;
    chain.push(found);
    cursor = next;
  }

  let shiftedChain = "";
  for (const block of chain) {
    const lines = block.rawText!.split("\n");
    const newDate = addDays(block.dateObj!, 1);
    lines[0] = rewriteHeadingDate(lines[0], newDate);
    let text = lines.join("\n");
    if (!text.endsWith("\n")) text += "\n";
    if (!text.endsWith("\n\n")) text += "\n";
    shiftedChain += text;
  }

  const chainStartIdx = planContent.indexOf(chain[0].rawText!);
  const lastBlock = chain[chain.length - 1];
  const chainEndIdx = planContent.indexOf(lastBlock.rawText!) + lastBlock.rawText!.length;
  if (chainStartIdx <= loc.idx || chainEndIdx <= chainStartIdx) return null;

  const before = planContent.slice(0, loc.idx);
  const between = planContent.slice(loc.idx + loc.target.rawText!.length, chainStartIdx);
  const after = planContent.slice(chainEndIdx);

  const updated = before + restAtOriginal + between + movedBlock + shiftedChain + after;
  const extra =
    chain.length > 0
      ? ` (${chain.length} subsequent session${chain.length === 1 ? "" : "s"} shifted by one day)`
      : "";
  return { updatedPlan: updated, summary: `Session moved to ${movedToLabel}${extra}.` };
}

/** @deprecated Use applyMoveSession — kept for backwards compatibility. */
export const applyMoveToTomorrow = applyMoveSession;
