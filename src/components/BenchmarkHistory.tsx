/**
 * BenchmarkHistory — append-only list of past confirmed benchmarks.
 *
 * Renders: date, protocol, distance/duration, threshold HR/pace, predicted
 * 5K, confidence, Likely Submaximal, injury flag, and (when present) the
 * Coach's take verdict from post_benchmark_interview.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ChevronDown, ChevronRight, HeartHandshake } from "lucide-react";
import ReactMarkdown from "react-markdown";
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
  injury_flagged: boolean | null;
  held_back_reasons: string[] | null;
  slowdown_reason: string | null;
  breaks_reasons: string[] | null;
  stoppage_duration_band: string | null;
  conditions: string[] | null;
  post_benchmark_interview: { verdict?: string; verdict_at?: string } | null;
}

const PROTOCOL_LABEL: Record<string, string> = {
  "30min": "30-min TT", "3k": "3K TT", "5k": "5K TT",
};

const BAND_COLOR: Record<string, string> = {
  High:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  Medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  Low:    "bg-red-500/15 text-red-400 border-red-500/30",
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
          "id, benchmark_date, benchmark_protocol, effort_window_distance_m, effort_window_duration_s, threshold_pace_s_per_km, threshold_hr, predicted_5k_seconds, confidence_score, confidence_band, confidence_deductions, likely_submaximal, injury_flagged, held_back_reasons, slowdown_reason, breaks_reasons, stoppage_duration_band, conditions, post_benchmark_interview",
        )
        .eq("user_id", userId)
        .eq("status", "confirmed")
        .order("benchmark_date", { ascending: false })
        .limit(50);
      if (!cancelled) setRows((data as any) ?? []);
    })();
    return () => { cancelled = true; };
  }, [userId]);

  if (rows === null) return <Skeleton className="h-32 w-full" />;
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
          const verdict = r.post_benchmark_interview?.verdict;
          const hasDeductions = Array.isArray(r.confidence_deductions) && r.confidence_deductions.length > 0;
          const hasInterview =
            (r.held_back_reasons && r.held_back_reasons.length > 0) ||
            r.slowdown_reason ||
            (r.breaks_reasons && r.breaks_reasons.length > 0) ||
            r.stoppage_duration_band ||
            (r.conditions && r.conditions.length > 0);
          const canExpand = !!verdict || hasDeductions || !!hasInterview;
          return (
            <div key={r.id} className="py-2">
              <button
                type="button"
                onClick={() => canExpand && toggle(r.id)}
                className="w-full flex items-center gap-2 text-left"
                disabled={!canExpand}
              >
                {canExpand ? (
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
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 border ${BAND_COLOR[r.confidence_band]}`}>
                        {r.confidence_band} · {r.confidence_score}
                      </Badge>
                    )}
                    {r.likely_submaximal && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-400 inline-flex items-center gap-1">
                        <AlertTriangle className="w-2.5 h-2.5" /> Likely submaximal
                      </Badge>
                    )}
                    {r.injury_flagged && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-red-500/40 text-red-400 inline-flex items-center gap-1">
                        <HeartHandshake className="w-2.5 h-2.5" /> Injury flagged
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
              {canExpand && isOpen && (
                <div className="mt-2 ml-5 space-y-2">
                  {verdict && (
                    <div className="rounded-md bg-primary/5 border border-primary/20 p-2">
                      <p className="text-[10px] uppercase tracking-wider text-primary font-semibold mb-1">
                        Coach's take
                      </p>
                      <div className="prose prose-invert prose-sm max-w-none text-[12px] leading-relaxed">
                        <ReactMarkdown>{verdict}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                  {hasInterview && (
                    <div className="text-[11px] text-muted-foreground space-y-0.5">
                      {r.held_back_reasons && r.held_back_reasons.length > 0 && (
                        <div><span className="text-foreground/80">Held back:</span> {r.held_back_reasons.join(", ")}</div>
                      )}
                      {r.slowdown_reason && (
                        <div><span className="text-foreground/80">Slowdown:</span> {r.slowdown_reason}</div>
                      )}
                      {r.breaks_reasons && r.breaks_reasons.length > 0 && (
                        <div><span className="text-foreground/80">Breaks:</span> {r.breaks_reasons.join(", ")}{r.stoppage_duration_band ? ` · ${r.stoppage_duration_band}` : ""}</div>
                      )}
                      {r.conditions && r.conditions.length > 0 && (
                        <div><span className="text-foreground/80">Conditions:</span> {r.conditions.join(", ")}</div>
                      )}
                    </div>
                  )}
                  {hasDeductions && (
                    <ul className="text-[11px] text-muted-foreground space-y-0.5">
                      {r.confidence_deductions!.map((d, i) => (
                        <li key={i} className="flex justify-between gap-4">
                          <span>{humanReason(d.reason)}</span>
                          <span className="tabular-nums">−{d.points}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
