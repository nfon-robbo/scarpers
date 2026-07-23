/**
 * BenchmarkDueBanner — six-week re-benchmark prompt.
 *
 * Driven by `profiles.next_benchmark_due`. Shown from the day it comes due
 * onward; dismissible per session. Distinct from BenchmarkDashboardBanner
 * (which nudges athletes to confirm an already-scheduled slot); this one
 * nudges them to SCHEDULE a fresh benchmark.
 */
import { useEffect, useState } from "react";
import { differenceInCalendarDays, format } from "date-fns";
import { CalendarClock, ChevronRight, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const DISMISS_KEY = "benchmark_due_banner_dismissed_session";

export default function BenchmarkDueBanner({ userId }: { userId: string }) {
  const [dueIso, setDueIso] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("next_benchmark_due")
        .eq("user_id", userId)
        .maybeSingle();
      if (cancelled) return;
      setDueIso((data as any)?.next_benchmark_due ?? null);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (!dueIso || dismissed) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueIso}T12:00:00Z`);
  const delta = differenceInCalendarDays(due, today);
  if (delta > 0) return null; // not due yet

  const overdueBy = Math.abs(delta);
  return (
    <button
      type="button"
      onClick={() => window.location.assign("/training-plan")}
      className="w-full flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15 transition-colors px-3 py-2 text-left"
    >
      <CalendarClock className="w-4 h-4 text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate">
          Re-benchmark due {overdueBy === 0 ? "today" : `${overdueBy} day${overdueBy === 1 ? "" : "s"} ago`}
        </p>
        <p className="text-[11px] text-muted-foreground truncate">
          Scheduled: {format(due, "d MMM")}. Add a 30-min TT to your plan to refresh threshold pace + zones.
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-amber-400 shrink-0" />
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
