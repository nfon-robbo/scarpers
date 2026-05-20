import { useEffect, useMemo, useState } from "react";
import { Target, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type Distance = "5K" | "10K" | "Half Marathon" | "Marathon";
const DISTANCES: Distance[] = ["5K", "10K", "Half Marathon", "Marathon"];

interface PredictionResponse {
  insufficient?: boolean;
  race_distance: string;
  distance_km: number;
  target_sec?: number;
  conservative_sec?: number;
  stretch_sec?: number;
  pace_sec_per_km?: number;
  confidence?: "HIGH" | "MEDIUM" | "LOW";
  basis?: string[];
  goal_time_sec: number | null;
  goal_time: string | null;
  completed_sessions: number;
  planned_sessions: number;
  runs_in_last_21d?: number;
  message?: string;
  adherence?: number;
  weeks_completed?: number;
  error?: string;
}

function fmt(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Sensible default min/max bounds per distance (seconds)
const BOUNDS: Record<Distance, [number, number]> = {
  "5K": [15 * 60, 50 * 60],
  "10K": [32 * 60, 95 * 60],
  "Half Marathon": [70 * 60, 200 * 60],
  "Marathon": [150 * 60, 360 * 60],
};

export function RaceTimePredictorWidget() {
  const [distance, setDistance] = useState<Distance>("5K");
  const [data, setData] = useState<PredictionResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/race-predict`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ race_distance: distance }),
      });
      const json = await resp.json().catch(() => ({ error: "Failed" }));
      if (!cancelled) {
        setData(json);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [distance]);

  const [minSec, maxSec] = BOUNDS[distance];
  const target = data?.target_sec ?? null;
  const goal = data?.goal_time_sec ?? null;

  // Clamp a time into the gauge range and return angle in degrees (0 = left, 180 = right)
  const toAngle = (sec: number) => {
    const clamped = Math.min(maxSec, Math.max(minSec, sec));
    return ((clamped - minSec) / (maxSec - minSec)) * 180;
  };

  const goalAngle = goal != null ? toAngle(goal) : null;
  const targetAngle = target != null ? toAngle(target) : null;

  // SVG geometry
  const W = 320, H = 180, CX = W / 2, CY = H - 10, R = 130;
  const polar = (deg: number) => {
    // 0 deg => left (180), 180 deg => right (0)
    const a = Math.PI - (deg * Math.PI) / 180;
    return { x: CX + R * Math.cos(a), y: CY - R * Math.sin(a) };
  };
  const arcPath = (startDeg: number, endDeg: number) => {
    const s = polar(startDeg), e = polar(endDeg);
    const large = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${R} ${R} 0 ${large} 1 ${e.x} ${e.y}`;
  };

  // Band split: if goal exists, green = below goal, amber = goal..goal+8%, red = beyond
  const greenEnd = goalAngle ?? 60;
  const amberEnd = goal != null ? toAngle(goal * 1.08) : 120;

  const confidence = data?.confidence;
  const confColor = confidence === "HIGH" ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/30"
    : confidence === "MEDIUM" ? "text-amber-400 bg-amber-500/15 border-amber-500/30"
    : "text-rose-400 bg-rose-500/15 border-rose-500/30";

  const needle = useMemo(() => {
    if (targetAngle == null) return null;
    const tip = polar(targetAngle);
    const baseA = Math.PI - (targetAngle * Math.PI) / 180;
    const baseW = 8;
    const bx1 = CX + baseW * Math.cos(baseA - Math.PI / 2);
    const by1 = CY - baseW * Math.sin(baseA - Math.PI / 2);
    const bx2 = CX + baseW * Math.cos(baseA + Math.PI / 2);
    const by2 = CY - baseW * Math.sin(baseA + Math.PI / 2);
    return `M ${bx1} ${by1} L ${tip.x} ${tip.y} L ${bx2} ${by2} Z`;
  }, [targetAngle]);

  return (
    <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="rounded-lg bg-primary/10 border border-primary/20 p-1.5">
            <Target className="w-4 h-4 text-primary" />
          </div>
          <h3 className="font-display tracking-wide text-sm uppercase">Estimated {distance} Time</h3>
        </div>
        <div className="flex gap-1 rounded-lg bg-muted/40 p-1">
          {DISTANCES.map((d) => (
            <button
              key={d}
              onClick={() => setDistance(d)}
              className={cn(
                "text-xs px-2.5 py-1 rounded-md transition-colors",
                distance === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {d === "Half Marathon" ? "Half" : d === "Marathon" ? "Full" : d}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex justify-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-sm h-auto">
          {/* Background track */}
          <path d={arcPath(0, 180)} stroke="hsl(var(--muted))" strokeOpacity="0.25" strokeWidth="22" fill="none" strokeLinecap="round" />
          {/* Green band (best) */}
          <path d={arcPath(0, greenEnd)} stroke="hsl(142 70% 40%)" strokeWidth="22" fill="none" strokeLinecap="round" />
          {/* Amber band (target zone) */}
          {amberEnd > greenEnd && (
            <path d={arcPath(greenEnd, amberEnd)} stroke="hsl(38 80% 45%)" strokeWidth="22" fill="none" />
          )}
          {/* Red band (worst) */}
          {amberEnd < 180 && (
            <path d={arcPath(amberEnd, 180)} stroke="hsl(0 65% 40%)" strokeWidth="22" fill="none" strokeLinecap="round" />
          )}

          {/* Goal marker */}
          {goalAngle != null && (() => {
            const outer = polar(goalAngle);
            const a = Math.PI - (goalAngle * Math.PI) / 180;
            const inner = { x: CX + (R - 30) * Math.cos(a), y: CY - (R - 30) * Math.sin(a) };
            const label = { x: CX + (R + 18) * Math.cos(a), y: CY - (R + 18) * Math.sin(a) };
            return (
              <g>
                <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke="hsl(var(--foreground))" strokeWidth="2" />
                <text x={label.x} y={label.y} fill="hsl(var(--foreground))" fontSize="11" fontWeight="600" textAnchor="middle">
                  Goal {fmt(goal!)}
                </text>
              </g>
            );
          })()}

          {/* Needle */}
          {needle && (
            <>
              <path d={needle} fill="hsl(var(--primary))" />
              <circle cx={CX} cy={CY} r="6" fill="hsl(var(--primary))" />
            </>
          )}

          {/* Min/max labels */}
          <text x={polar(0).x - 4} y={CY + 16} fill="hsl(var(--muted-foreground))" fontSize="11" textAnchor="end">{fmt(minSec)}</text>
          <text x={polar(180).x + 4} y={CY + 16} fill="hsl(var(--muted-foreground))" fontSize="11" textAnchor="start">{fmt(maxSec)}</text>

          {/* Center label */}
          {data?.insufficient ? (
            <text x={CX} y={CY - 50} fill="hsl(var(--muted-foreground))" fontSize="12" textAnchor="middle">
              <tspan x={CX} dy="0">Complete more sessions</tspan>
              <tspan x={CX} dy="16">to unlock your estimate</tspan>
            </text>
          ) : target != null ? (
            <g>
              <text x={CX} y={CY - 60} fill="hsl(var(--foreground))" fontSize="26" fontWeight="700" textAnchor="middle">
                {fmt(target)}
              </text>
              <text x={CX} y={CY - 42} fill="hsl(var(--muted-foreground))" fontSize="11" textAnchor="middle">
                target
              </text>
            </g>
          ) : null}
        </svg>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/40 backdrop-blur-sm rounded-xl">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
        <div className="text-muted-foreground">
          {data?.planned_sessions ? (
            <>{data.completed_sessions} / {data.planned_sessions} planned sessions completed</>
          ) : (
            <>No plan progress yet</>
          )}
        </div>
        {!data?.insufficient && data?.conservative_sec != null && data?.stretch_sec != null && (
          <div className="flex items-center gap-3">
            <span className="text-emerald-400">Stretch {fmt(data.stretch_sec)}</span>
            <span className="text-rose-300">Safe {fmt(data.conservative_sec)}</span>
          </div>
        )}
        {confidence && (
          <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide", confColor)}>
            {confidence}
          </span>
        )}
      </div>
      {!data?.insufficient && data?.basis?.length ? (
        <div className="text-[11px] text-muted-foreground/80 -mt-2">Based on: {data.basis.join(" · ")}</div>
      ) : null}
    </div>
  );
}
