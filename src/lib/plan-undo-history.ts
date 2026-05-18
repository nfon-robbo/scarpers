// Ctrl+Z-style undo/redo stacks for training plan edits.
// Each entry is a previous snapshot of `training_plans.content`, scoped per plan id.
// Stored in localStorage so it survives reloads.

const KEY = (planId: string) => `plan-undo-stack:${planId}`;
const REDO_KEY = (planId: string) => `plan-redo-stack:${planId}`;
const MAX_ENTRIES = 50;

export interface UndoEntry {
  prevContent: string;
  /** When set, the entry also restores `training_plans.race_date`. */
  prevRaceDate?: string | null;
  label: string;       // e.g. "17/06/2026 session" or "full plan rewrite"
  timestamp: number;
}

function read(key: string): UndoEntry[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(planId: string, key: string, stack: UndoEntry[]) {
  try {
    localStorage.setItem(key, JSON.stringify(stack.slice(-MAX_ENTRIES)));
    window.dispatchEvent(new CustomEvent("plan-undo-changed", { detail: { planId } }));
  } catch {
    // ignore quota errors
  }
}

function clearRedo(planId: string) {
  try {
    localStorage.removeItem(REDO_KEY(planId));
    window.dispatchEvent(new CustomEvent("plan-undo-changed", { detail: { planId } }));
  } catch {
    // ignore
  }
}

export function pushUndoEntry(
  planId: string,
  prevContent: string,
  label: string,
  opts?: { prevRaceDate?: string | null; preserveRedo?: boolean },
) {
  if (!planId || typeof prevContent !== "string") return;
  const stack = read(KEY(planId));
  // Skip duplicate consecutive entries.
  if (stack.length > 0 && stack[stack.length - 1].prevContent === prevContent) return;
  const entry: UndoEntry = { prevContent, label, timestamp: Date.now() };
  if (opts && "prevRaceDate" in opts) entry.prevRaceDate = opts.prevRaceDate ?? null;
  stack.push(entry);
  write(planId, KEY(planId), stack);
  // Any fresh edit invalidates the redo stack — unless explicitly preserved
  // (e.g. when a redo operation pushes the swapped-out state back onto undo).
  if (!opts?.preserveRedo) clearRedo(planId);
}

export function popUndoEntry(planId: string): UndoEntry | null {
  const stack = read(KEY(planId));
  const entry = stack.pop();
  if (!entry) return null;
  write(planId, KEY(planId), stack);
  return entry;
}

export function getUndoCount(planId: string): number {
  return read(KEY(planId)).length;
}

export function peekUndoEntry(planId: string): UndoEntry | null {
  const stack = read(KEY(planId));
  return stack.length > 0 ? stack[stack.length - 1] : null;
}

export function clearUndoHistory(planId: string) {
  try {
    localStorage.removeItem(KEY(planId));
    localStorage.removeItem(REDO_KEY(planId));
    window.dispatchEvent(new CustomEvent("plan-undo-changed", { detail: { planId } }));
  } catch {
    // ignore
  }
}

// ---------- Redo ----------

export function pushRedoEntry(
  planId: string,
  prevContent: string,
  label: string,
  opts?: { prevRaceDate?: string | null },
) {
  if (!planId || typeof prevContent !== "string") return;
  const stack = read(REDO_KEY(planId));
  if (stack.length > 0 && stack[stack.length - 1].prevContent === prevContent) return;
  const entry: UndoEntry = { prevContent, label, timestamp: Date.now() };
  if (opts && "prevRaceDate" in opts) entry.prevRaceDate = opts.prevRaceDate ?? null;
  stack.push(entry);
  write(planId, REDO_KEY(planId), stack);
}

export function popRedoEntry(planId: string): UndoEntry | null {
  const stack = read(REDO_KEY(planId));
  const entry = stack.pop();
  if (!entry) return null;
  write(planId, REDO_KEY(planId), stack);
  return entry;
}

export function getRedoCount(planId: string): number {
  return read(REDO_KEY(planId)).length;
}

export function peekRedoEntry(planId: string): UndoEntry | null {
  const stack = read(REDO_KEY(planId));
  return stack.length > 0 ? stack[stack.length - 1] : null;
}
