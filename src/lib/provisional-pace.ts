/**
 * Provisional pace seeding.
 *
 * Runs BEFORE a benchmark has ever been captured so plan generation has a
 * realistic easy-pace anchor instead of falling back to textbook defaults
 * inside the coach. Three tiers, in order:
 *
 *   Tier 1 — fastest continuous 5 km (4.8–5.2 km) in the last 90 days.
 *            The pace is used as-is; that effort is treated as a soft time-
 *            trial and the athlete's easy pace sits ~60 s/km slower.
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
}

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

    // Tier 1 — fastest continuous 5 km (accept ±4%).
    const fives = runs
      .filter(r => r.distance_meters != null && r.duration_seconds != null
        && r.distance_meters >= 4800 && r.distance_meters <= 5200
        && r.duration_seconds > 0)
      .map(r => ({
        ...r,
        sec_per_km: (r.duration_seconds as number) / ((r.distance_meters as number) / 1000),
      }))
      .sort((a, b) => a.sec_per_km - b.sec_per_km);
    if (fives.length > 0) {
      const best = fives[0];
      const easySec = best.sec_per_km + 60; // easy sits ~60 s/km slower than a hard 5k
      return {
        tier: "tier1_5k",
        paceMin: fmt(easySec),
        paceMax: fmt(easySec + 20),
        label: "Provisional pace",
        detail: `From your ${(best.distance_meters! / 1000).toFixed(2)} km run on ${new Date(best.start_time).toLocaleDateString("en-GB")} at ${fmt(best.sec_per_km)}/km`,
      };
    }

    // Tier 2 — last five easy runs (≥ 2 km), average pace + 15 s cushion.
    const z2Max = opts.z2MaxHr ?? null;
    const easyRuns = runs
      .filter(r => (r.distance_meters ?? 0) >= 2000 && (r.duration_seconds ?? 0) > 0)
      .filter(r => z2Max == null || r.avg_heart_rate == null || r.avg_heart_rate <= z2Max)
      .slice(0, 5);
    if (easyRuns.length >= 3) {
      const paces = easyRuns.map(r => (r.duration_seconds as number) / ((r.distance_meters as number) / 1000));
      const avg = paces.reduce((s, p) => s + p, 0) / paces.length;
      const cushioned = avg + 15;
      return {
        tier: "tier2_easy_avg",
        paceMin: fmt(cushioned),
        paceMax: fmt(cushioned + 20),
        label: "Provisional pace",
        detail: `Average of your last ${easyRuns.length} easy runs (${fmt(avg)}/km) with a 15 s/km cushion`,
      };
    }
  } catch (e) {
    console.warn("provisional pace: query failed, falling back to default", e);
  }
  return defaultForExperience(opts.experienceLevel);
}
