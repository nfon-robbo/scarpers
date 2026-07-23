/**
 * useBenchmarkForDate — resolves the benchmark protocol scheduled on a given
 * ISO date (via the standalone benchmark_results row), loads candidate
 * activities within ±48h, applies the user's rejection set, and returns the
 * sorted candidate list plus a `refresh` to re-query after a confirm/reject
 * write.
 *
 * Returns `{ protocol: null }` when no benchmark is scheduled on that date.
 */
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import { getScheduledBenchmarkForDate } from "@/lib/benchmark-scheduled";
import {
  findBenchmarkCandidates,
  type ActivityForDetection,
  type CandidateActivity,
} from "@/lib/benchmark-detection";

export interface UseBenchmarkForDateArgs {
  userId: string | null | undefined;
  /** Kept for signature compatibility; no longer read. */
  planContent?: string | null | undefined;
  isoDate: string; // YYYY-MM-DD
  /** When true, we've already confirmed one — hide the card. */
  alreadyConfirmed?: boolean;
}

export interface UseBenchmarkForDateResult {
  protocol: BenchmarkProtocol | null;
  candidates: CandidateActivity[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useBenchmarkForDate(
  args: UseBenchmarkForDateArgs,
): UseBenchmarkForDateResult {
  const { userId, isoDate, alreadyConfirmed } = args;

  const [protocol, setProtocol] = useState<BenchmarkProtocol | null>(null);
  const [candidates, setCandidates] = useState<CandidateActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId || alreadyConfirmed) {
      setProtocol(null);
      setCandidates([]);
      return;
    }
    setLoading(true);
    try {
      const scheduled = await getScheduledBenchmarkForDate(userId, isoDate);
      if (!scheduled) {
        setProtocol(null);
        setCandidates([]);
        return;
      }
      setProtocol(scheduled.benchmark_protocol);

      const from = new Date(`${isoDate}T12:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 3);
      const to = new Date(`${isoDate}T12:00:00Z`);
      to.setUTCDate(to.getUTCDate() + 3);

      const [{ data: acts }, { data: rej }] = await Promise.all([
        supabase
          .from("activities")
          .select("id, start_time, duration_seconds, distance_meters, avg_heart_rate, activity_type")
          .eq("user_id", userId)
          .gte("start_time", from.toISOString())
          .lte("start_time", to.toISOString()),
        supabase
          .from("benchmark_rejections" as any)
          .select("activity_id")
          .eq("user_id", userId),
      ]);

      const rejectedIds = new Set<string>((rej ?? []).map((r: any) => r.activity_id));
      setCandidates(findBenchmarkCandidates({
        activities: (acts ?? []) as ActivityForDetection[],
        scheduledDateIso: isoDate,
        protocol: scheduled.benchmark_protocol,
        rejectedIds,
      }));
    } finally {
      setLoading(false);
    }
  }, [userId, isoDate, alreadyConfirmed]);

  useEffect(() => { void load(); }, [load]);

  return { protocol, candidates, loading, refresh: load };
}
