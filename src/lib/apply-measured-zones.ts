/**
 * applyMeasuredZones — THE SOLE WRITER to public.hr_zones.
 *
 * Called only from behind the ZoneComparisonDialog after an explicit user
 * confirm. Refuses to write for 3K/5K benchmarks (their peak-HR-based LTHR
 * estimate is not trustworthy — see the verbatim override warning shown in
 * BenchmarkOverrideDialog).
 *
 * Grep guard: no other file in this repo may `.from("hr_zones").insert(...)`
 * or `.update(...)`. If you need to write zones, extend this function.
 */
import { supabase } from "@/integrations/supabase/client";
import { zonesFromLthr } from "@shared/hr-zones";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

/**
 * Plausibility bounds for a measured lactate-threshold HR. Values outside
 * this window are almost certainly a sensor artefact (strap dropouts, ECG
 * cross-talk, or a treadmill armband picking up mains hum) rather than a
 * real threshold, so we refuse to overwrite zones with them.
 *
 * These are deliberately wide — 100 bpm covers well-trained masters
 * athletes with low resting HR, and 210 bpm covers young athletes with a
 * genuinely high max. If you hit either limit with a legitimate benchmark,
 * change the constant here (not silently in a caller).
 */
export const MIN_PLAUSIBLE_LTHR_BPM = 100;
export const MAX_PLAUSIBLE_LTHR_BPM = 210;

export interface ApplyMeasuredZonesResult {
  hrZonesId: string;
  lthr: number;
  z1Max: number;
  z2Max: number;
  z3Max: number;
  z4Max: number;
}

export async function applyMeasuredZones(params: {
  userId: string;
  benchmarkId: string;
  protocol: BenchmarkProtocol;
  measuredLthr: number;
  effectiveFrom?: string; // ISO; defaults to now
}): Promise<ApplyMeasuredZonesResult> {
  const { userId, benchmarkId, protocol, measuredLthr } = params;

  if (protocol !== "30min") {
    throw new Error(
      "Zones can only be rebuilt from a 30-minute threshold benchmark. A 3K/5K result estimates pace only.",
    );
  }
  if (
    !Number.isFinite(measuredLthr) ||
    measuredLthr < MIN_PLAUSIBLE_LTHR_BPM ||
    measuredLthr > MAX_PLAUSIBLE_LTHR_BPM
  ) {
    throw new Error(
      `Refusing to write hr_zones: LTHR ${measuredLthr} bpm is outside the plausible range ` +
      `${MIN_PLAUSIBLE_LTHR_BPM}-${MAX_PLAUSIBLE_LTHR_BPM} bpm.`,
    );
  }

  const bands = zonesFromLthr(measuredLthr);

  const payload = {
    user_id: userId,
    source: "benchmark" as const,
    benchmark_result_id: benchmarkId,
    lthr: Math.round(measuredLthr),
    z1_max: bands.z1Max,
    z2_max: bands.z2Max,
    z3_max: bands.z3Max,
    z4_max: bands.z4Max,
    effective_from: params.effectiveFrom ?? new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("hr_zones" as any)
    .insert(payload as any)
    .select("id")
    .single();
  if (error) throw error;

  return {
    hrZonesId: (data as any).id as string,
    lthr: payload.lthr,
    z1Max: bands.z1Max,
    z2Max: bands.z2Max,
    z3Max: bands.z3Max,
    z4Max: bands.z4Max,
  };
}
