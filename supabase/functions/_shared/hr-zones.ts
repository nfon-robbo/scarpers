/**
 * Single source of truth for heart-rate zones.
 *
 * Band model: LTHR (Lactate Threshold Heart Rate).
 *   Z1 <  85 % LTHR
 *   Z2  85 – <90 % LTHR
 *   Z3  90 – <95 % LTHR
 *   Z4  95 – ≤102 % LTHR
 *   Z5 >102 % LTHR
 *
 * LTHR is resolved once per athlete via `resolveZones`:
 *   1. Measured LTHR (from a completed benchmark) — step 3 will supply this.
 *   2. Estimated LTHR = `LTHR_PCT_OF_MAX` × resolved max HR.
 *
 * Resolved max HR priority:
 *   a) Corroborated observed max in the last `OBSERVED_MAX_LOOKBACK_DAYS`
 *      (highest reading ≤ `IMPLAUSIBLE_MAX_HR` that has at least one other
 *      activity max within `CORROBORATION_TOLERANCE_BPM`; walk/run activities
 *      excluded upstream).
 *   b) `220 - age`.
 *   c) `HARD_FALLBACK_MAX_HR`.
 *
 * All six HR-zone surfaces (ai-coach plan, ai-coach deload, Analytics chart,
 * ActivityDetailDialog, running-iq aerobic cap, intervals-sync push) call
 * `resolveZones` + `bpmToZone` / `zoneRangeLabel`. No surface computes zones
 * locally.
 *
 * This file lives under supabase/functions/_shared so Deno edge functions
 * import it natively. The Vite client re-exports it via the `@shared/hr-zones`
 * alias defined in vite.config.ts — same file, no duplication.
 */

// ---------- Tunable constants ----------

/** Provisional multiplier used until a measured benchmark LTHR exists. */
export const LTHR_PCT_OF_MAX = 0.89;

/** Lookback window when scanning activities for observed max HR. */
export const OBSERVED_MAX_LOOKBACK_DAYS = 180;

/** Any single reading above this is treated as an artifact, not a real max. */
export const IMPLAUSIBLE_MAX_HR = 200;

/** Corroboration guard: observed max must be within this many bpm of at least
 *  one other activity's max in the window. */
export const CORROBORATION_TOLERANCE_BPM = 5;

/** Final numeric fallback when no age and no observed data are available. */
export const HARD_FALLBACK_MAX_HR = 190;

// ---------- Types ----------

export type ZoneNumber = 1 | 2 | 3 | 4 | 5;

export type LthrSource = "measured" | "age_estimated" | "observed_estimated" | "fallback_estimated";

export type MaxHrSource = "observed_corroborated" | "age" | "fallback";

export type Zones = {
  /** Upper inclusive bound of Z1 (integer bpm). Z2 starts at z1Max + 1. */
  z1Max: number;
  /** Upper inclusive bound of Z2. */
  z2Max: number;
  /** Upper inclusive bound of Z3. */
  z3Max: number;
  /** Upper inclusive bound of Z4. Z5 = anything above this (unbounded). */
  z4Max: number;
  /** LTHR (bpm) used to derive the bands. */
  lthr: number;
  /** Provenance of the LTHR value. Display-only; never routes calculation. */
  lthrSource: LthrSource;
  /** Resolved max HR (bpm) used for the LTHR estimate (equals lthr for measured). */
  maxHr: number;
  /** Provenance of the max HR value. */
  maxHrSource: MaxHrSource;
  /** Optional diagnostic — activity that supplied the observed max. */
  maxHrActivityId?: string | null;
  /** Optional diagnostic — date of that activity (ISO). */
  maxHrActivityDate?: string | null;
};

export type ActivityMaxSample = {
  /** Optional — used only for diagnostic reporting of which activity supplied the max. */
  id?: string | null;
  max_heart_rate: number | null | undefined;
  start_time: string | null | undefined;
  activity_type?: string | null | undefined;
};

export type ResolveInput = {
  ageYears?: number | null;
  /**
   * Recent activity samples (last `OBSERVED_MAX_LOOKBACK_DAYS`). Walk/run
   * activities are excluded internally by `activity_type` regex. Every
   * remaining sample counts as one candidate; corroboration is computed
   * across the set using array-index identity (id is optional).
   */
  activities?: ActivityMaxSample[];
  /** If a measured benchmark LTHR exists, pass it — beats every estimator. */
  measuredLthr?: number | null;
};

// ---------- Resolution ----------

/**
 * Pick the observed max HR under the guard rules. Returns null if no
 * candidate is corroborated.
 */
export function resolveObservedMax(activities: ActivityMaxSample[]): {
  bpm: number;
  activityId: string | null;
  activityDate: string | null;
} | null {
  const walkRunRe = /walk[\s_-]*run|run[\s_-]*walk|walk|hike/i;
  const candidates = activities
    .map((a, idx) => ({
      idx,
      bpm: Math.round(Number(a.max_heart_rate ?? 0)),
      id: a.id ?? null,
      date: a.start_time ?? null,
      type: a.activity_type ?? null,
    }))
    .filter((c) => c.bpm > 0 && c.bpm <= IMPLAUSIBLE_MAX_HR && !(c.type && walkRunRe.test(c.type)))
    .sort((a, b) => b.bpm - a.bpm);

  for (const c of candidates) {
    const corroborated = candidates.some(
      (o) => o.idx !== c.idx && Math.abs(o.bpm - c.bpm) <= CORROBORATION_TOLERANCE_BPM,
    );
    if (corroborated) {
      return { bpm: c.bpm, activityId: c.id, activityDate: c.date };
    }
  }
  return null;
}

function estimateLthr(maxHr: number): number {
  return Math.round(maxHr * LTHR_PCT_OF_MAX);
}

/**
 * Derive Z1–Z4 upper bounds from an LTHR using the fixed band model.
 * Z5 is anything above z4Max (unbounded — do not invent a ceiling).
 */
export function zonesFromLthr(lthr: number): Pick<Zones, "z1Max" | "z2Max" | "z3Max" | "z4Max"> {
  return {
    z1Max: Math.floor(0.85 * lthr - 0.0001), // <85 % → integers ≤ floor(0.85·LTHR)
    z2Max: Math.floor(0.90 * lthr - 0.0001), // <90 %
    z3Max: Math.floor(0.95 * lthr - 0.0001), // <95 %
    z4Max: Math.floor(1.02 * lthr + 0.5),    // ≤102 % (inclusive)
  };
}

export function resolveZones(input: ResolveInput): Zones {
  // 1. Measured LTHR wins outright.
  if (input.measuredLthr && input.measuredLthr > 0) {
    const lthr = Math.round(input.measuredLthr);
    return {
      ...zonesFromLthr(lthr),
      lthr,
      lthrSource: "measured",
      // For a measured LTHR we don't need max HR to derive zones, but keep the
      // field populated for display consumers.
      maxHr: Math.round(lthr / LTHR_PCT_OF_MAX),
      maxHrSource: "observed_corroborated",
    };
  }

  // 2. Resolve max HR: observed (corroborated) → age → fallback.
  const observed = input.activities ? resolveObservedMax(input.activities) : null;

  let maxHr: number;
  let maxHrSource: MaxHrSource;
  let maxHrActivityId: string | null = null;
  let maxHrActivityDate: string | null = null;
  let lthrSource: LthrSource;

  if (observed) {
    maxHr = observed.bpm;
    maxHrSource = "observed_corroborated";
    maxHrActivityId = observed.activityId;
    maxHrActivityDate = observed.activityDate;
    lthrSource = "observed_estimated";
  } else if (input.ageYears && input.ageYears > 0) {
    maxHr = 220 - Math.round(input.ageYears);
    maxHrSource = "age";
    lthrSource = "age_estimated";
  } else {
    maxHr = HARD_FALLBACK_MAX_HR;
    maxHrSource = "fallback";
    lthrSource = "fallback_estimated";
  }

  const lthr = estimateLthr(maxHr);
  return {
    ...zonesFromLthr(lthr),
    lthr,
    lthrSource,
    maxHr,
    maxHrSource,
    maxHrActivityId,
    maxHrActivityDate,
  };
}

// ---------- Consumers ----------

export function bpmToZone(bpm: number, zones: Zones): ZoneNumber {
  if (bpm <= zones.z1Max) return 1;
  if (bpm <= zones.z2Max) return 2;
  if (bpm <= zones.z3Max) return 3;
  if (bpm <= zones.z4Max) return 4;
  return 5;
}

/** Human-readable range for a zone: "142–149" (Z5 as ">169"). */
export function zoneRangeLabel(zone: ZoneNumber, zones: Zones): string {
  switch (zone) {
    case 1: return `≤${zones.z1Max}`;
    case 2: return `${zones.z1Max + 1}–${zones.z2Max}`;
    case 3: return `${zones.z2Max + 1}–${zones.z3Max}`;
    case 4: return `${zones.z3Max + 1}–${zones.z4Max}`;
    case 5: return `>${zones.z4Max}`;
  }
}

/** Prompt-friendly summary line for the ai-coach edge function. */
export function zonesPromptLine(zones: Zones): string {
  return (
    `HR Zones (LTHR ${zones.lthr} bpm, ${zones.lthrSource.replace("_", " ")}, ` +
    `max HR ${zones.maxHr} ${zones.maxHrSource.replace("_", " ")}): ` +
    `Z1 ${zoneRangeLabel(1, zones)}, Z2 ${zoneRangeLabel(2, zones)}, ` +
    `Z3 ${zoneRangeLabel(3, zones)}, Z4 ${zoneRangeLabel(4, zones)}, ` +
    `Z5 ${zoneRangeLabel(5, zones)} bpm`
  );
}
