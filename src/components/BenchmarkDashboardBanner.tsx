/**
 * Slim dashboard banner shown when a scheduled benchmark has at least one
 * candidate activity ready to confirm within ±48h.
 *
 * Detection now reads scheduled benchmark rows directly from
 * benchmark_results (status='scheduled') — no more plan-markdown token
 * scanning. Nearest match wins in the window [past 7d, future 14d].
 */
import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { Award, ChevronRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import { getScheduledBenchmarksInRange, type ScheduledBenchmark } from "@/lib/benchmark-scheduled";
import {
  findBenchmarkCandidates,
  type ActivityForDetection,
} from "@/lib/benchmark-detection";

const DISMISS_KEY = "benchmark_banner_dismissed_session";
const PROTOCOL_LABEL: Record<BenchmarkProtocol, string> = {
  "30min": "30-min threshold",
  "3k": "3K TT",
  "5k": "5K TT",
};

interface Props {
  userId: string;
  /** Kept for signature compatibility; ignored — detection is now DB-driven. */
  planContent?: string | null | undefined;
}

function isoLocal(d: Date) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function BenchmarkDashboardBanner({ userId }: Props) {
  const [candidateCount, setCandidateCount] = useState(0);
  const [target, setTarget] = useState<{ isoDate: string; protocol: BenchmarkProtocol } | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledBenchmark[]>([]);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const from = new Date(); from.setDate(from.getDate() - 7);
      const to = new Date(); to.setDate(to.getDate() + 14);
      const rows = await getScheduledBenchmarksInRange(userId, isoLocal(from), isoLocal(to)).catch(() => []);
      if (!cancelled) setScheduled(rows);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const nearest = useMemo(() => {
    if (scheduled.length === 0) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const scored = scheduled
      .map((b) => ({ ...b, delta: differenceInCalendarDays(new Date(`${b.benchmark_date}T12:00:00Z`), today) }))
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    return scored[0] ?? null;
  }, [scheduled]);

  useEffect(() => {
    setTarget(nearest ? { isoDate: nearest.benchmark_date, protocol: nearest.benchmark_protocol } : null);
  }, [nearest]);

  useEffect(() => {
    let cancelled = false;
    if (!target || dismissed) { setCandidateCount(0); return; }
    (async () => {
      const from = new Date(`${target.isoDate}T12:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 3);
      const to = new Date(`${target.isoDate}T12:00:00Z`);
      to.setUTCDate(to.getUTCDate() + 3);

      const [{ data: acts }, { data: rej }, { data: existing }] = await Promise.all([
        supabase.from("activities")
          .select("id, start_time, duration_seconds, distance_meters, avg_heart_rate, activity_type")
          .eq("user_id", userId)
          .gte("start_time", from.toISOString())
          .lte("start_time", to.toISOString()),
        supabase.from("benchmark_rejections" as any)
          .select("activity_id").eq("user_id", userId),
        supabase.from("benchmark_results" as any)
          .select("id").eq("user_id", userId).eq("status", "confirmed").eq("benchmark_date", target.isoDate).limit(1),
      ]);

      if (cancelled) return;
      if (existing && existing.length > 0) { setCandidateCount(0); return; }
      const rejectedIds = new Set<string>((rej ?? []).map((r: any) => r.activity_id));
      const list = findBenchmarkCandidates({
        activities: (acts ?? []) as ActivityForDetection[],
        scheduledDateIso: target.isoDate,
        protocol: target.protocol,
        rejectedIds,
      });
      setCandidateCount(list.length);
    })();
    return () => { cancelled = true; };
  }, [userId, target, dismissed]);

  if (!target || dismissed || candidateCount === 0) return null;

  const label = format(new Date(`${target.isoDate}T12:00:00Z`), "d MMM");

  return (
    <button
      type="button"
      onClick={() => navigate("/training-plan")}
      className="w-full flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 hover:bg-primary/15 transition-colors px-3 py-2 text-left"
    >
      <Award className="w-4 h-4 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">
          Benchmark ready to confirm — {PROTOCOL_LABEL[target.protocol]} · {label}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          {candidateCount} matching {candidateCount === 1 ? "activity" : "activities"} in the ±48h window. Tap to review.
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-primary shrink-0" />
      <span
        role="button"
        tabIndex={0}
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation();
          try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
          setDismissed(true);
        }}
        className="p-1 -m-1 text-muted-foreground/70 hover:text-foreground"
      >
        <X className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}
