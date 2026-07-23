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

/**
 * Derive Z1–Z4 upper bounds from an LTHR using the fixed band model.
 * Z5 is anything above z4Max (unbounded — do not invent a ceiling).
 */
export function zonesFromLthr(lthr: number): Pick<Zones, "z1Max" | "z2Max" | "z3Max" | "z4Max"> {
  return {
    z1Max: Math.floor(0.85 * lthr - 0.0001),
    z2Max: Math.floor(0.90 * lthr - 0.0001),
    z3Max: Math.floor(0.95 * lthr - 0.0001),
    z4Max: Math.floor(1.02 * lthr + 0.5),
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

// ---------- Canonical per-user resolver ----------
//
// This is the ONLY entry point real call sites should use. It fetches the
// canonical 180-day activity window + age from the profile, so every surface
// (ai-coach, intervals-sync, useHrZones on the client, Running IQ) receives
// identical zones for a given user at a given moment.
//
// If a caller ever needs a different window, do NOT change this helper — add
// a new named exception function alongside it and document why.
//
// The underlying pure resolver lives in `./hr-zones-internal.ts` and is
// intentionally NOT re-exported from this module — production code must not
// pass its own activity slice. Tests import from the internal file directly.

import { resolveZones } from "./hr-zones-internal.ts";

type MinimalSupabase = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, val: unknown) => {
        maybeSingle?: () => Promise<{ data: unknown }>;
        gte?: (col: string, val: unknown) => {
          not: (col: string, op: string, val: unknown) => Promise<{ data: unknown }>;
        };
      };
    };
  };
};

export async function resolveZonesForUser(
  supabase: MinimalSupabase,
  userId: string,
  opts: { measuredLthr?: number | null } = {},
): Promise<Zones> {
  const sinceIso = new Date(
    Date.now() - OBSERVED_MAX_LOOKBACK_DAYS * 86400 * 1000,
  ).toISOString();

  const [profileRes, actsRes] = await Promise.all([
    (supabase as any)
      .from("profiles")
      .select("date_of_birth")
      .eq("user_id", userId)
      .maybeSingle(),
    (supabase as any)
      .from("activities")
      .select("id, max_heart_rate, start_time, activity_type")
      .eq("user_id", userId)
      .gte("start_time", sinceIso)
      .not("max_heart_rate", "is", null),
  ]);

  const dob = (profileRes?.data as { date_of_birth?: string } | null)?.date_of_birth;
  const ageYears = dob
    ? (Date.now() - new Date(dob).getTime()) / (365.25 * 86400 * 1000)
    : null;

  return resolveZones({
    ageYears,
    activities: (actsRes?.data ?? []) as ActivityMaxSample[],
    measuredLthr: opts.measuredLthr ?? null,
  });
}


