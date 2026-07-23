/**
 * benchmark-scheduled — the single source of truth for "is a benchmark
 * scheduled on date X" and "what is the athlete's latest measured
 * threshold?". Replaces the deleted plan-markdown token machinery.
 *
 * Scheduled benchmark = row in benchmark_results with:
 *   status = 'scheduled'
 *   training_plan_id IS NULL  (standalone, not embedded in a plan)
 *   benchmark_date = the day the athlete plans to run it
 *
 * Confirmed benchmark = status='confirmed' AND active=true. `confirmBenchmark`
 * writes the measured threshold pace / HR onto this row.
 */

import { supabase } from "@/integrations/supabase/client";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

export interface ScheduledBenchmark {
  id: string;
  benchmark_date: string;      // YYYY-MM-DD
  benchmark_protocol: BenchmarkProtocol;
}

export interface ConfirmedBenchmark {
  id: string;
  benchmarkDate: string;                // YYYY-MM-DD
  protocol: BenchmarkProtocol;
  thresholdPaceSecPerKm: number;
  thresholdHr: number | null;
  lthr: number | null;
}

/** Scheduled rows overlapping [fromIso, toIso] (inclusive). */
export async function getScheduledBenchmarksInRange(
  userId: string,
  fromIso: string,
  toIso: string,
): Promise<ScheduledBenchmark[]> {
  const { data, error } = await supabase
    .from("benchmark_results" as any)
    .select("id, benchmark_date, benchmark_protocol")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .is("training_plan_id", null)
    .gte("benchmark_date", fromIso)
    .lte("benchmark_date", toIso);
  if (error) throw error;
  return (data ?? []) as unknown as ScheduledBenchmark[];
}

/** Single scheduled row for a specific date, if any. */
export async function getScheduledBenchmarkForDate(
  userId: string,
  isoDate: string,
): Promise<ScheduledBenchmark | null> {
  const { data, error } = await supabase
    .from("benchmark_results" as any)
    .select("id, benchmark_date, benchmark_protocol")
    .eq("user_id", userId)
    .eq("status", "scheduled")
    .is("training_plan_id", null)
    .eq("benchmark_date", isoDate)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as unknown as ScheduledBenchmark | null;
}

/**
 * Latest confirmed benchmark for a user — used as an INPUT to plan
 * generation so every pace/HR target derives from real data.
 */
export async function getLatestConfirmedBenchmark(
  userId: string,
): Promise<ConfirmedBenchmark | null> {
  const { data, error } = await supabase
    .from("benchmark_results" as any)
    .select("id, benchmark_date, benchmark_protocol, threshold_pace_s_per_km, threshold_hr, lthr")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .eq("active", true)
    .order("benchmark_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return {
    id: r.id,
    benchmarkDate: r.benchmark_date,
    protocol: r.benchmark_protocol,
    thresholdPaceSecPerKm: Number(r.threshold_pace_s_per_km),
    thresholdHr: r.threshold_hr ?? null,
    lthr: r.lthr ?? null,
  };
}

/**
 * Insert a standalone scheduled benchmark row. Called from the
 * benchmark-first modal shown before plan generation.
 */
export async function scheduleStandaloneBenchmark(params: {
  userId: string;
  benchmarkDateIso: string;
  protocol: BenchmarkProtocol;
}): Promise<{ id: string }> {
  const { userId, benchmarkDateIso, protocol } = params;
  const { data, error } = await supabase
    .from("benchmark_results" as any)
    .insert({
      user_id: userId,
      training_plan_id: null,
      scheduled_date: null,
      benchmark_date: benchmarkDateIso,
      benchmark_protocol: protocol,
      status: "scheduled",
      active: true,
      capture_method: "auto",
      effort_window_duration_s: 0,
      effort_window_distance_m: 0,
      effort_window_source: "manual",
      threshold_pace_s_per_km: 0,
      predicted_5k_seconds: 0,
      riegel_exponent: 1.06,
      activity_snapshot: { scheduled: true, at: new Date().toISOString() },
    } as any)
    .select("id")
    .single();
  if (error) throw error;
  return { id: (data as any).id };
}
