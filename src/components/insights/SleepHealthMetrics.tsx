import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Activity, Droplet, Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, Wind, HeartPulse } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";

interface Row {
  date: string;
  spo2_avg: number | null;
  spo2_lowest: number | null;
  restless_count: number | null;
  breathing_pattern: string | null;
  respiration_avg: number | null;
  hrv: number | null;
  hrv_7d_trend: string | null;
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
};

const fmt = (d: string) => {
  try { return format(parseISO(d), "dd MMM"); } catch { return d; }
};

const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

// Simple trend: compare first half avg vs second half avg
const trendOf = (vals: number[]): "up" | "down" | "stable" => {
  if (vals.length < 4) return "stable";
  const mid = Math.floor(vals.length / 2);
  const a = avg(vals.slice(0, mid))!;
  const b = avg(vals.slice(mid))!;
  const diff = b - a;
  const pct = Math.abs(diff) / Math.max(a, 1);
  if (pct < 0.03) return "stable";
  return diff > 0 ? "up" : "down";
};

const TrendIcon = ({ dir }: { dir: "up" | "down" | "stable" }) => {
  if (dir === "up") return <TrendingUp className="w-3.5 h-3.5" />;
  if (dir === "down") return <TrendingDown className="w-3.5 h-3.5" />;
  return <Minus className="w-3.5 h-3.5" />;
};

const SleepHealthMetrics = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const since = subDays(new Date(), 30).toISOString().split("T")[0];
    supabase
      .from("daily_metrics")
      .select("date, spo2_avg, spo2_lowest, restless_count, breathing_pattern, respiration_avg, hrv, hrv_7d_trend")
      .eq("user_id", user.id)
      .gte("date", since)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setRows((data as Row[]) || []);
        setLoading(false);
      });
  }, [user]);

  const spo2 = useMemo(() => {
    const data = rows
      .filter(r => r.spo2_avg != null)
      .map(r => ({
        date: fmt(r.date),
        avg: Number(r.spo2_avg),
        low: r.spo2_lowest != null ? Number(r.spo2_lowest) : null,
      }));
    const avgs = data.map(d => d.avg);
    const lows = data.filter(d => d.low != null).map(d => d.low as number);
    const recentAvg = avg(avgs.slice(-7));
    const recentLow = avg(lows.slice(-7));
    const trend = trendOf(avgs.slice(-14));
    return { data, recentAvg, recentLow, trend };
  }, [rows]);

  const restless = useMemo(() => {
    const data = rows
      .filter(r => r.restless_count != null)
      .map(r => ({ date: fmt(r.date), count: Number(r.restless_count) }));
    const counts = data.map(d => d.count);
    const recentAvg = avg(counts.slice(-7));
    const trend = trendOf(counts.slice(-14));
    return { data, recentAvg, trend };
  }, [rows]);

  const breathing = useMemo(() => {
    const recent = rows.filter(r => r.breathing_pattern || r.respiration_avg != null).slice(-7);
    if (recent.length === 0) return null;
    const patterns = recent.map(r => (r.breathing_pattern || "").toLowerCase()).filter(Boolean);
    const counts: Record<string, number> = {};
    patterns.forEach(p => { counts[p] = (counts[p] || 0) + 1; });
    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const resps = recent.filter(r => r.respiration_avg != null).map(r => Number(r.respiration_avg));
    const avgResp = avg(resps);
    return { dominant, avgResp, days: recent.length };
  }, [rows]);

  const hrv7 = useMemo(() => {
    const withHrv = rows.filter(r => r.hrv != null).map(r => Number(r.hrv));
    const last7 = withHrv.slice(-7);
    const prev7 = withHrv.slice(-14, -7);
    const avg7 = avg(last7);
    const avgPrev = avg(prev7);
    const trendLabel = rows.slice(-1)[0]?.hrv_7d_trend || null;
    return { avg7, avgPrev, trendLabel, count: last7.length };
  }, [rows]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (spo2.data.length === 0 && restless.data.length === 0 && !breathing && hrv7.avg7 == null) return null;

  const spo2Color = spo2.recentAvg == null
    ? "hsl(var(--muted-foreground))"
    : spo2.recentAvg >= 95 ? "hsl(var(--primary))"
    : spo2.recentAvg >= 90 ? "hsl(var(--accent))"
    : "hsl(var(--destructive))";

  const spo2Label = spo2.recentAvg == null ? "—"
    : spo2.recentAvg >= 95 ? "Excellent"
    : spo2.recentAvg >= 90 ? "Moderate"
    : "Low";

  const restColor = restless.recentAvg == null
    ? "hsl(var(--muted-foreground))"
    : restless.recentAvg < 40 ? "hsl(var(--primary))"
    : restless.recentAvg <= 80 ? "hsl(var(--accent))"
    : "hsl(var(--destructive))";

  const restLabel = restless.recentAvg == null ? "—"
    : restless.recentAvg < 40 ? "Excellent consolidation"
    : restless.recentAvg <= 80 ? "Moderate fragmentation"
    : "High fragmentation";

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Sleep Health Metrics
        </CardTitle>
        <CardDescription>Respiratory & restlessness trends from advanced sleep tracking</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {spo2.data.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Droplet className="w-4 h-4 text-primary" />
                <h4 className="text-sm font-semibold">Blood Oxygen (SpO₂)</h4>
              </div>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={spo2.data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
                <YAxis domain={[80, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} formatter={(v: number, n: string) => [`${v}%`, n === "avg" ? "Average" : "Lowest"]} />
                <ReferenceLine y={92} stroke="hsl(var(--destructive))" strokeDasharray="4 4" strokeOpacity={0.4} />
                <Line type="monotone" dataKey="avg" stroke={spo2Color} strokeWidth={2} dot={{ r: 2.5 }} name="avg" />
                <Line type="monotone" dataKey="low" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} name="low" connectNulls />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              {spo2.recentAvg != null && (
                <span>Recent avg: <span className="font-semibold" style={{ color: spo2Color }}>{spo2.recentAvg.toFixed(1)}% {spo2Label}</span></span>
              )}
              {spo2.recentLow != null && (
                <span className="text-muted-foreground">Recent low: <span className="font-medium text-foreground">{spo2.recentLow.toFixed(1)}%</span></span>
              )}
              <span className="text-muted-foreground inline-flex items-center gap-1">
                Trend: <TrendIcon dir={spo2.trend} /> {spo2.trend === "up" ? "Improving" : spo2.trend === "down" ? "Declining" : "Stable"}
              </span>
            </div>
            {spo2.recentAvg != null && spo2.recentAvg < 92 && (
              <div className="mt-2 flex items-start gap-2 p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Low oxygen levels detected — consider speaking to a clinician about sleep apnea screening.</span>
              </div>
            )}
          </div>
        )}

        {restless.data.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-accent" />
                <h4 className="text-sm font-semibold">Sleep Restlessness</h4>
              </div>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={restless.data}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} formatter={(v: number) => [`${v} periods`, "Restless"]} />
                <ReferenceLine y={40} stroke="hsl(var(--primary))" strokeDasharray="4 4" strokeOpacity={0.3} />
                <ReferenceLine y={80} stroke="hsl(var(--destructive))" strokeDasharray="4 4" strokeOpacity={0.3} />
                <Line type="monotone" dataKey="count" stroke={restColor} strokeWidth={2} dot={{ r: 2.5 }} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              {restless.recentAvg != null && (
                <span>Recent avg: <span className="font-semibold" style={{ color: restColor }}>{Math.round(restless.recentAvg)} periods · {restLabel}</span></span>
              )}
              <span className="text-muted-foreground inline-flex items-center gap-1">
                Trend: <TrendIcon dir={restless.trend} /> {restless.trend === "up" ? "Increasing" : restless.trend === "down" ? "Decreasing" : "Stable"}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5 italic">Peaks often align with hard training days or stress.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SleepHealthMetrics;
