// Evaluates whether the active training plan should be auto-adapted based on
// recent readiness + Running IQ trends.
//
// Returns:
//   { direction: "down", reason } — readiness < THRESH_DOWN for 2+ consecutive days
//   { direction: "up",   reason } — readiness >= THRESH_UP AND Running IQ trending
//                                   positive for 3+ consecutive days
//   { direction: null }           — no action
//
// Both windows require ACTUAL readings for every day in the window — missing/null
// data short-circuits to null (no adaptation).

import { supabase } from "@/integrations/supabase/client";

export const READINESS_DOWN_THRESHOLD = 55;
export const READINESS_UP_THRESHOLD = 80;
export const DOWN_DAYS = 2;
export const UP_DAYS = 3;

export type AdaptDirection = "down" | "up" | null;

export interface AdaptEvaluation {
  direction: AdaptDirection;
  reason: string;
  detail?: string;
}

interface DailyScore {
  date: string; // yyyy-mm-dd
  score: number;
}

/**
 * Reduce snapshots to one score per local-day (most recent recording wins).
 */
function reduceDaily(rows: Array<{ recorded_at: string; score: number | null }>): Map<string, number> {
  const byDate = new Map<string, { score: number; ts: number }>();
  for (const r of rows) {
    if (r.score == null || !Number.isFinite(r.score)) continue;
    const d = new Date(r.recorded_at);
    const key = d.toISOString().slice(0, 10);
    const ts = d.getTime();
    const prev = byDate.get(key);
    if (!prev || ts > prev.ts) byDate.set(key, { score: r.score, ts });
  }
  const out = new Map<string, number>();
  for (const [k, v] of byDate) out.set(k, v.score);
  return out;
}

/**
 * Count how many of the six core readiness factors are using missing-data
 * defaults in the given factors array. A factor counts as "default" when it's
 * either absent from the array, or its detail explicitly indicates missing
 * data ("Not synced", "No data", "no baseline").
 */
const CORE_FACTOR_LABELS = [
  "Sleep Quality",
  "Deep Sleep",
  "HRV",
  "Resting HR",
  "Yesterday's Load",
  "Stress",
] as const;

export function countMissingCoreFactors(factors: unknown): number {
  const list = Array.isArray(factors) ? (factors as Array<{ label?: string; detail?: string }>) : [];
  const byLabel = new Map<string, string>();
  for (const f of list) {
    if (f && typeof f.label === "string") byLabel.set(f.label, String(f.detail ?? ""));
  }
  let missing = 0;
  for (const label of CORE_FACTOR_LABELS) {
    if (!byLabel.has(label)) {
      missing += 1;
      continue;
    }
    const detail = byLabel.get(label)!.toLowerCase();
    if (
      detail.includes("not synced") ||
      detail.includes("no data") ||
      detail.includes("no baseline")
    ) {
      missing += 1;
    }
  }
  return missing;
}

function lastNDates(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out; // most-recent first
}

export async function evaluateAdaptation(userId: string): Promise<AdaptEvaluation> {
  // Pull last 8 days to give us a window plus a buffer.
  const since = new Date();
  since.setDate(since.getDate() - 8);

  const [readinessRes, iqRes] = await Promise.all([
    supabase
      .from("readiness_snapshots")
      .select("recorded_at, score, factors")
      .eq("user_id", userId)
      .gte("recorded_at", since.toISOString())
      .order("recorded_at", { ascending: false }),
    supabase
      .from("running_iq_snapshots")
      .select("recorded_at, adjusted_score, score")
      .eq("user_id", userId)
      .gte("recorded_at", since.toISOString())
      .order("recorded_at", { ascending: false }),
  ]);

  const readinessRows = (readinessRes.data || []) as Array<{
    recorded_at: string;
    score: number | null;
    factors: unknown;
  }>;
  const iqRows = ((iqRes.data || []) as Array<{ recorded_at: string; adjusted_score: number | null; score: number | null }>).map(
    (r) => ({ recorded_at: r.recorded_at, score: r.adjusted_score ?? r.score })
  );

  const readinessDaily = reduceDaily(readinessRows);
  const iqDaily = reduceDaily(iqRows);

  // ── DOWN: last DOWN_DAYS days all below threshold (actual readings required) ──
  const downWindow = lastNDates(DOWN_DAYS);
  const downScores = downWindow.map((d) => readinessDaily.get(d));
  const downReady = downScores.every((s) => typeof s === "number");
  if (downReady && downScores.every((s) => (s as number) < READINESS_DOWN_THRESHOLD)) {
    // Data-completeness guard: if the most recent snapshot is missing >2 of the
    // 6 core factors, the low score is driven by defaults — skip adaptation.
    const latest = readinessRows[0];
    const missingCount = latest ? countMissingCoreFactors(latest.factors) : CORE_FACTOR_LABELS.length;
    if (missingCount > 2) {
      console.warn(
        `[plan-adaptation] readiness data incomplete, adaptation skipped (${missingCount}/${CORE_FACTOR_LABELS.length} core factors missing)`
      );
      return {
        direction: null,
        reason: "readiness_data_incomplete",
        detail: `Readiness data incomplete, adaptation skipped (${missingCount} of ${CORE_FACTOR_LABELS.length} core factors missing)`,
      };
    }
    return {
      direction: "down",
      reason: "readiness_low_2d",
      detail: `Readiness < ${READINESS_DOWN_THRESHOLD} for ${DOWN_DAYS} days (${downScores.map((s) => Math.round(s as number)).join(", ")})`,
    };
  }

  // ── UP: last UP_DAYS days readiness >= UP_THRESH AND IQ trending positive ──
  const upWindow = lastNDates(UP_DAYS);
  const upScores = upWindow.map((d) => readinessDaily.get(d));
  const upIqScores = upWindow.map((d) => iqDaily.get(d));
  const upReady =
    upScores.every((s) => typeof s === "number") &&
    upIqScores.every((s) => typeof s === "number");
  if (
    upReady &&
    upScores.every((s) => (s as number) >= READINESS_UP_THRESHOLD)
  ) {
    // IQ trending positive: today's IQ > avg of the rest
    const todayIq = upIqScores[0] as number;
    const restAvg =
      (upIqScores.slice(1) as number[]).reduce((a, b) => a + b, 0) /
      Math.max(1, upIqScores.length - 1);
    if (todayIq > restAvg) {
      return {
        direction: "up",
        reason: "readiness_high_3d",
        detail: `Readiness >= ${READINESS_UP_THRESHOLD} for ${UP_DAYS} days, IQ trending up`,
      };
    }
  }

  return { direction: null, reason: "no_trigger" };
}

// ── Per-day debounce: only check once per user per local day. ──

const KEY = (userId: string) => `lastAdaptCheck:${userId}`;

export function shouldRunAdaptCheck(userId: string): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const prev = localStorage.getItem(KEY(userId));
    return prev !== today;
  } catch {
    return true;
  }
}

export function markAdaptCheckRan(userId: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(KEY(userId), today);
  } catch {
    // ignore
  }
}

// Dismissal for the upward banner (per day).
const UP_DISMISS_KEY = (userId: string) => `adaptUpDismissed:${userId}`;

export function isUpwardDismissedToday(userId: string): boolean {
  try {
    const today = new Date().toISOString().slice(0, 10);
    return localStorage.getItem(UP_DISMISS_KEY(userId)) === today;
  } catch {
    return false;
  }
}

export function dismissUpwardToday(userId: string) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(UP_DISMISS_KEY(userId), today);
  } catch {
    // ignore
  }
}
