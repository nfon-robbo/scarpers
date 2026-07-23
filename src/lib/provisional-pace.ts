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
  /** Set when the chosen seed disagrees sharply with the recent training baseline. */
  discrepancy?: { message: string; recentBaselinePace: string; recentBaselineCount: number };
}

/**
 * Plausibility + recency configuration for the tiered seed.
 *
 * Tier 1 gating (recent training must corroborate an older PB):
 *  - TIER1_PRIMARY_WINDOW_DAYS: first look here. A recent 5 km is preferred
 *    over an older, faster one.
 *  - TIER1_FALLBACK_WINDOW_DAYS: only used if the primary window is empty.
 *  - TIER1_MIN_CONTINUOUS_RUNS_28D: the athlete must have at least this many
 *    continuous runs in the last 28 days for Tier 1 to apply at all. If
 *    they're mid walk/run block (or laid off), Tier 1 is skipped even if a
 *    PB sits in the window.
 *  - WALK_RUN_PACE_THRESHOLD_SEC_PER_KM: pace slower than this counts as a
 *    walk/run session, not a continuous run.
 *  - CONTINUOUS_RUN_MIN_METERS: minimum distance for a run to count toward
 *    the continuous-run tally.
 *
 * Plausibility guard for accepted Tier 1 candidates:
 *  - HARD_FLOOR_SEC_PER_KM: unconditional floor.
 *  - MIN_HR_FRACTION_OF_MAX × resolvedMaxHr: HR check (skipped without max).
 *  - MAX_FASTER_THAN_EASY_BASELINE_SEC: relative check vs the athlete's own
 *    easy-run baseline (needs EASY_BASELINE_MIN_RUNS to apply).
 *
 * Discrepancy flag (soft warning, no rejection):
 *  - DISCREPANCY_GAP_SEC_PER_KM: when the seeded easy pace is this many
 *    seconds/km FASTER than the recent easy baseline, surface a note so the
 *    athlete sees the contradiction instead of silently trusting Tier 1.
 */
export const ProvisionalPaceConfig = {
  TIER1_PRIMARY_WINDOW_DAYS: 42,
  TIER1_FALLBACK_WINDOW_DAYS: 90,
  TIER1_MIN_CONTINUOUS_RUNS_28D: 3,
  WALK_RUN_PACE_THRESHOLD_SEC_PER_KM: 9 * 60, // 9:00/km
  CONTINUOUS_RUN_MIN_METERS: 3000,
  HARD_FLOOR_SEC_PER_KM: 3 * 60 + 30, // 3:30/km — unconditional
  MIN_HR_FRACTION_OF_MAX: 0.88,
  MAX_FASTER_THAN_EASY_BASELINE_SEC: 90,
  EASY_BASELINE_MIN_RUNS: 3,
  DISCREPANCY_GAP_SEC_PER_KM: 30,
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
  resolvedMaxHr: number | null,
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

  // HR check only runs when we have both a candidate HR AND a canonical max HR.
  // No hardcoded fallback — if max HR is unknown, skip the check rather than
  // invent a number that competes with the single source of truth.
  if (candidate.avg_heart_rate != null && resolvedMaxHr != null) {
    const minHr = resolvedMaxHr * c.MIN_HR_FRACTION_OF_MAX;
    if (candidate.avg_heart_rate < minHr) {
      return {
        reason: "hr_too_low_for_5k_effort",
        pace: fmt(candidate.sec_per_km),
        detail: `Avg HR ${Math.round(candidate.avg_heart_rate)} bpm on ${dateStr} is below ${Math.round(minHr)} bpm (88% of max ${resolvedMaxHr}) — not a hard 5k.`,
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
  opts: { experienceLevel?: string | null; z2MaxHr?: number | null; resolvedMaxHr?: number | null } = {},
): Promise<ProvisionalPace> {
  const c = ProvisionalPaceConfig;
  try {
    const since = new Date(Date.now() - c.TIER1_FALLBACK_WINDOW_DAYS * 86400_000).toISOString();
    const { data } = await supabase
      .from("activities")
      .select("id,start_time,distance_meters,duration_seconds,avg_heart_rate,activity_type")
      .eq("user_id", userId)
      .ilike("activity_type", "run%")
      .gte("start_time", since)
      .order("start_time", { ascending: false })
      .limit(500);
    const runs = ((data as unknown) as Row[] | null) ?? [];

    const now = Date.now();
    const withPace = runs
      .filter(r => (r.distance_meters ?? 0) > 0 && (r.duration_seconds ?? 0) > 0)
      .map(r => ({
        ...r,
        sec_per_km: (r.duration_seconds as number) / ((r.distance_meters as number) / 1000),
        ageDays: (now - new Date(r.start_time).getTime()) / 86400_000,
      }));

    // Recent-training gate: continuous runs (≥3 km, faster than walk/run
    // threshold) in the last 28 days. Below the minimum → Tier 1 is disabled
    // entirely; recent training wins over stale race form.
    const continuous28d = withPace.filter(r =>
      r.ageDays <= 28
      && (r.distance_meters ?? 0) >= c.CONTINUOUS_RUN_MIN_METERS
      && r.sec_per_km < c.WALK_RUN_PACE_THRESHOLD_SEC_PER_KM,
    );
    const tier1Allowed = continuous28d.length >= c.TIER1_MIN_CONTINUOUS_RUNS_28D;

    // Easy-run baseline for Tier 2, for the Tier 1 relative guard, and for
    // the discrepancy check. Prefer the most recent 5.
    const z2Max = opts.z2MaxHr ?? null;
    const continuousRuns = withPace
      .filter(r => (r.distance_meters ?? 0) >= 2000)
      .filter(r => r.sec_per_km < c.WALK_RUN_PACE_THRESHOLD_SEC_PER_KM);
    const easyByHr = continuousRuns
      .filter(r => z2Max == null || r.avg_heart_rate == null || r.avg_heart_rate <= z2Max)
      .slice(0, 5);
    // If the athlete habitually trains above Z2, the HR filter yields nothing.
    // Relax to the most recent continuous runs so Tier 2 can still fire.
    const easyRuns = easyByHr.length > 0 ? easyByHr : continuousRuns.slice(0, 5);
    const easyRelaxed = easyByHr.length === 0 && continuousRuns.length > 0;
    const easyPaces = easyRuns.map(r => r.sec_per_km);
    const easyAvg = easyPaces.length ? easyPaces.reduce((s, p) => s + p, 0) / easyPaces.length : null;

    let rejection: ProvisionalPace["rejection"] | undefined;

    // Tier 1 — fastest continuous 5 km, but recency-weighted: primary 42-day
    // window first, 90-day fallback only if primary is empty.
    if (tier1Allowed) {
      const allFives = withPace
        .filter(r => (r.distance_meters ?? 0) >= 4800 && (r.distance_meters ?? 0) <= 5200)
        .sort((a, b) => a.sec_per_km - b.sec_per_km);
      const primary = allFives.filter(r => r.ageDays <= c.TIER1_PRIMARY_WINDOW_DAYS);
      const pool = primary.length > 0 ? primary : allFives;
      const usedFallback = primary.length === 0 && allFives.length > 0;

      for (const cand of pool) {
        const reject = vetTier1(cand, easyAvg, easyRuns.length, opts.resolvedMaxHr ?? null);
        if (!reject) {
          const easySec = cand.sec_per_km + 60;
          const dateStr = new Date(cand.start_time).toLocaleDateString("en-GB");
          const windowNote = usedFallback
            ? ` (nothing in the last ${c.TIER1_PRIMARY_WINDOW_DAYS} days — falling back to ${c.TIER1_FALLBACK_WINDOW_DAYS})`
            : "";
          const seed: ProvisionalPace = {
            tier: "tier1_5k",
            paceMin: fmt(easySec),
            paceMax: fmt(easySec + 20),
            label: "Provisional pace",
            detail: `From your ${(cand.distance_meters! / 1000).toFixed(2)} km run on ${dateStr} at ${fmt(cand.sec_per_km)}/km${windowNote}`,
            rejection,
          };
          // Soft discrepancy flag: chosen easy pace is much faster than the
          // recent easy baseline. Do not reject — surface it.
          if (easyAvg != null && easyRuns.length >= 2) {
            const gap = easyAvg - easySec;
            if (gap > c.DISCREPANCY_GAP_SEC_PER_KM) {
              seed.discrepancy = {
                message: `Seeded from your ${(cand.distance_meters! / 1000).toFixed(2)} km on ${dateStr} at ${fmt(cand.sec_per_km)}/km. Your recent easy runs suggest something slower (~${fmt(easyAvg)}/km).`,
                recentBaselinePace: fmt(easyAvg),
                recentBaselineCount: easyRuns.length,
              };
            }
          }
          return seed;
        }
        console.warn("[provisional-pace] Tier 1 candidate rejected:", {
          activity_id: cand.id,
          pace: fmt(cand.sec_per_km),
          avg_hr: cand.avg_heart_rate,
          reason: reject.reason,
          detail: reject.detail,
        });
        if (!rejection) {
          rejection = { tier: "tier1_5k", reason: reject.reason, pace: reject.pace, detail: reject.detail };
        }
      }
    } else {
      console.info("[provisional-pace] Tier 1 skipped: only", continuous28d.length, "continuous runs in last 28d (need", c.TIER1_MIN_CONTINUOUS_RUNS_28D, ")");
    }

    // Tier 2 — recent easy runs. When Tier 1 was skipped for recency reasons,
    // use whatever easy runs we have (however few); otherwise require the
    // usual 3-run minimum for confidence.
    const tier2MinRuns = tier1Allowed ? 3 : 1;
    if (easyAvg != null && easyRuns.length >= tier2MinRuns) {
      const cushioned = easyAvg + 15;
      const skipNote = !tier1Allowed
        ? ` — recent training is walk/run or sparse, so older race form is ignored`
        : "";
      return {
        tier: "tier2_easy_avg",
        paceMin: fmt(cushioned),
        paceMax: fmt(cushioned + 20),
        label: "Provisional pace",
        detail: `Average of your last ${easyRuns.length} ${easyRelaxed ? "continuous" : "easy"} run${easyRuns.length === 1 ? "" : "s"} (${fmt(easyAvg)}/km) with a 15 s/km cushion${skipNote}`,
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
