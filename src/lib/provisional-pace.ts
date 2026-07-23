/**
 * Provisional pace seeding.
 *
 * Runs BEFORE a benchmark has ever been captured so plan generation has a
 * realistic easy-pace anchor instead of falling back to textbook defaults
 * inside the coach. Three tiers, in order:
 *
 *   Tier 1 — fastest continuous 5 km (4.8–5.2 km) in the last 90 days,
 *            subject to the plausibility guard in ProvisionalPaceConfig.
 *            A rejected Tier 1 candidate falls through to Tier 2.
 *   Tier 2 — average pace of the last five easy runs (≥ 2 km, HR ≤ Z2 max
 *            when available, else all runs), then add a conservative
 *            +15 s/km cushion.
 *   Tier 3 — experience-level conservative defaults.
 *
 * Never throws — errors resolve to the Tier-3 default so callers can rely
 * on `getProvisionalPace` and never block plan creation.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProvisionalTier = "tier1_5k" | "tier2_easy_avg" | "tier3_default";

export interface ProvisionalPace {
  tier: ProvisionalTier;
  /** min/km as "M:SS". */
  paceMin: string;
  /** min/km as "M:SS" (paceMin + 20s window). */
  paceMax: string;
  /** Human-readable label for surfacing next to inputs. */
  label: string;
  /** Extra context (activity date, sample size, etc.). */
  detail: string;
  /** Populated when a higher-tier candidate was rejected by the guard. */
  rejection?: { tier: ProvisionalTier; reason: string; pace: string; detail: string };
}

/**
 * Plausibility guard for Tier 1. Tunable in one place.
 *
 * - HARD_FLOOR_SEC_PER_KM: an absolute floor below which no candidate is
 *   ever accepted (sub-3:30/km implies elite; almost always a mis-recorded
 *   cycle or GPS drift).
 * - MIN_HR_FRACTION_OF_MAX: if avg HR is present and below this fraction of
 *   an assumed 190 bpm max, the effort was not hard enough to be a 5k TT.
 * - MAX_FASTER_THAN_EASY_BASELINE_SEC: candidate must not be more than this
 *   many seconds/km faster than the athlete's own easy-run baseline. This
 *   catches the "one hot outlier surrounded by walk/run sessions" case.
 * - EASY_BASELINE_MIN_RUNS: minimum easy runs required before the relative
 *   check applies; below this we fall back to the hard floor only.
 */
export const ProvisionalPaceConfig = {
  HARD_FLOOR_SEC_PER_KM: 3 * 60 + 30, // 3:30/km
  MIN_HR_FRACTION_OF_MAX: 0.88,
  ASSUMED_MAX_HR: 190,
  MAX_FASTER_THAN_EASY_BASELINE_SEC: 90,
  EASY_BASELINE_MIN_RUNS: 3,
} as const;

function fmt(secPerKm: number): string {
  const s = Math.max(0, Math.round(secPerKm));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function defaultForExperience(level: string | null | undefined): ProvisionalPace {
  const l = (level || "intermediate").toLowerCase();
  let easy = 6 * 60 + 30;
  let label = "Intermediate default";
  if (/begin|novice|new/.test(l)) { easy = 7 * 60 + 30; label = "Beginner default"; }
  else if (/elite|advanced|expert/.test(l)) { easy = 5 * 60; label = "Advanced default"; }
  return {
    tier: "tier3_default",
    paceMin: fmt(easy),
    paceMax: fmt(easy + 20),
    label: "Provisional pace",
    detail: `${label} (no recent run history)`,
  };
}

interface Row {
  id: string;
  start_time: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_heart_rate: number | null;
}

interface Tier1Reject {
  reason: string;
  pace: string;
  detail: string;
}

/**
 * Vet a Tier 1 candidate. Returns null if plausible, or a rejection
 * object describing why it was tossed.
 */
function vetTier1(
  candidate: Row & { sec_per_km: number },
  easyBaselineSec: number | null,
  easyBaselineCount: number,
): Tier1Reject | null {
  const c = ProvisionalPaceConfig;
  const dateStr = new Date(candidate.start_time).toLocaleDateString("en-GB");

  if (candidate.sec_per_km < c.HARD_FLOOR_SEC_PER_KM) {
    return {
      reason: "below_hard_floor",
      pace: fmt(candidate.sec_per_km),
      detail: `Faster than the ${fmt(c.HARD_FLOOR_SEC_PER_KM)}/km floor — likely a mis-recorded cycle or GPS drift.`,
    };
  }

  if (candidate.avg_heart_rate != null) {
    const minHr = c.ASSUMED_MAX_HR * c.MIN_HR_FRACTION_OF_MAX;
    if (candidate.avg_heart_rate < minHr) {
      return {
        reason: "hr_too_low_for_5k_effort",
        pace: fmt(candidate.sec_per_km),
        detail: `Avg HR ${Math.round(candidate.avg_heart_rate)} bpm on ${dateStr} is below ${Math.round(minHr)} bpm — not a hard 5k.`,
      };
    }
  }

  if (easyBaselineSec != null && easyBaselineCount >= c.EASY_BASELINE_MIN_RUNS) {
    const gap = easyBaselineSec - candidate.sec_per_km;
    if (gap > c.MAX_FASTER_THAN_EASY_BASELINE_SEC) {
      return {
        reason: "faster_than_easy_baseline",
        pace: fmt(candidate.sec_per_km),
        detail: `${fmt(candidate.sec_per_km)}/km on ${dateStr} is ${Math.round(gap)} s/km faster than your easy-run baseline (${fmt(easyBaselineSec)}/km over ${easyBaselineCount} runs) — implausible as a repeatable 5k.`,
      };
    }
  }

  return null;
}

export async function getProvisionalPace(
  supabase: SupabaseClient,
  userId: string,
  opts: { experienceLevel?: string | null; z2MaxHr?: number | null } = {},
): Promise<ProvisionalPace> {
  try {
    const since = new Date(Date.now() - 90 * 86400_000).toISOString();
    const { data } = await supabase
      .from("activities")
      .select("id,start_time,distance_meters,duration_seconds,avg_heart_rate,activity_type")
      .eq("user_id", userId)
      .ilike("activity_type", "run%")
      .gte("start_time", since)
      .order("start_time", { ascending: false })
      .limit(500);
    const runs = ((data as unknown) as Row[] | null) ?? [];

    // Easy-run baseline — used both by Tier 2 and by the Tier 1 guard.
    const z2Max = opts.z2MaxHr ?? null;
    const easyRuns = runs
      .filter(r => (r.distance_meters ?? 0) >= 2000 && (r.duration_seconds ?? 0) > 0)
      .filter(r => z2Max == null || r.avg_heart_rate == null || r.avg_heart_rate <= z2Max)
      .slice(0, 5);
    const easyPaces = easyRuns.map(r => (r.duration_seconds as number) / ((r.distance_meters as number) / 1000));
    const easyAvg = easyPaces.length ? easyPaces.reduce((s, p) => s + p, 0) / easyPaces.length : null;

    // Tier 1 — fastest continuous 5 km (accept ±4%), plausibility-vetted.
    const fives = runs
      .filter(r => r.distance_meters != null && r.duration_seconds != null
        && r.distance_meters >= 4800 && r.distance_meters <= 5200
        && r.duration_seconds > 0)
      .map(r => ({
        ...r,
        sec_per_km: (r.duration_seconds as number) / ((r.distance_meters as number) / 1000),
      }))
      .sort((a, b) => a.sec_per_km - b.sec_per_km);

    let rejection: ProvisionalPace["rejection"] | undefined;
    for (const cand of fives) {
      const reject = vetTier1(cand, easyAvg, easyRuns.length);
      if (!reject) {
        const easySec = cand.sec_per_km + 60; // easy sits ~60 s/km slower than a hard 5k
        return {
          tier: "tier1_5k",
          paceMin: fmt(easySec),
          paceMax: fmt(easySec + 20),
          label: "Provisional pace",
          detail: `From your ${(cand.distance_meters! / 1000).toFixed(2)} km run on ${new Date(cand.start_time).toLocaleDateString("en-GB")} at ${fmt(cand.sec_per_km)}/km`,
          rejection,
        };
      }
      console.warn("[provisional-pace] Tier 1 candidate rejected:", {
        activity_id: cand.id,
        pace: fmt(cand.sec_per_km),
        avg_hr: cand.avg_heart_rate,
        reason: reject.reason,
        detail: reject.detail,
      });
      // Keep the first rejection for user-facing surfacing; try next candidate.
      if (!rejection) {
        rejection = { tier: "tier1_5k", reason: reject.reason, pace: reject.pace, detail: reject.detail };
      }
    }

    // Tier 2 — last five easy runs (≥ 2 km), average pace + 15 s cushion.
    if (easyAvg != null && easyRuns.length >= 3) {
      const cushioned = easyAvg + 15;
      return {
        tier: "tier2_easy_avg",
        paceMin: fmt(cushioned),
        paceMax: fmt(cushioned + 20),
        label: "Provisional pace",
        detail: `Average of your last ${easyRuns.length} easy runs (${fmt(easyAvg)}/km) with a 15 s/km cushion`,
        rejection,
      };
    }

    const fallback = defaultForExperience(opts.experienceLevel);
    return { ...fallback, rejection };
  } catch (e) {
    console.warn("provisional pace: query failed, falling back to default", e);
  }
  return defaultForExperience(opts.experienceLevel);
}
