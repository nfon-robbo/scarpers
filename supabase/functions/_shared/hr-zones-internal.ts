/**
 * INTERNAL — not part of the public HR-zones surface.
 *
 * `resolveZones` accepts a caller-supplied activity slice, which is exactly
 * the shape that re-introduces the slice-mismatch bug this module was
 * written to eliminate. Production code MUST NOT import from this file —
 * use `resolveZonesForUser` in `./hr-zones.ts` instead, which bakes in the
 * canonical 180-day activity window and profile-based age.
 *
 * This file exists so unit tests can still cover the pure resolution logic
 * with hand-crafted inputs. If a real call site ever needs to import from
 * here, that is a design smell — add a named exception helper alongside
 * `resolveZonesForUser` and document why.
 */

import {
  LTHR_PCT_OF_MAX,
  resolveObservedMax,
  zonesFromLthr,
  type ActivityMaxSample,
  type LthrSource,
  type MaxHrSource,
  type Zones,
} from "./hr-zones.ts";

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

function estimateLthr(maxHr: number): number {
  return Math.round(maxHr * LTHR_PCT_OF_MAX);
}

export function resolveZones(input: ResolveInput): Zones {
  // 1. Measured LTHR wins outright.
  if (input.measuredLthr && input.measuredLthr > 0) {
    const lthr = Math.round(input.measuredLthr);
    return {
      ...zonesFromLthr(lthr),
      lthr,
      lthrSource: "measured",
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

// Silence "unused import" if constants are only re-exported symbolically.
void IMPLAUSIBLE_MAX_HR;
void CORROBORATION_TOLERANCE_BPM;
void HARD_FALLBACK_MAX_HR;
