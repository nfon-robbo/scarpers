/**
 * Cross-source merge orchestration.
 *
 * Ties the pure fuzzy-match + enrichment primitives (findFuzzyMatch,
 * buildEnrichmentPatch) to a Supabase-backed pipeline:
 *
 *   1. Fetch existing activities whose start_time falls inside the union
 *      of ±FUZZY_START_WINDOW_S windows around all incoming rows.
 *   2. For each incoming row, find the best fuzzy candidate.
 *   3. Return an assignment: enrichments (to update existing rows and
 *      attach laps to their id) vs. remaining rows (to insert as-new).
 *
 * The helper is DB-read only. Callers apply the returned updates and
 * decide how to persist laps against the existing id.
 *
 * The exact-source_file fast path stays with the caller — this helper
 * is only invoked for rows that did NOT match by source_file.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  findFuzzyMatch,
  buildEnrichmentPatch,
  formatEnrichmentDiff,
  FUZZY_START_WINDOW_S,
  type FuzzyCandidate,
} from "@/lib/activity-fuzzy-merge";

export type MergeIncoming = {
  start_time: string;
  activity_type: string | null;
  duration_seconds: number | null;
  [field: string]: unknown;
};

export type MergeEnrichment = {
  incomingIndex: number;
  existingId: string;
  patch: Record<string, unknown>;
  filledFields: string[];
};

export type MergePlan = {
  enrichments: MergeEnrichment[];
  remainingIndexes: number[];
};

const PROTECTED_ENRICH_FIELDS = new Set([
  "id",
  "user_id",
  "created_at",
  "updated_at",
  "source",
  "source_file",
  "upload_id",
  "start_time",
  "activity_type",
]);

/**
 * Resolve cross-source enrichments for a batch of incoming rows.
 * Returns which existing rows to enrich and which incoming rows are
 * genuine misses that the caller must insert as-new.
 */
export async function planCrossSourceMerge(
  userId: string,
  incoming: MergeIncoming[],
): Promise<MergePlan> {
  if (incoming.length === 0) return { enrichments: [], remainingIndexes: [] };

  // Time-window candidate fetch: min-window..max+window
  const starts = incoming
    .map((r) => Date.parse(r.start_time))
    .filter((n) => Number.isFinite(n));
  if (starts.length === 0) {
    return {
      enrichments: [],
      remainingIndexes: incoming.map((_, i) => i),
    };
  }
  const minT = Math.min(...starts) - FUZZY_START_WINDOW_S * 1000;
  const maxT = Math.max(...starts) + FUZZY_START_WINDOW_S * 1000;

  const { data: rows, error } = await supabase
    .from("activities")
    .select(
      "id, start_time, activity_type, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, max_speed, avg_power, max_power, avg_cadence, total_ascent, total_descent, calories, avg_temperature, training_effect, training_load, source_file",
    )
    .eq("user_id", userId)
    .gte("start_time", new Date(minT).toISOString())
    .lte("start_time", new Date(maxT).toISOString());
  if (error) {
    console.warn("[cross-source-merge] candidate fetch failed:", error.message);
    return {
      enrichments: [],
      remainingIndexes: incoming.map((_, i) => i),
    };
  }

  const candidates: FuzzyCandidate[] = (rows ?? []).map((r: any) => ({
    ...r,
    duration_s: r.duration_seconds ?? null,
  }));

  const enrichments: MergeEnrichment[] = [];
  const remaining: number[] = [];
  const usedIds = new Set<string>();

  for (let i = 0; i < incoming.length; i++) {
    const inc = incoming[i];
    const pool = candidates.filter((c) => !usedIds.has(c.id));
    const match = findFuzzyMatch(
      {
        start_time: inc.start_time,
        activity_type: inc.activity_type,
        duration_s: inc.duration_seconds,
      },
      pool,
    );
    if (!match) {
      remaining.push(i);
      continue;
    }
    usedIds.add(match.candidate.id);

    // Build enrichment patch: fill null fields on existing from incoming.
    const existingRow = match.candidate as unknown as Record<string, unknown>;
    const incomingRow: Record<string, unknown> = { ...inc };
    // Present incoming duration under existing column name for the diff.
    if (incomingRow.duration_seconds != null) {
      incomingRow.duration_seconds = incomingRow.duration_seconds;
    }
    const { patch, filledFields } = buildEnrichmentPatch(
      existingRow,
      incomingRow,
      Array.from(PROTECTED_ENRICH_FIELDS),
    );
    enrichments.push({
      incomingIndex: i,
      existingId: String(existingRow.id),
      patch,
      filledFields,
    });
    console.info(
      formatEnrichmentDiff(String(existingRow.id), filledFields) +
        ` startΔ=${Math.round(match.startDeltaS)}s durΔ=${Math.round(match.durationDeltaS)}s`,
    );
  }

  return { enrichments, remainingIndexes: remaining };
}

/**
 * Apply enrichment patches. Skips empty patches (nothing to fill).
 */
export async function applyEnrichmentPatches(
  enrichments: MergeEnrichment[],
): Promise<void> {
  for (const e of enrichments) {
    if (Object.keys(e.patch).length === 0) continue;
    const { error } = await supabase
      .from("activities")
      .update(e.patch)
      .eq("id", e.existingId);
    if (error) {
      console.warn(
        `[cross-source-merge] enrich update failed for ${e.existingId}: ${error.message}`,
      );
    }
  }
}
