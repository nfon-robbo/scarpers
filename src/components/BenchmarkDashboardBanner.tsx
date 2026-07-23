/**
 * Slim dashboard banner shown when a scheduled benchmark has at least one
 * candidate activity ready to confirm within ±48h.
 *
 * Behaviour:
 *   • Renders directly under the dashboard header (never above Next Workout).
 *   • Dismisses when the user clicks Confirm/Reject on the plan page (via a
 *     window event) or the passing-day rules fire.
 *   • Session-dismissible via the ✕ button.
 */
import { useEffect, useMemo, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { Award, ChevronRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { extractAllBenchmarkDates, type BenchmarkProtocol } from "@/lib/benchmark-token";
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
  planContent: string | null | undefined;
}

export default function BenchmarkDashboardBanner({ userId, planContent }: Props) {
  const [candidateCount, setCandidateCount] = useState(0);
  const [target, setTarget] = useState<{ isoDate: string; protocol: BenchmarkProtocol } | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const navigate = useNavigate();

  // Nearest scheduled benchmark (past 7d → future 14d).
  const nearest = useMemo(() => {
    if (!planContent) return null;
    const all = extractAllBenchmarkDates(planContent);
    if (all.length === 0) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const scored = all
      .map((b) => ({ ...b, delta: differenceInCalendarDays(new Date(`${b.isoDate}T12:00:00Z`), today) }))
      .filter((b) => b.delta >= -7 && b.delta <= 14)
      .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta));
    return scored[0] ?? null;
  }, [planContent]);

  useEffect(() => {
    setTarget(nearest ? { isoDate: nearest.isoDate, protocol: nearest.protocol } : null);
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
          .select("id").eq("user_id", userId).eq("scheduled_date", target.isoDate).limit(1),
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
