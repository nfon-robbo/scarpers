/**
 * Fuzzy update-in-place for incoming activities.
 *
 * When a benchmark (or any activity) arrives from a second source — e.g.
 * a FIT upload of an activity already imported via Strava — we must NOT
 * insert a duplicate. Instead:
 *   1. Match the incoming activity to an existing row by:
 *        - start_time within 5 minutes
 *        - same activity_type (case-insensitive)
 *        - duration within 2 minutes (moving_time_s or elapsed_time_s;
 *          caller passes whichever it treats as canonical)
 *   2. Attach the new laps to the existing activity's id (no new row).
 *   3. Enrich null fields on the existing row from the incoming payload.
 *      NEVER overwrite a non-null value.
 *
 * Both functions are pure — they take plain objects and return plain
 * objects. Persistence (updating the DB row, inserting laps) is the
 * caller's job.
 */

export type FuzzyCandidate = {
  id: string;
  start_time: string; // ISO
  activity_type: string | null;
  duration_s: number | null;
  [field: string]: unknown;
};

export type FuzzyIncoming = {
  start_time: string;
  activity_type: string | null;
  duration_s: number | null;
  [field: string]: unknown;
};

export type FuzzyMatch = {
  candidate: FuzzyCandidate;
  startDeltaS: number;
  durationDeltaS: number;
};

export const FUZZY_START_WINDOW_S = 5 * 60; // 300
export const FUZZY_DURATION_WINDOW_S = 2 * 60; // 120

export function findFuzzyMatch(
  incoming: FuzzyIncoming,
  candidates: FuzzyCandidate[],
): FuzzyMatch | null {
  const inStart = Date.parse(incoming.start_time);
  if (!Number.isFinite(inStart)) return null;
  const inType = (incoming.activity_type || "").toLowerCase();
  const inDur = incoming.duration_s;

  const scored: FuzzyMatch[] = [];
  for (const c of candidates) {
    const cStart = Date.parse(c.start_time);
    if (!Number.isFinite(cStart)) continue;

    const startDeltaS = Math.abs((inStart - cStart) / 1000);
    if (startDeltaS > FUZZY_START_WINDOW_S) continue;

    const cType = (c.activity_type || "").toLowerCase();
    if (inType && cType && inType !== cType) continue;

    // Duration check: if either side is missing, allow (best-effort merge);
    // if both present, must be within window.
    let durationDeltaS = 0;
    if (inDur != null && c.duration_s != null) {
      durationDeltaS = Math.abs(inDur - c.duration_s);
      if (durationDeltaS > FUZZY_DURATION_WINDOW_S) continue;
    }

    scored.push({ candidate: c, startDeltaS, durationDeltaS });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => {
    if (a.startDeltaS !== b.startDeltaS) return a.startDeltaS - b.startDeltaS;
    return a.durationDeltaS - b.durationDeltaS;
  });
  return scored[0];
}

export type EnrichmentResult<T extends Record<string, unknown>> = {
  patch: Partial<T>;
  filledFields: string[];
};

/**
 * Build a patch object that fills ONLY null/undefined fields on `existing`
 * from `incoming`. Non-null existing values are preserved untouched.
 * `protectedFields` are never enriched (id, timestamps, source markers).
 */
export function buildEnrichmentPatch<T extends Record<string, unknown>>(
  existing: T,
  incoming: Partial<T>,
  protectedFields: ReadonlyArray<keyof T> = [
    "id",
    "user_id",
    "created_at",
    "updated_at",
    "source",
    "source_file",
  ] as ReadonlyArray<keyof T>,
): EnrichmentResult<T> {
  const patch: Partial<T> = {};
  const filledFields: string[] = [];
  const protectedSet = new Set(protectedFields as ReadonlyArray<string>);

  for (const key of Object.keys(incoming) as (keyof T)[]) {
    if (protectedSet.has(key as string)) continue;
    const inVal = incoming[key];
    if (inVal === undefined || inVal === null) continue;
    const exVal = existing[key];
    if (exVal === null || exVal === undefined) {
      patch[key] = inVal;
      filledFields.push(key as string);
    }
  }

  return { patch, filledFields };
}

/**
 * Formats an enrichment-diff log line for a single merge event.
 * Callers pass the returned string to their logger of choice.
 */
export function formatEnrichmentDiff(
  activityId: string,
  filledFields: string[],
): string {
  if (filledFields.length === 0) {
    return `[fuzzy-merge] activity=${activityId} no null fields to enrich`;
  }
  return `[fuzzy-merge] activity=${activityId} filled=${filledFields.join(",")}`;
}
