/**
 * Redo action: mark the just-saved benchmark as 'discarded' (NOT 'rejected'
 * — 'rejected' is used for "this activity was not my benchmark" and is
 * consumed by candidate detection), and insert a new 'scheduled' row for
 * the athlete-chosen date. No plan markdown is rewritten; benchmarks are
 * standalone rows.
 */
import { supabase } from "@/integrations/supabase/client";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

export interface RedoParams {
  discardedBenchmarkId: string;
  userId: string;
  planId: string | null;
  protocol: BenchmarkProtocol;
  /** ISO date (YYYY-MM-DD) the athlete picked for the redo. */
  newDateIso: string;
}

export async function requestBenchmarkRedo(params: RedoParams): Promise<{ newId: string }> {
  const { discardedBenchmarkId, userId, planId, protocol, newDateIso } = params;

  // 1. Discard the just-saved row.
  const { error: updErr } = await supabase
    .from("benchmark_results" as any)
    .update({
      status: "discarded",
      active: false,
      effort_window_note: "athlete requested redo",
    } as any)
    .eq("id", discardedBenchmarkId);
  if (updErr) throw updErr;

  // 2. Insert new scheduled row.
  const { data, error: insErr } = await supabase
    .from("benchmark_results" as any)
    .insert({
      user_id: userId,
      training_plan_id: planId,
      benchmark_date: newDateIso,
      scheduled_date: newDateIso,
      benchmark_protocol: protocol,
      status: "scheduled",
      active: true,
      capture_method: "auto",
      // NOT NULL numerics — the row is a placeholder until the effort runs.
      effort_window_duration_s: 0,
      effort_window_distance_m: 0,
      effort_window_source: "manual",
      threshold_pace_s_per_km: 0,
    } as any)
    .select("id")
    .single();
  if (insErr) throw insErr;

  return { newId: (data as any).id as string };
}
