import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";

// ── Inline Sparkline (7-day mini trend) ──
function Sparkline({ values, status }: { values: (number | null)[]; status: "good" | "warning" | "poor" }) {
  const clean = values.map((v) => (typeof v === "number" && isFinite(v) ? v : null));
  const nums = clean.filter((v): v is number => v != null);
  if (nums.length < 2) {
    return <div className="h-6 w-16 opacity-30 text-[10px] text-muted-foreground flex items-center justify-center">—</div>;
  }
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const w = 64;
  const h = 24;
  const stepX = w / (clean.length - 1);
  const color =
    status === "good" ? "hsl(142, 60%, 45%)" : status === "warning" ? "hsl(45, 90%, 50%)" : "hsl(0, 72%, 51%)";

  let lastY: number | null = null;
  const pts: string[] = [];
  clean.forEach((v, i) => {
    if (v == null) return;
    const x = i * stepX;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    pts.push(`${pts.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    lastY = y;
  });

  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible">
      <path d={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {lastY != null && (
        <circle cx={w} cy={lastY} r={2} fill={color} />
      )}
    </svg>
  );
}
import { calculateSleepScore } from "@/lib/sleep-score";
import {
  type ReadinessData,
  computeReadiness,
  groupSleepByDate,
  activityIntensityLoad,
  workoutIntensity,
} from "@/lib/readiness";
import { cn } from "@/lib/utils";

// ── Tick-mark Circular Gauge ──
function CircularGauge({ score, size = 220 }: { score: number; size?: number }) {
  const ticks = 60;
  const filled = Math.max(0, Math.min(ticks, Math.round((score / 100) * ticks)));
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR - 14;

  const color =
    score >= 80 ? "hsl(142, 70%, 50%)" : score > 30 ? "hsl(180, 80%, 55%)" : "hsl(0, 75%, 55%)";

  const label = score >= 80 ? "Excellent" : score >= 60 ? "Good" : score > 30 ? "Moderate" : "Low";
  const sub = score >= 80 ? "Fully recovered" : score >= 60 ? "Train as planned" : score > 30 ? "Ready to train" : "Prioritise rest";

  const tickEls = [];
  for (let i = 0; i < ticks; i++) {
    // Start from bottom-left, sweep clockwise around — rotate so 0 is at bottom-left
    const angle = (-225 + (i / (ticks - 1)) * 270) * (Math.PI / 180);
    const x1 = cx + Math.cos(angle) * innerR;
    const y1 = cy + Math.sin(angle) * innerR;
    const x2 = cx + Math.cos(angle) * outerR;
    const y2 = cy + Math.sin(angle) * outerR;
    const active = i < filled;
    tickEls.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={active ? color : "hsl(var(--muted-foreground) / 0.18)"}
        strokeWidth={2}
        strokeLinecap="round"
      />
    );
  }

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ filter: `drop-shadow(0 0 16px ${color}33)` }}>
        {tickEls}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-6xl font-black tracking-tight text-foreground leading-none">{score}</span>
        <span className="text-sm font-semibold mt-2" style={{ color }}>{label}</span>
        <span className="text-[11px] text-muted-foreground mt-0.5">{sub}</span>
      </div>
    </div>
  );
}

// ── Zone Bar (0-30 red, 31-79 yellow, 80-100 green) ──
function ZoneBar({ score }: { score: number }) {
  const label = score >= 80 ? "HIGH" : score > 30 ? "MEDIUM" : "LOW";
  const labelColor = score >= 80 ? "text-emerald-600 dark:text-emerald-400" : score > 30 ? "text-yellow-600 dark:text-yellow-400" : "text-red-600 dark:text-red-400";

  // Position the indicator (0-100 mapped to percentage)
  const position = `${score}%`;

  return (
    <div className="w-full space-y-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground">{score}</span>
        <span className={cn("text-sm font-semibold", labelColor)}>{label}</span>
      </div>
      <div className="relative">
        {/* Zone bar */}
        <div className="flex h-2.5 rounded-full overflow-hidden">
          <div className="flex-[30] bg-red-500/80" />
          <div className="flex-[49] bg-yellow-500/80" />
          <div className="flex-[21] bg-emerald-500/80" />
        </div>
        {/* Indicator triangle */}
        <div
          className="absolute -top-1 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[6px] border-l-transparent border-r-transparent border-b-foreground transition-all duration-700"
          style={{ left: position, transform: "translateX(-5px)" }}
        />
        {/* Zone labels */}
        <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
          <span>0–30</span>
          <span>31–79</span>
          <span>80–100</span>
        </div>
      </div>
    </div>
  );
}

// ── Factor row ──
const statusIcon = (s: "good" | "warning" | "poor") => {
  if (s === "good") return <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />;
  if (s === "warning") return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />;
  return <AlertTriangle className="w-3.5 h-3.5 text-destructive" />;
};

const ReadinessWidget = () => {
  const { user } = useAuth();
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [sparklines, setSparklines] = useState<Record<string, (number | null)[]>>({});
  const [trend, setTrend] = useState<{ day: string; score: number }[]>([]);


  useEffect(() => {
    if (!user) return;
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split("T")[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const twentyEightDaysAgo = new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0];

    Promise.all([
      supabase
        .from("sleep_stages")
        .select("stage, duration_seconds, date, end_time")
        .eq("user_id", user.id)
        .in("date", [today, yesterday])
        .then(({ data }) => data || []),
      supabase
        .from("daily_metrics")
        .select("date, resting_heart_rate, hrv, stress_score, sleep_score, sleep_duration_seconds")
        .eq("user_id", user.id)
        .gte("date", twentyEightDaysAgo)
        .order("date", { ascending: true })
        .then(({ data }) => data || []),
      supabase
        .from("activities")
        .select("duration_seconds, start_time, avg_heart_rate, training_load, training_effect")
        .eq("user_id", user.id)
        .gte("start_time", twentyEightDaysAgo + "T00:00:00Z")
        .order("start_time", { ascending: false })
        .then(({ data }) => data || []),
    ]).then(([sleepStages, allMetrics, allActivities]) => {
      const stages = groupSleepByDate(sleepStages as any);
      const totalSleep = stages.deep + stages.light + stages.rem;
      const hasSleepStages = totalSleep > 0;
      const sleepScore = hasSleepStages ? calculateSleepScore(stages) : null;

      const todayMetrics = allMetrics.find((m: any) => m.date === today);
      const yesterdayMetrics = allMetrics.find((m: any) => m.date === yesterday);
      const latestMetrics = todayMetrics || yesterdayMetrics;

      const baseline = allMetrics.filter((m: any) => m.date < today);
      const rhrVals = baseline.filter((m: any) => m.resting_heart_rate).map((m: any) => m.resting_heart_rate);
      const hrvVals = baseline.filter((m: any) => m.hrv).map((m: any) => m.hrv);
      const rhrBaseline = rhrVals.length ? rhrVals.reduce((a: number, b: number) => a + b, 0) / rhrVals.length : null;
      const hrvBaseline = hrvVals.length ? hrvVals.reduce((a: number, b: number) => a + b, 0) / hrvVals.length : null;

      const sleepDates = [...new Set((sleepStages as any[]).map((s: any) => s.date))].sort().reverse();
      const mostRecentSleepDate = sleepDates[0] || null;
      const isSleepCurrent = mostRecentSleepDate && (mostRecentSleepDate === today || mostRecentSleepDate === yesterday);
      const finalSleepScore = isSleepCurrent ? (sleepScore ?? (latestMetrics as any)?.sleep_score ?? null) : null;
      const sleepDuration = isSleepCurrent && hasSleepStages ? totalSleep : isSleepCurrent ? ((latestMetrics as any)?.sleep_duration_seconds ?? null) : null;

      const recentMetrics = allMetrics.filter((m: any) => m.date >= threeDaysAgo && m.date <= today);
      const recentSleepSecs = recentMetrics.filter((m: any) => m.sleep_duration_seconds).map((m: any) => m.sleep_duration_seconds);
      const recentSleepAvgHours = recentSleepSecs.length ? (recentSleepSecs.reduce((a: number, b: number) => a + b, 0) / recentSleepSecs.length) / 3600 : null;

      const allSleepSecs = baseline.filter((m: any) => m.sleep_duration_seconds).map((m: any) => m.sleep_duration_seconds);
      const baselineSleepAvgHours = allSleepSecs.length ? (allSleepSecs.reduce((a: number, b: number) => a + b, 0) / allSleepSecs.length) / 3600 : null;

      const stressHistory = recentMetrics
        .filter((m: any) => m.stress_score != null)
        .map((m: any) => m.stress_score as number);

      const yesterdayActs = allActivities.filter((a: any) => {
        const d = a.start_time?.split("T")[0];
        return d === yesterday;
      });
      const todayActs = allActivities.filter((a: any) => {
        const d = a.start_time?.split("T")[0];
        return d === today;
      });

      const yesterdayLoad = yesterdayActs.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);
      const todayLoad = todayActs.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);

      let recoveryHours: number | null = null;
      let lastIntensity: number | null = null;
      if (allActivities.length > 0) {
        const last = allActivities[0];
        if (last.start_time) {
          const endMs = new Date(last.start_time).getTime() + ((last.duration_seconds || 0) * 1000);
          recoveryHours = (Date.now() - endMs) / (1000 * 3600);
          lastIntensity = workoutIntensity(last);
        }
      }

      const sevenDayActs = allActivities.filter((a: any) => a.start_time && a.start_time >= sevenDaysAgo + "T00:00:00Z");
      const weeklyTotal = sevenDayActs.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);
      const monthlyTotal = allActivities.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);

      const weeklyLoadAvg = weeklyTotal / 7;
      const monthlyLoadAvg = monthlyTotal / 28;

      // Determine wake time from sleep stages (latest end_time on most recent date)
      const todaySleepStages = (sleepStages as any[]).filter((s: any) => s.date === today || s.date === yesterday);
      const endTimes = todaySleepStages
        .filter((s: any) => s.end_time)
        .map((s: any) => new Date(s.end_time).getTime())
        .sort((a: number, b: number) => b - a);
      const wakeTimeIso = endTimes.length > 0 ? new Date(endTimes[0]).toISOString() : null;

      // Build today's activity list with timestamps for drain model
      const todayActivityList = todayActs.map((a: any) => ({
        startIso: a.start_time as string,
        durationSec: a.duration_seconds || 0,
        intensityLoad: activityIntensityLoad(a),
      }));

      setData({
        sleepScore: finalSleepScore,
        sleepHours: sleepDuration ? sleepDuration / 3600 : null,
        deepPct: hasSleepStages && totalSleep > 0 ? (stages.deep / totalSleep) * 100 : null,
        remPct: hasSleepStages && totalSleep > 0 ? (stages.rem / totalSleep) * 100 : null,
        rhr: (latestMetrics as any)?.resting_heart_rate ?? null,
        rhrBaseline,
        hrv: (latestMetrics as any)?.hrv ?? null,
        hrvBaseline,
        yesterdayLoad: yesterdayLoad > 0 ? yesterdayLoad : null,
        stressScore: (latestMetrics as any)?.stress_score ?? null,
        todayLoad: todayLoad > 0 ? todayLoad : null,
        recoveryHoursSinceLastHard: recoveryHours,
        lastWorkoutIntensity: lastIntensity,
        recentSleepAvgHours,
        baselineSleepAvgHours,
        stressHistory,
        weeklyLoadAvg: weeklyTotal > 0 ? weeklyLoadAvg : null,
        monthlyLoadAvg: monthlyTotal > 0 ? monthlyLoadAvg : null,
        currentHour: now.getHours(),
        wakeTimeIso,
        todayActivities: todayActivityList,
      });
      setLoading(false);
    });
  }, [user]);

  // Build 7-day sparkline series + readiness trend
  useEffect(() => {
    if (!user) return;
    const today = new Date();
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      days.push(new Date(today.getTime() - i * 86400000).toISOString().split("T")[0]);
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
      supabase
        .from("readiness_snapshots")
        .select("score, recorded_at")
        .eq("user_id", user.id)
        .gte("recorded_at", startDate + "T00:00:00Z")
        .order("recorded_at", { ascending: true })
        .then(({ data }) => data || []),
    ]).then(([metrics, stages, acts, snaps]) => {
      const mByDate = new Map<string, any>();
      (metrics as any[]).forEach((m) => mByDate.set(m.date, m));

      // Deep % per date
      const stagesByDate = new Map<string, { deep: number; total: number }>();
      (stages as any[]).forEach((s) => {
        const cur = stagesByDate.get(s.date) || { deep: 0, total: 0 };
        cur.total += s.duration_seconds || 0;
        if ((s.stage || "").toLowerCase() === "deep") cur.deep += s.duration_seconds || 0;
        stagesByDate.set(s.date, cur);
      });

      // Daily load
      const loadByDate = new Map<string, number>();
      (acts as any[]).forEach((a) => {
        if (!a.start_time) return;
        const d = a.start_time.split("T")[0];
        const load = activityIntensityLoad(a);
        loadByDate.set(d, (loadByDate.get(d) || 0) + load);
      });

      const series: Record<string, (number | null)[]> = {
        "Sleep Quality": days.map((d) => mByDate.get(d)?.sleep_score ?? null),
        "Deep Sleep": days.map((d) => {
          const s = stagesByDate.get(d);
          return s && s.total > 0 ? (s.deep / s.total) * 100 : null;
        }),
        "Resting HR": days.map((d) => mByDate.get(d)?.resting_heart_rate ?? null),
        "HRV": days.map((d) => mByDate.get(d)?.hrv ?? null),
        "Stress": days.map((d) => mByDate.get(d)?.stress_score ?? null),
        "Yesterday's Load": days.map((d) => loadByDate.get(d) ?? null),
        "Today's Effort": days.map((d) => loadByDate.get(d) ?? null),
      };
      setSparklines(series);

      // Build daily avg snapshot trend
      const byDay = new Map<string, number[]>();
      (snaps as any[]).forEach((s) => {
        const d = s.recorded_at.split("T")[0];
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d)!.push(s.score);
      });
      const trendArr = days.map((d) => {
        const vals = byDay.get(d);
        return {
          day: new Date(d).toLocaleDateString(undefined, { weekday: "short" }).charAt(0),
          score: vals ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0,
        };
      });
      setTrend(trendArr);
    });
  }, [user]);


  const result = useMemo(() => data ? computeReadiness(data) : null, [data]);
  const displayResult = result ?? {
    score: 50,
    factors: [
      { label: "Sleep Quality", status: "warning" as const, detail: "Waiting for sync" },
      { label: "Resting HR", status: "warning" as const, detail: "Waiting for sync" },
      { label: "HRV", status: "warning" as const, detail: "Waiting for sync" },
    ],
  };
  const isFallback = loading || !result;

  // Save snapshot (throttled: max once per hour, prevent StrictMode duplicates)
  useEffect(() => {
    if (!result || !user) return;
    const cacheKey = `readiness_snapshot_last_${user.id}`;
    const last = localStorage.getItem(cacheKey);
    const now = Date.now();
    if (last && now - Number(last) < 3600000) return; // 1 hour throttle

    // Set immediately to prevent duplicate from StrictMode re-mount
    localStorage.setItem(cacheKey, String(now));

    const hour = new Date().getHours();
    supabase
      .from("readiness_snapshots")
      .insert({
        user_id: user.id,
        score: result.score,
        hour,
        factors: result.factors as any,
        recorded_at: new Date().toISOString(),
      })
      .then(({ error }) => {
        if (error) localStorage.removeItem(cacheKey); // rollback on failure
      });
  }, [result, user]);

  const fetchAdvice = async (skipCache = false) => {
    if (!result || result.factors.length === 0) return;

    const cacheKey = "readiness_advice_cache";
    if (!skipCache) {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try {
          const { advice, score, factorCount, timestamp } = JSON.parse(cached);
          const ageMs = Date.now() - timestamp;
          const oneHour = 60 * 60 * 1000;
          if (ageMs < oneHour && score === result.score && factorCount === result.factors.length) {
            setAiAdvice(advice);
            return;
          }
        } catch { /* invalid cache, refetch */ }
      }
    }

    setAiLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/readiness-advice`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            readiness_score: result.score,
            factors: result.factors,
            current_hour_local: new Date().getHours(),
            missing_data: result.factors
              .filter(f => f.status === "warning" && f.detail === "Not synced")
              .map(f => f.label.toLowerCase()),
          }),
        }
      );

      if (resp.ok) {
        const data = await resp.json();
        setAiAdvice(data.advice);
        localStorage.setItem(cacheKey, JSON.stringify({
          advice: data.advice,
          score: result.score,
          factorCount: result.factors.length,
          timestamp: Date.now(),
        }));
      } else {
        setAiAdvice("");
      }
    } catch {
      setAiAdvice("");
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    fetchAdvice();
  }, [result]);

  // Helper: split detail "primary · sub" into two parts
  const splitDetail = (detail: string): { primary: string; sub: string | null } => {
    const parts = detail.split(/\s·\s/);
    if (parts.length >= 2) return { primary: parts[0], sub: parts.slice(1).join(" · ") };
    // Try "(label)" pattern: "59/100 (Fair)"
    const m = detail.match(/^(.+?)\s*\(([^)]+)\)\s*(.*)$/);
    if (m) return { primary: `${m[1].trim()}${m[3] ? " " + m[3].trim() : ""}`, sub: m[2] };
    return { primary: detail, sub: null };
  };

  const updatedTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const hasTrend = trend.filter((t) => t.score > 0).length >= 2;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Main Readiness Card */}
      <Card className="border-border/40 overflow-hidden relative bg-[#0b1220] text-white [&_.text-foreground]:text-white [&_.text-muted-foreground]:text-slate-400">
        <CardContent className="p-5 relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Readiness</h3>
            <span className="text-[11px] text-muted-foreground">Updated {updatedTime}</span>
          </div>

          <div className="flex flex-col md:flex-row gap-5">
            {/* Left column: gauge + 7-day trend */}
            <div className="flex flex-col items-stretch shrink-0 md:w-[200px] gap-3">
              <div className="flex items-center justify-center">
                <CircularGauge score={displayResult.score} size={200} />
              </div>
              {isFallback && (
                <p className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Waiting for data
                </p>
              )}
              {hasTrend && (
                <div className="rounded-xl bg-[#111a2e] border border-border/30 p-3">
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground mb-1">7 Day Trend</h4>
                  <ResponsiveContainer width="100%" height={64}>
                    <AreaChart data={trend} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                      <defs>
                        <linearGradient id="readinessTrendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(180, 80%, 55%)" stopOpacity={0.4} />
                          <stop offset="100%" stopColor="hsl(180, 80%, 55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="day" tick={{ fontSize: 9 }} className="fill-muted-foreground" axisLine={false} tickLine={false} interval={0} />
                      <YAxis domain={[0, 100]} hide />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                      />
                      <Area type="monotone" dataKey="score" stroke="hsl(180, 80%, 55%)" fill="url(#readinessTrendGrad)" strokeWidth={2} dot={{ r: 2, fill: "hsl(180, 80%, 55%)" }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Right column: metrics list */}
            <div className="flex-1 min-w-0 rounded-xl bg-[#111a2e] border border-border/30 divide-y divide-border/30">
              {displayResult.factors.map((f) => {
                const spark = sparklines[f.label];
                const { primary, sub } = splitDetail(f.detail);
                const subColor =
                  f.status === "good"
                    ? "text-emerald-500"
                    : f.status === "poor"
                    ? "text-destructive"
                    : "text-muted-foreground";
                return (
                  <div key={f.label} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                    <div className="shrink-0">{statusIcon(f.status)}</div>
                    <span className="text-foreground font-medium truncate flex-1 min-w-0">{f.label}</span>
                    <div className="shrink-0">
                      {spark ? <Sparkline values={spark} status={f.status} /> : <div className="w-16" />}
                    </div>
                    <div className="text-right shrink-0 min-w-[72px]">
                      <div className="text-foreground font-semibold text-xs leading-tight">{primary}</div>
                      {sub && <div className={`text-[10px] leading-tight mt-0.5 ${subColor}`}>{sub}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Insight Card */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Daily Readiness Insight</h3>
            {!aiLoading && aiAdvice && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => fetchAdvice(true)}
                title="Refresh advice"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          {isFallback ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your readiness score will appear here once sleep, HRV, resting heart rate or activity data has synced.
            </p>
          ) : aiLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Coach is thinking...
            </p>
          ) : aiAdvice ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{aiAdvice}</p>
          ) : (
            <div className="text-sm text-muted-foreground space-y-2">
              {result.score <= 20 ? (
                <p>Mate, your body is absolutely cooked. Put the trainers down and go lie on the sofa. 🛋️</p>
              ) : (
                <>
                  <p className="font-medium text-foreground">
                    Score: {displayResult.score}/100 — {displayResult.score >= 80 ? "Well recovered" : displayResult.score > 50 ? "Moderate readiness" : displayResult.score > 30 ? "Below average" : "Low readiness"}
                  </p>
                  <div className="space-y-0.5 text-xs">
                    {displayResult.factors.map((f) => (
                      <div key={f.label} className="flex justify-between">
                        <span>{f.label}</span>
                        <span className="font-mono">{f.detail}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wake Readiness Score + Zone Bar */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Wake Readiness</h3>
          <ZoneBar score={displayResult.score} />

          {/* Sleep contribution */}
          {data?.sleepHours != null && (
            <div className="flex items-center justify-between text-sm rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">🌙 Sleep</span>
              <span className="font-medium">+{Math.round((data.sleepScore || 0) * 0.3)} · {data.sleepHours.toFixed(1)}h</span>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
};

export default ReadinessWidget;
