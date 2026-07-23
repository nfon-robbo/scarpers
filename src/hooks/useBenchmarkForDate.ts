/**
 * useBenchmarkForDate — resolves the benchmark protocol scheduled on a
 * given ISO date, loads candidate activities within ±48h, applies the
 * user's rejection set, and returns the sorted candidate list plus a
 * `refresh` to re-query after a confirm/reject write.
 *
 * Returns `{ protocol: null }` when no benchmark is scheduled on that date.
 * Returns `candidates: []` when a benchmark is scheduled but nothing has
 * been run yet inside the window.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  extractBenchmarkProtocolForDate,
  type BenchmarkProtocol,
} from "@/lib/benchmark-token";
import {
  findBenchmarkCandidates,
  type ActivityForDetection,
  type CandidateActivity,
} from "@/lib/benchmark-detection";

export interface UseBenchmarkForDateArgs {
  userId: string | null | undefined;
  planContent: string | null | undefined;
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
  const { userId, planContent, isoDate, alreadyConfirmed } = args;

  const protocol = useMemo(
    () => extractBenchmarkProtocolForDate(planContent ?? "", isoDate),
    [planContent, isoDate],
  );

  const [candidates, setCandidates] = useState<CandidateActivity[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!userId || !protocol || alreadyConfirmed) {
      setCandidates([]);
      return;
    }
    setLoading(true);
    try {
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
      const list = findBenchmarkCandidates({
        activities: (acts ?? []) as ActivityForDetection[],
        scheduledDateIso: isoDate,
        protocol,
        rejectedIds,
      });
      setCandidates(list);
    } finally {
      setLoading(false);
    }
  }, [userId, protocol, isoDate, alreadyConfirmed]);

  useEffect(() => { void load(); }, [load]);

  return { protocol, candidates, loading, refresh: load };
}
