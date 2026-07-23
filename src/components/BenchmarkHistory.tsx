/**
 * BenchmarkHistory — append-only list of past confirmed benchmarks.
 *
 * Columns: date, protocol, distance/duration, threshold HR/pace, predicted 5K,
 * confidence score/band, and the Likely Submaximal flag. Rows expand to show
 * `confidence_deductions` when band === 'Low'.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPace, formatDuration } from "@/lib/benchmark-calculations";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

interface Row {
  id: string;
  benchmark_date: string;
  benchmark_protocol: BenchmarkProtocol | null;
  effort_window_distance_m: number | null;
  effort_window_duration_s: number | null;
  threshold_pace_s_per_km: number | null;
  threshold_hr: number | null;
  predicted_5k_seconds: number | null;
  confidence_score: number | null;
  confidence_band: "High" | "Medium" | "Low" | null;
  confidence_deductions: Array<{ reason: string; points: number }> | null;
  likely_submaximal: boolean | null;
}

const PROTOCOL_LABEL: Record<string, string> = {
  "30min": "30-min TT",
  "3k": "3K TT",
  "5k": "5K TT",
};

const BAND_COLOR: Record<string, string> = {
  High: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Low: "bg-red-500/15 text-red-400 border-red-500/30",
};

function humanReason(r: string): string {
  return r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function BenchmarkHistory({ userId }: { userId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("benchmark_results" as any)
        .select(
          "id, benchmark_date, benchmark_protocol, effort_window_distance_m, effort_window_duration_s, threshold_pace_s_per_km, threshold_hr, predicted_5k_seconds, confidence_score, confidence_band, confidence_deductions, likely_submaximal",
        )
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .order("benchmark_date", { ascending: false })
        .limit(50);
      if (!cancelled) setRows((data as any) ?? []);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (rows === null) {
    return <Skeleton className="h-32 w-full" />;
  }
  if (rows.length === 0) {
    return (
      <Card className="glass p-4 text-sm text-muted-foreground">
        No confirmed benchmarks yet. Complete one from your plan to start tracking threshold trend.
      </Card>
    );
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Card className="glass p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">Benchmark history</h3>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          {rows.length} confirmed
        </span>
      </div>
      <div className="divide-y divide-border/40">
        {rows.map((r) => {
          const isOpen = expanded.has(r.id);
          const showDeductions =
            r.confidence_band === "Low" &&
            Array.isArray(r.confidence_deductions) &&
            r.confidence_deductions.length > 0;
          return (
            <div key={r.id} className="py-2">
              <button
                type="button"
                onClick={() => showDeductions && toggle(r.id)}
                className="w-full flex items-center gap-2 text-left"
                disabled={!showDeductions}
              >
                {showDeductions ? (
                  isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                         : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                ) : <span className="w-3.5 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold">
                      {format(new Date(`${r.benchmark_date}T12:00:00Z`), "d MMM yyyy")}
                    </span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {PROTOCOL_LABEL[r.benchmark_protocol ?? ""] ?? r.benchmark_protocol ?? "—"}
                    </Badge>
                    {r.confidence_band && (
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 border ${BAND_COLOR[r.confidence_band]}`}
                      >
                        {r.confidence_band} · {r.confidence_score}
                      </Badge>
                    )}
                    {r.likely_submaximal && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400 inline-flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> Likely submaximal
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                    {r.effort_window_distance_m != null && (
                      <span>{(r.effort_window_distance_m / 1000).toFixed(2)} km</span>
                    )}
                    {r.effort_window_duration_s != null && (
                      <span>{formatDuration(r.effort_window_duration_s)}</span>
                    )}
                    {r.threshold_pace_s_per_km != null && (
                      <span>LT {formatPace(r.threshold_pace_s_per_km)}</span>
                    )}
                    {r.threshold_hr != null && <span>{r.threshold_hr} bpm</span>}
                    {r.predicted_5k_seconds != null && (
                      <span>5K → {formatDuration(r.predicted_5k_seconds)}</span>
                    )}
                  </div>
                </div>
              </button>
              {showDeductions && isOpen && (
                <ul className="mt-2 ml-5 text-[11px] text-muted-foreground space-y-0.5">
                  {r.confidence_deductions!.map((d, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span>{humanReason(d.reason)}</span>
                      <span className="tabular-nums">−{d.points}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
