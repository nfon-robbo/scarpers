import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { calculateSleepScore } from "@/lib/sleep-score";
import { activityIntensityLoad } from "@/lib/readiness";

type FactorStatus = "good" | "warning" | "poor";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  label: string;
  status: FactorStatus;
  detail: string;
}

interface DayPoint {
  date: string;
  short: string;
  value: number | null;
}

interface Meta {
  unit: string;
  description: string;
  impact: string;
  goodWhen: string;
  // Optional reference lines (good/warning thresholds) on the chart
  goodLine?: number;
  warnLine?: number;
  // Render direction — for RHR/Stress lower is better
  lowerIsBetter?: boolean;
  // Y-domain override
  yDomain?: [number | "auto", number | "auto"];
}

const META: Record<string, Meta> = {
  "Sleep Quality": {
    unit: "/100",
    description: "Composite score from your sleep stages — deep, REM and total time spent in bed.",
    impact: "Contributes ~30% to the readiness score. Poor sleep is the single biggest readiness drag.",
    goodWhen: "≥80 is excellent, 60–79 is solid, below 60 starts to flag fatigue.",
    goodLine: 80,
    warnLine: 60,
    yDomain: [0, 100],
  },
  "Deep Sleep": {
    unit: "%",
    description: "Share of total sleep spent in deep (slow-wave) stages — the most physically restorative phase.",
    impact: "Low deep sleep blunts hormonal recovery and muscle repair, lowering readiness.",
    goodWhen: "13–23% of total sleep is the typical healthy range.",
    goodLine: 15,
    warnLine: 10,
    yDomain: [0, 30],
  },
  "Resting HR": {
    unit: " bpm",
    description: "Your lowest stable heart rate, usually measured overnight or first thing in the morning.",
    impact: "An RHR elevated above your baseline signals fatigue, illness or incomplete recovery.",
    goodWhen: "Within ±3 bpm of your 28-day baseline.",
    lowerIsBetter: true,
  },
  "HRV": {
    unit: " ms",
    description: "Heart Rate Variability — the variation between heartbeats. Higher = more parasympathetic recovery.",
    impact: "A drop versus baseline is a strong early warning of accumulated stress or under-recovery.",
    goodWhen: "At or above your 28-day baseline.",
  },
  "Stress": {
    unit: "/100",
    description: "Daily stress score derived from heart rate patterns through the day.",
    impact: "Sustained high stress reduces recovery quality and pushes readiness down.",
    goodWhen: "Below 40 is calm, 40–60 moderate, above 60 elevated.",
    lowerIsBetter: true,
    goodLine: 40,
    warnLine: 60,
    yDomain: [0, 100],
  },
  "Yesterday's Load": {
    unit: " min",
    description: "Intensity-weighted training load from yesterday's sessions.",
    impact: "A heavy yesterday means more recovery debt today — readiness adjusts down accordingly.",
    goodWhen: "Within your weekly average. Spikes >2× average increase injury risk.",
  },
  "Today's Effort": {
    unit: " min",
    description: "Intensity-weighted load already accumulated today.",
    impact: "Tracks how much of your daily capacity you've spent — affects how the rest of the day should look.",
    goodWhen: "Pace yourself relative to today's prescribed plan.",
  },
};

function fmt(n: number | null | undefined, decimals = 0): string {
  if (n == null || !isFinite(n as number)) return "—";
  const f = Math.pow(10, decimals);
  return (Math.round((n as number) * f) / f).toString();
}

function statusColor(status: FactorStatus): string {
  if (status === "good") return "hsl(142, 70%, 50%)";
  if (status === "warning") return "hsl(45, 95%, 55%)";
  return "hsl(0, 80%, 60%)";
}

const FactorDetailDialog = ({ open, onOpenChange, label, status, detail }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<DayPoint[]>([]);

  const meta = META[label];

  useEffect(() => {
    if (!open || !user || !meta) return;
    setLoading(true);

    const days: string[] = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      days.push(new Date(now.getTime() - i * 86400000).toISOString().split("T")[0]);
    }
    const startDate = days[0];

    Promise.all([
      supabase
        .from("daily_metrics")
        .select("date, resting_heart_rate, hrv, stress_score, sleep_score")
        .eq("user_id", user.id)
        .gte("date", startDate)
        .then(({ data }) => data || []),
      supabase
        .from("sleep_stages")
        .select("date, stage, duration_seconds")
        .eq("user_id", user.id)
        .gte("date", startDate)
        .then(({ data }) => data || []),
      supabase
        .from("activities")
        .select("start_time, duration_seconds, avg_heart_rate, training_load, training_effect")
        .eq("user_id", user.id)
        .gte("start_time", startDate + "T00:00:00Z")
        .then(({ data }) => data || []),
    ]).then(([metrics, stages, acts]) => {
      const mByDate = new Map<string, any>();
      (metrics as any[]).forEach((m) => mByDate.set(m.date, m));

      const stagesByDate = new Map<string, { deep: number; light: number; rem: number; total: number }>();
      (stages as any[]).forEach((s) => {
        const cur = stagesByDate.get(s.date) || { deep: 0, light: 0, rem: 0, total: 0 };
        const stage = (s.stage || "").toLowerCase();
        const dur = s.duration_seconds || 0;
        if (stage === "deep") cur.deep += dur;
        else if (stage === "light") cur.light += dur;
        else if (stage === "rem") cur.rem += dur;
        if (stage === "deep" || stage === "light" || stage === "rem") cur.total += dur;
        stagesByDate.set(s.date, cur);
      });

      const loadByDate = new Map<string, number>();
      (acts as any[]).forEach((a) => {
        if (!a.start_time) return;
        const d = a.start_time.split("T")[0];
        loadByDate.set(d, (loadByDate.get(d) || 0) + activityIntensityLoad(a));
      });

      const valueFor = (d: string): number | null => {
        switch (label) {
          case "Sleep Quality": {
            const s = stagesByDate.get(d);
            if (s && s.total > 0) return calculateSleepScore({ deep: s.deep, light: s.light, rem: s.rem, awake: 0, sleep: 0 });
            return mByDate.get(d)?.sleep_score ?? null;
          }
          case "Deep Sleep": {
            const s = stagesByDate.get(d);
            return s && s.total > 0 ? Math.round((s.deep / s.total) * 1000) / 10 : null;
          }
          case "Resting HR":
            return mByDate.get(d)?.resting_heart_rate ?? null;
          case "HRV":
            return mByDate.get(d)?.hrv ?? null;
          case "Stress":
            return mByDate.get(d)?.stress_score ?? null;
          case "Yesterday's Load":
          case "Today's Effort":
            return loadByDate.get(d) ?? null;
        }
        return null;
      };

      const pts: DayPoint[] = days.map((d) => {
        const dt = new Date(d);
        return {
          date: d,
          short: dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
          value: valueFor(d),
        };
      });
      setPoints(pts);
      setLoading(false);
    });
  }, [open, user, label, meta]);

  const stats = useMemo(() => {
    const nums = points.filter((p) => typeof p.value === "number").map((p) => p.value as number);
    if (nums.length === 0) return null;
    const last = [...points].reverse().find((p) => p.value != null)?.value ?? null;
    const baseline = nums.length >= 5 ? nums.slice(0, -1) : nums;
    const avg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    return { last, avg, min, max, count: nums.length };
  }, [points]);

  const color = statusColor(status);
  const gradId = `factor-grad-${label.replace(/\s+/g, "-")}`;

  if (!meta) return null;

  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p: DayPoint = payload[0].payload;
    return (
      <div className="rounded-md border border-border/60 bg-background/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
        <div className="font-medium text-foreground">{p.short}</div>
        <div className="text-muted-foreground">
          {p.value == null ? "no data" : `${fmt(p.value, 1)}${meta.unit}`}
        </div>
      </div>
    );
  };

  // Direction arrow vs baseline
  let trendNode: React.ReactNode = null;
  if (stats?.last != null && stats?.avg != null) {
    const diff = stats.last - stats.avg;
    const better = meta.lowerIsBetter ? diff < 0 : diff > 0;
    const sign = diff > 0 ? "+" : "";
    const Icon = Math.abs(diff) < 0.5 ? Minus : better ? TrendingUp : TrendingDown;
    const cls = Math.abs(diff) < 0.5 ? "text-muted-foreground" : better ? "text-emerald-500" : "text-red-500";
    trendNode = (
      <span className={`inline-flex items-center gap-1 ${cls}`}>
        <Icon className="w-3.5 h-3.5" />
        {sign}{fmt(diff, 1)}{meta.unit} vs avg
      </span>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {label}
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: color }}
              aria-label={status}
            />
          </DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary tiles */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Now</div>
                <div className="text-xl font-bold text-foreground mt-0.5">
                  {stats?.last != null ? `${stats.last}${meta.unit}` : "—"}
                </div>
                <div className="text-[10px] mt-0.5">{trendNode}</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">28-day avg</div>
                <div className="text-xl font-bold text-foreground mt-0.5">
                  {stats ? `${Math.round(stats.avg * 10) / 10}${meta.unit}` : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">baseline</div>
              </div>
              <div className="rounded-lg border border-border/40 bg-card/40 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Range</div>
                <div className="text-xl font-bold text-foreground mt-0.5">
                  {stats ? `${stats.min}–${stats.max}` : "—"}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">last 28 days</div>
              </div>
            </div>

            {/* Chart */}
            {stats && stats.count >= 2 ? (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                    <defs>
                      <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                        <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                    <XAxis
                      dataKey="short"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      interval={Math.ceil(points.length / 6)}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      domain={meta.yDomain ?? ["auto", "auto"]}
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      axisLine={false}
                      tickLine={false}
                      width={30}
                    />
                    <Tooltip content={renderTooltip} />
                    {meta.goodLine != null && (
                      <ReferenceLine
                        y={meta.goodLine}
                        stroke="hsl(142, 70%, 50%)"
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                        label={{ value: "good", position: "right", fill: "hsl(142, 70%, 50%)", fontSize: 9 }}
                      />
                    )}
                    {meta.warnLine != null && (
                      <ReferenceLine
                        y={meta.warnLine}
                        stroke="hsl(0, 75%, 55%)"
                        strokeDasharray="3 3"
                        strokeOpacity={0.5}
                        label={{ value: "warn", position: "right", fill: "hsl(0, 75%, 55%)", fontSize: 9 }}
                      />
                    )}
                    {stats?.avg != null && (
                      <ReferenceLine
                        y={stats.avg}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="2 4"
                        strokeOpacity={0.5}
                      />
                    )}
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke={color}
                      fill={`url(#${gradId})`}
                      strokeWidth={2}
                      dot={{ r: 2, fill: color }}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                Not enough history yet — keep syncing to see your 28-day trend.
              </p>
            )}

            {/* Explanation */}
            <div className="space-y-2 text-xs">
              <div className="rounded-md border border-border/40 bg-card/40 p-3">
                <div className="font-semibold text-foreground mb-1">Today's reading</div>
                <div className="text-muted-foreground">{detail}</div>
              </div>
              <div className="rounded-md border border-border/40 bg-card/40 p-3">
                <div className="font-semibold text-foreground mb-1">What "good" looks like</div>
                <div className="text-muted-foreground">{meta.goodWhen}</div>
              </div>
              <div className="rounded-md border border-border/40 bg-card/40 p-3">
                <div className="font-semibold text-foreground mb-1">Why it matters</div>
                <div className="text-muted-foreground">{meta.impact}</div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default FactorDetailDialog;
