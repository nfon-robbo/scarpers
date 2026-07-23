/**
 * Push a measured benchmark threshold pace to intervals.icu.
 *
 * Wraps the existing `intervals-sync` edge function with the `setThresholdPace`
 * command — no new edge function. Always overwrites the Run.threshold_pace
 * (the guard against overwriting was removed intentionally: the 3.03 m/s
 * default sticks forever once written, and the measured value must win).
 */
import { supabase } from "@/integrations/supabase/client";
import { secPerKmToMPerSec } from "@/lib/benchmark-calculations";

export async function pushBenchmarkThresholdPace(thresholdSecPerKm: number): Promise<
  { ok: true; mPerSec: number } | { ok: false; error: string }
> {
  if (!Number.isFinite(thresholdSecPerKm) || thresholdSecPerKm <= 0) {
    return { ok: false, error: "invalid threshold pace" };
  }
  const mPerSec = Number(secPerKmToMPerSec(thresholdSecPerKm).toFixed(4));
  try {
    const resp = await supabase.functions.invoke("intervals-sync", {
      body: { setThresholdPace: { mPerSec } },
    });
    if (resp.error) return { ok: false, error: resp.error.message ?? String(resp.error) };
    return { ok: true, mPerSec };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
