// Ctrl+Z-style undo stack for training plan edits.
// Each entry is a previous snapshot of `training_plans.content`, scoped per plan id.
// Stored in localStorage so it survives reloads.

const KEY = (planId: string) => `plan-undo-stack:${planId}`;
const MAX_ENTRIES = 50;

export interface UndoEntry {
  prevContent: string;
  /** When set, the entry also restores `training_plans.race_date`. */
  prevRaceDate?: string | null;
  label: string;       // e.g. "17/06/2026 session" or "full plan rewrite"
  timestamp: number;
}

function read(planId: string): UndoEntry[] {
  try {
    const raw = localStorage.getItem(KEY(planId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(planId: string, stack: UndoEntry[]) {
  try {
    localStorage.setItem(KEY(planId), JSON.stringify(stack.slice(-MAX_ENTRIES)));
    window.dispatchEvent(new CustomEvent("plan-undo-changed", { detail: { planId } }));
  } catch {
    // ignore quota errors
  }
}

export function pushUndoEntry(
  planId: string,
  prevContent: string,
  label: string,
  opts?: { prevRaceDate?: string | null },
) {
  if (!planId || typeof prevContent !== "string") return;
  const stack = read(planId);
  // Skip duplicate consecutive entries.
  if (stack.length > 0 && stack[stack.length - 1].prevContent === prevContent) return;
  const entry: UndoEntry = { prevContent, label, timestamp: Date.now() };
  if (opts && "prevRaceDate" in opts) entry.prevRaceDate = opts.prevRaceDate ?? null;
  stack.push(entry);
  write(planId, stack);
}

export function popUndoEntry(planId: string): UndoEntry | null {
  const stack = read(planId);
  const entry = stack.pop();
  if (!entry) return null;
  write(planId, stack);
  return entry;
}

export function getUndoCount(planId: string): number {
  return read(planId).length;
}

export function peekUndoEntry(planId: string): UndoEntry | null {
  const stack = read(planId);
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function clearUndoHistory(planId: string) {
  try {
    localStorage.removeItem(KEY(planId));
    window.dispatchEvent(new CustomEvent("plan-undo-changed", { detail: { planId } }));
  } catch {
    // ignore
  }
}
