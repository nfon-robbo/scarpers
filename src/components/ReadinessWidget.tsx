import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, ReferenceArea } from "recharts";

// ── Inline Sparkline (7-day mini trend) ──
export type SparkPoint = { date: string; value: number | null };
type TrendSnapshot = { recorded_at: string; score: number; sleepSynced: boolean; awakeHours: number | null; kind: "morning" | "eod" };

function formatSparkValue(label: string, v: number): string {
  if (label === "Deep Sleep") return `${v.toFixed(1)}%`;
  if (label === "Resting HR") return `${Math.round(v)} bpm`;
  if (label === "HRV") return `${Math.round(v)} ms`;
  if (label === "Sleep Quality") return `${Math.round(v)}/100`;
  if (label === "Yesterday's Load" || label === "Today's Effort") return `${Math.round(v)} min`;
  if (label === "Stress") return `${Math.round(v)}`;
  if (label === "Body Battery") return `${Math.round(v)}% charge`;
  return `${Math.round(v)}`;
}

function extractSnapshotValidity(factors: any[]): Pick<TrendSnapshot, "sleepSynced" | "awakeHours"> {
  const sleepFactor = Array.isArray(factors) ? factors.find((f: any) => f?.label === "Sleep Quality") : null;
  const bodyBattery = Array.isArray(factors) ? factors.find((f: any) => f?.label === "Body Battery") : null;
  const awakeMatch = String(bodyBattery?.detail ?? "").match(/\(([\d.]+)h awake\)/);
  return {
    sleepSynced: !!sleepFactor && sleepFactor.detail !== "Not synced" && !String(sleepFactor.detail ?? "").includes("Waiting for sync"),
    awakeHours: awakeMatch ? Number(awakeMatch[1]) : null,
  };
}

function Sparkline({ points, status, label }: { points: SparkPoint[]; status: "good" | "warning" | "poor"; label: string }) {
  const nums = points.filter((p) => typeof p.value === "number" && isFinite(p.value as number)) as { date: string; value: number }[];
  if (nums.length < 2) {
    return <div className="h-7 w-20 text-[10px] text-slate-500 italic flex items-center justify-center">no data</div>;
  }
  const vals = nums.map((p) => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || Math.max(1, Math.abs(max) * 0.1);
  const w = 80;
  const h = 28;
  const padY = 4;
  const stepX = points.length > 1 ? w / (points.length - 1) : 0;
  const color =
    status === "good" ? "hsl(142, 70%, 50%)" : status === "warning" ? "hsl(45, 95%, 55%)" : "hsl(0, 80%, 60%)";

  const coords: { x: number; y: number; p: SparkPoint }[] = [];
  points.forEach((p, i) => {
    if (p.value == null) return;
    const x = i * stepX;
    const y = h - padY - ((p.value - min) / range) * (h - padY * 2);
    coords.push({ x, y, p });
  });

  const pathD = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg width={w} height={h} className="shrink-0 overflow-visible">
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {last && <circle cx={last.x} cy={last.y} r={2.5} fill={color} />}
      {/* hover hit areas with native tooltip */}
      {coords.map((c, i) => {
        const d = new Date(c.p.date);
        const dateLabel = d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
        return (
          <g key={i}>
            <circle cx={c.x} cy={c.y} r={2} fill={color} opacity={0.7} />
            <circle cx={c.x} cy={c.y} r={8} fill="transparent" className="cursor-pointer hover:fill-white/5">
              <title>{`${dateLabel} — ${formatSparkValue(label, c.p.value as number)}`}</title>
            </circle>
          </g>
        );
      })}
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
import { AUTO_SYNC_STARTED, AUTO_SYNC_DONE, isAutoSyncDoneThisSession } from "@/lib/auto-sync";
import BodyBattery48hDialog from "./BodyBattery48hDialog";
import FactorDetailDialog from "./FactorDetailDialog";

// ── Tick-mark Circular Gauge ──
function CircularGauge({ score, size = 220, statusLabel, subNode }: { score: number; size?: number; statusLabel: string; subNode: React.ReactNode }) {
  const ticks = 60;
  const filled = Math.max(0, Math.min(ticks, Math.round((score / 100) * ticks)));
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size / 2 - 4;
  const innerR = outerR - 14;

  const color =
    score >= 80 ? "hsl(142, 70%, 50%)" : score > 30 ? "hsl(180, 80%, 55%)" : "hsl(0, 75%, 55%)";

  const tickEls = [];
  for (let i = 0; i < ticks; i++) {
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
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span className="text-6xl font-black tracking-tight text-foreground leading-none">{score}</span>
        <span className="text-sm font-semibold mt-2" style={{ color }}>{statusLabel}</span>
        <div className="mt-1 text-[11px] text-slate-400 leading-snug">{subNode}</div>
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

interface ReadinessWidgetProps {
  todayContext?: {
    isRestDay: boolean;
    workoutMinutes: number | null;
    workoutTitle: string | null;
    completedToday: boolean;
  };
  onReviewPlan?: () => void;
}

const ReadinessWidget = ({ todayContext, onReviewPlan }: ReadinessWidgetProps = {}) => {
  const { user } = useAuth();
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiAdvice, setAiAdvice] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [sparklines, setSparklines] = useState<Record<string, SparkPoint[]>>({});
  const [trendMode, setTrendMode] = useState<"end" | "morning" | "today">("end");
  const [trendSnapshots, setTrendSnapshots] = useState<TrendSnapshot[]>([]);
  const [trend, setTrend] = useState<{ day: string; score: number | null; hour?: number }[]>([]);
  const [cached, setCached] = useState<{ score: number; factors: any[]; advice: string | null; recordedAt: Date } | null>(null);
  const [coachInsight, setCoachInsight] = useState<{ insight: string; recommendation: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [cacheChecked, setCacheChecked] = useState(false);
  const [batteryDialogOpen, setBatteryDialogOpen] = useState(false);
  const [factorDialog, setFactorDialog] = useState<{ label: string; status: "good" | "warning" | "poor"; detail: string } | null>(null);
  const [autoSyncing, setAutoSyncing] = useState<boolean>(() => {
    // If user is mid-session and auto-sync hasn't finished yet, assume in
    // progress so we show the awaiting stamp immediately on mount.
    return false;
  });

  // Listen for the global auto-sync lifecycle so we can show "awaiting"
  // stamps and re-fetch when fresh data lands.
  useEffect(() => {
    const onStart = () => setAutoSyncing(true);
    const onDone = () => {
      setAutoSyncing(false);
      // Force fresh recompute now that we (hopefully) have new data.
      setRefreshNonce((n) => n + 1);
    };
    window.addEventListener(AUTO_SYNC_STARTED, onStart);
    window.addEventListener(AUTO_SYNC_DONE, onDone);
    return () => {
      window.removeEventListener(AUTO_SYNC_STARTED, onStart);
      window.removeEventListener(AUTO_SYNC_DONE, onDone);
    };
  }, []);

  // Check DB cache for readiness snapshot < 60 min old (skipped when user forces refresh)
  useEffect(() => {
    if (!user) return;
    setCacheChecked(false);
    setCached(null);
    setCoachInsight(null);
    (async () => {
      if (refreshNonce === 0) {
        const { data: snap } = await supabase
          .from("readiness_snapshots")
          .select("score, factors, advice, insight, recommendation, recorded_at")
          .eq("user_id", user.id)
          .eq("kind", "eod")
          .order("recorded_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (snap) {
          const recordedAt = new Date((snap as any).recorded_at);
          const ageMin = (Date.now() - recordedAt.getTime()) / 60000;
          if (ageMin < 60) {
            setCached({
              score: (snap as any).score,
              factors: ((snap as any).factors as any[]) || [],
              advice: (snap as any).advice ?? null,
              recordedAt,
            });
            setAiAdvice((snap as any).advice ?? null);
            const ins = (snap as any).insight as string | null;
            const rec = (snap as any).recommendation as string | null;
            if (ins || rec) {
              setCoachInsight({ insight: ins || "", recommendation: rec || "" });
            } else {
              // Backfill: cached snapshot predates insight columns, fetch now
              try {
                const { data: { session } } = await supabase.auth.getSession();
                const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/readiness-coach-insight`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
                  body: JSON.stringify({ score: (snap as any).score, factors: (snap as any).factors || [] }),
                });
                if (resp.ok) {
                  const d = await resp.json();
                  const newIns = d.insight || "";
                  const newRec = d.recommendation || "";
                  if (newIns || newRec) {
                    setCoachInsight({ insight: newIns, recommendation: newRec });
                    await supabase.from("readiness_snapshots").update({ insight: newIns || null, recommendation: newRec || null } as any).eq("user_id", user.id).eq("recorded_at", (snap as any).recorded_at);
                  }
                }
              } catch (e) { console.error("Backfill insight failed", e); }
            }
            setLastUpdated(recordedAt);
          }
        }
      }
      setCacheChecked(true);
    })();
  }, [user, refreshNonce]);

  useEffect(() => {
    if (!user || !cacheChecked) return;
    if (cached && cached.advice) return;
    setLoading(true);
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
        .select("date, resting_heart_rate, hrv, stress_score, sleep_score, sleep_duration_seconds, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, awake_during_night_minutes")
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
      const todaysStageRows = (sleepStages as any[]).filter((s: any) => s.date === today);
      const stages = groupSleepByDate(todaysStageRows as any);
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

      const metricDeepSeconds = ((todayMetrics as any)?.deep_sleep_minutes ?? null) != null ? Number((todayMetrics as any).deep_sleep_minutes) * 60 : null;
      const metricRemSeconds = ((todayMetrics as any)?.rem_sleep_minutes ?? null) != null ? Number((todayMetrics as any).rem_sleep_minutes) * 60 : null;
      const metricLightSeconds = ((todayMetrics as any)?.light_sleep_minutes ?? null) != null ? Number((todayMetrics as any).light_sleep_minutes) * 60 : null;
      const metricStageTotal = [metricDeepSeconds, metricRemSeconds, metricLightSeconds].every((v) => typeof v === "number" && v > 0)
        ? (metricDeepSeconds as number) + (metricRemSeconds as number) + (metricLightSeconds as number)
        : null;
      const finalSleepScore = sleepScore ?? (todayMetrics as any)?.sleep_score ?? null;
      const sleepDuration = hasSleepStages ? totalSleep : ((todayMetrics as any)?.sleep_duration_seconds ?? null);

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
      const endTimes = todaysStageRows
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
        deepPct: hasSleepStages && totalSleep > 0 ? (stages.deep / totalSleep) * 100 : metricStageTotal ? ((metricDeepSeconds as number) / metricStageTotal) * 100 : null,
        remPct: hasSleepStages && totalSleep > 0 ? (stages.rem / totalSleep) * 100 : metricStageTotal ? ((metricRemSeconds as number) / metricStageTotal) * 100 : null,
        rhr: (todayMetrics as any)?.resting_heart_rate ?? null,
        rhrBaseline,
        hrv: (todayMetrics as any)?.hrv ?? null,
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
  }, [user, cacheChecked, cached, refreshNonce]);

  // Build 7-day sparkline series + readiness trend
  useEffect(() => {
    if (!user) return;
    const today = new Date();
    // Rolling 7-day window
    const days: string[] = [];
    const dayMs = 86400000;
    const totalDays = 7;
    for (let i = totalDays - 1; i >= 0; i--) {
      days.push(new Date(today.getTime() - i * dayMs).toISOString().split("T")[0]);
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
        .select("score, factors, recorded_at, kind")
        .eq("user_id", user.id)
        .gte("recorded_at", startDate + "T00:00:00Z")
        .order("recorded_at", { ascending: true })
        .then(({ data }) => data || []),
    ]).then(([metrics, stages, acts, snaps]) => {
      const mByDate = new Map<string, any>();
      (metrics as any[]).forEach((m) => mByDate.set(m.date, m));

      // Per-date sleep stage aggregation (deep/light/rem/total)
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

      // Daily load
      const loadByDate = new Map<string, number>();
      (acts as any[]).forEach((a) => {
        if (!a.start_time) return;
        const d = a.start_time.split("T")[0];
        const load = activityIntensityLoad(a);
        loadByDate.set(d, (loadByDate.get(d) || 0) + load);
      });

      const toPoints = (fn: (d: string) => number | null): SparkPoint[] =>
        days.map((d) => ({ date: d, value: fn(d) }));

      const series: Record<string, SparkPoint[]> = {
        "Sleep Quality": toPoints((d) => {
          const s = stagesByDate.get(d);
          if (s && s.total > 0) return calculateSleepScore({ deep: s.deep, light: s.light, rem: s.rem, awake: 0, sleep: 0 });
          return mByDate.get(d)?.sleep_score ?? null;
        }),
        "Deep Sleep": toPoints((d) => {
          const s = stagesByDate.get(d);
          return s && s.total > 0 ? (s.deep / s.total) * 100 : null;
        }),
        "Resting HR": toPoints((d) => mByDate.get(d)?.resting_heart_rate ?? null),
        "HRV": toPoints((d) => mByDate.get(d)?.hrv ?? null),
        "Stress": toPoints((d) => mByDate.get(d)?.stress_score ?? null),
        "Yesterday's Load": toPoints((d) => loadByDate.get(d) ?? null),
        "Today's Effort": toPoints((d) => loadByDate.get(d) ?? null),
        "Body Battery": toPoints((d) => {
          const load = loadByDate.get(d);
          const isToday = d === days[days.length - 1];
          // Passive drain: today uses current hours awake, past days assume full 16h waking day
          let hoursAwake = 16;
          if (isToday) {
            const now = new Date();
            const wake = new Date(now);
            wake.setHours(7, 0, 0, 0);
            hoursAwake = Math.min(20, Math.max(0, (now.getTime() - wake.getTime()) / 3600000));
          }
          let passive = 0;
          if (hoursAwake <= 4) passive = hoursAwake;
          else if (hoursAwake <= 8) passive = 4 + (hoursAwake - 4) * 1.5;
          else if (hoursAwake <= 12) passive = 10 + (hoursAwake - 8) * 2;
          else if (hoursAwake <= 16) passive = 18 + (hoursAwake - 12) * 2.5;
          else passive = 28 + (hoursAwake - 16) * 3;
          const active = load != null ? Math.min(10, load * 0.1) : 0;
          if (!isToday && load == null) return null;
          return Math.max(0, Math.min(100, Math.round(100 - (passive + active))));
        }),
      };
      setSparklines(series);

      // Store raw snapshots; trend is recomputed in a separate effect when mode changes
      setTrendSnapshots((snaps as any[]).map((s) => {
        const validity = extractSnapshotValidity(s.factors as any[]);
        return { recorded_at: s.recorded_at, score: s.score, kind: (s.kind === "morning" ? "morning" : "eod") as "morning" | "eod", ...validity };
      }));
    });
  }, [user, refreshNonce]);

  // Auto-reload snapshots when the page becomes visible or regains focus,
  // so the chart never shows stale scores after a tab switch or data change.
  useEffect(() => {
    const reload = () => setRefreshNonce((n) => n + 1);
    const onVisibility = () => { if (document.visibilityState === "visible") reload(); };
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Recompute the trend whenever raw snapshots or display mode changes
  useEffect(() => {
    const today = new Date();

    if (trendMode === "today") {
      // Hourly view for the current calendar day — every snapshot, in order.
      // Match snapshots by LOCAL calendar date so timezone offsets don't hide today's data.
      const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const todays = trendSnapshots
        .filter((s) => {
          const d = new Date(s.recorded_at);
          const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          return local === localToday;
        })
        .slice()
        .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
      const trendArr = todays.map((s) => {
        const d = new Date(s.recorded_at);
        const hourFloat = d.getHours() + d.getMinutes() / 60;
        return {
          day: `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`,
          hour: hourFloat,
          score: s.score,
        };
      });
      setTrend(trendArr);
      return;
    }

    const dayMs = 86400000;
    const totalDays = 7;
    const days: string[] = [];
    for (let i = totalDays - 1; i >= 0; i--) {
      days.push(new Date(today.getTime() - i * dayMs).toISOString().split("T")[0]);
    }
    const byDay = new Map<string, TrendSnapshot[]>();
    trendSnapshots.forEach((s) => {
      const d = s.recorded_at.split("T")[0];
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d)!.push(s);
    });
    const trendArr = days.map((d) => {
      const rows = (byDay.get(d) || []).slice().sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));
      let pick: TrendSnapshot | undefined;
      if (rows.length) {
        const wantedKind: "morning" | "eod" = trendMode === "morning" ? "morning" : "eod";
        const matching = rows.filter((r) => r.kind === wantedKind);
        if (matching.length) {
          // Morning = earliest matching; EOD = latest matching
          pick = wantedKind === "morning" ? matching[0] : matching[matching.length - 1];
        }
      }
      return {
        day: new Date(d).toLocaleDateString(undefined, { weekday: "short" }),
        score: pick ? pick.score : null,
      };
    });
    setTrend(trendArr);
  }, [trendSnapshots, trendMode]);

  const result = useMemo(() => data ? computeReadiness(data) : null, [data]);

  // Essentials needed for a real readiness score. While auto-sync is in
  // flight (or hasn't started yet this session) and any of these are
  // missing, we suppress the score and show an "awaiting" stamp instead of
  // a misleading low number driven by missing-data fallbacks.
  const awaiting = useMemo<string[]>(() => {
    if (!data) return [];
    const items: string[] = [];
    if (data.sleepScore == null) items.push("sleep score");
    if (data.sleepHours == null) items.push("sleep duration");
    if (data.deepPct == null) items.push("deep sleep");
    if (data.rhr == null) items.push("resting heart rate");
    if (data.hrv == null) items.push("HRV");
    return items;
  }, [data]);

  // Suppress the score (and snapshot writes) whenever any of the five
  // required inputs are missing. We never persist or display a readiness
  // score derived from default-penalty fallbacks — instead we surface a
  // "waiting for data" stamp so the user knows what's outstanding.
  const suppressScore = awaiting.length > 0;

  const displayResult = cached
    ? { score: cached.score, factors: cached.factors as { label: string; status: "good" | "warning" | "poor"; detail: string }[] }
    : (result ?? {
        score: 50,
        factors: [
          { label: "Sleep Quality", status: "warning" as const, detail: "Waiting for sync" },
          { label: "Resting HR", status: "warning" as const, detail: "Waiting for sync" },
          { label: "HRV", status: "warning" as const, detail: "Waiting for sync" },
        ],
      });
  const isFallback = !cached && (loading || !result);

  // Fresh-path: when computed result is ready (and no cache), fetch AI advice + insert snapshot
  useEffect(() => {
    if (!result || !user) return;
    if (cached && cached.advice) return;
    if (suppressScore) return; // don't persist a misleading low score while we're still syncing
    let cancelled = false;
    (async () => {
      setAiLoading(true);
      let advice: string | null = null;
      let insight = "";
      let recommendation = "";
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        };
        const baseBody = {
          readiness_score: result.score,
          factors: result.factors,
          current_hour_local: new Date().getHours(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          missing_data: result.factors
            .filter(f => f.status === "warning" && f.detail === "Not synced")
            .map(f => f.label.toLowerCase()),
        };
        const [adviceResp, insightResp] = await Promise.all([
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/readiness-advice`, {
            method: "POST", headers, body: JSON.stringify(baseBody),
          }),
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/readiness-coach-insight`, {
            method: "POST", headers,
            body: JSON.stringify({ readiness_score: result.score, factors: result.factors }),
          }),
        ]);
        if (adviceResp.ok) {
          const d = await adviceResp.json();
          advice = d.advice ?? null;
        }
        if (insightResp.ok) {
          const d = await insightResp.json();
          insight = d.insight || "";
          recommendation = d.recommendation || "";
        }
      } catch { /* swallow */ }
      if (cancelled) return;
      setAiAdvice(advice ?? "");
      if (insight || recommendation) setCoachInsight({ insight, recommendation });
      setAiLoading(false);
      const recordedAt = new Date();
      setLastUpdated(recordedAt);
      // Persist EOD snapshot (the live algorithm includes all daytime modifiers)
      await supabase.from("readiness_snapshots").insert({
        user_id: user.id,
        score: result.score,
        hour: recordedAt.getHours(),
        factors: result.factors as any,
        advice,
        insight: insight || null,
        recommendation: recommendation || null,
        recorded_at: recordedAt.toISOString(),
        kind: "eod",
      } as any);

      // Also persist a morning snapshot for today if one isn't already stored
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: existingMorning } = await supabase
        .from("readiness_snapshots")
        .select("id")
        .eq("user_id", user.id)
        .eq("kind", "morning")
        .gte("recorded_at", todayStart.toISOString())
        .limit(1)
        .maybeSingle();
      if (!existingMorning && data) {
        const morning = computeReadiness(data, "morning");
        const forbidden = ["Body Battery", "Today's Effort", "Sleep Debt"];
        const bad = morning.factors.find((f) => forbidden.includes(f.label));
        if (bad) {
          console.error(`[readiness] rejected mislabeled morning snapshot: contains "${bad.label}"`, morning.factors);
        } else {
          await supabase.from("readiness_snapshots").insert({
            user_id: user.id,
            score: morning.score,
            hour: recordedAt.getHours(),
            factors: morning.factors as any,
            advice: null,
            recorded_at: recordedAt.toISOString(),
            kind: "morning",
          } as any);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [result, user, cached, suppressScore]);

  // Helper: split detail "primary · sub" into two parts
  const splitDetail = (detail: string): { primary: string; sub: string | null } => {
    const parts = detail.split(/\s·\s/);
    if (parts.length >= 2) return { primary: parts[0], sub: parts.slice(1).join(" · ") };
    // Try "(label)" pattern: "59/100 (Fair)"
    const m = detail.match(/^(.+?)\s*\(([^)]+)\)\s*(.*)$/);
    if (m) return { primary: `${m[1].trim()}${m[3] ? " " + m[3].trim() : ""}`, sub: m[2] };
    return { primary: detail, sub: null };
  };

  const formatUpdated = (d: Date | null): string => {
    if (!d) return "—";
    const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m ago`;
  };
  const updatedLabel = formatUpdated(lastUpdated);
  const handleManualRefresh = () => {
    setLastUpdated(null);
    setAiAdvice(null);
    setAiLoading(true);
    setData(null);
    setRefreshNonce((n) => n + 1);
  };
  const visibleTrend = useMemo(() => {
    if (trend.some((t) => t.score != null) || suppressScore) return trend;
    const todayLabel = new Date().toLocaleDateString(undefined, { weekday: "short" });
    if (!trend.length) return [{ day: todayLabel, score: displayResult.score }];
    return trend.map((t, i) => (i === trend.length - 1 ? { ...t, score: displayResult.score } : t));
  }, [trend, suppressScore, displayResult.score]);
  const hasTrend = visibleTrend.some((t) => t.score != null);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Main Readiness Card */}
      <Card className="border-border/40 overflow-hidden relative bg-[#0b1220] text-white [&_.text-foreground]:text-white [&_.text-muted-foreground]:text-slate-400">
        <CardContent className="p-5 relative z-10">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold uppercase tracking-[0.15em] text-muted-foreground">Readiness</h3>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Updated {updatedLabel}</span>
              <button
                type="button"
                onClick={handleManualRefresh}
                disabled={isFallback || aiLoading}
                title="Recalculate now"
                aria-label="Recalculate readiness"
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className={cn("w-3 h-3", (isFallback || aiLoading) && "animate-spin")} />
              </button>
            </div>
          </div>

          {(() => {
            // Compute dynamic status label + sub-message
            const score = displayResult.score;
            const statusLabel = score >= 80 ? "Excellent" : score >= 60 ? "Good" : score > 30 ? "Moderate" : "Low";

            let message = "";
            let showReview = false;
            const ctx = todayContext;
            if (score >= 80) {
              if (ctx?.completedToday) message = "Recovery on track";
              else if (ctx && !ctx.isRestDay && ctx.workoutMinutes) message = `Ready for your ${ctx.workoutMinutes}-min session`;
              else if (ctx && !ctx.isRestDay) message = "Ready for today's workout";
              else message = "Fully recovered — up to 90 min easy";
            } else if (score >= 60) {
              if (ctx?.completedToday) message = "Nice work — stay hydrated";
              else if (ctx && !ctx.isRestDay && ctx.workoutMinutes) message = `Cleared for ${ctx.workoutMinutes}-min session`;
              else if (ctx && !ctx.isRestDay) message = "Cleared for today's session";
              else message = "Easy session OK (≤45 min)";
            } else if (score > 30) {
              if (ctx?.completedToday) message = "Prioritise recovery now";
              else if (ctx && !ctx.isRestDay) { message = "Today may be tough"; showReview = true; }
              else message = "Active recovery only";
            } else {
              message = "You may be struggling today";
              showReview = true;
            }

            const subNode = (
              <div className="flex flex-col items-center gap-1">
                <span className="text-slate-400 text-[11px] leading-snug">{message}</span>
                {showReview && onReviewPlan && (
                  <button
                    type="button"
                    onClick={onReviewPlan}
                    className="text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                  >
                    Review today's plan →
                  </button>
                )}
              </div>
            );

            return (
              <div className="flex flex-col md:flex-row gap-5">
                {/* Left column: gauge + 7-day trend */}
                <div className="flex flex-col items-stretch shrink-0 md:w-[360px] gap-4">
                  <div className="relative flex items-center justify-center">
                    <div className={cn(suppressScore && "opacity-25 blur-[1px]")}>
                      <CircularGauge score={score} size={200} statusLabel={statusLabel} subNode={subNode} />
                    </div>
                    {suppressScore && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="rotate-[-8deg] border-2 border-yellow-400/80 rounded-md px-3 py-2 bg-yellow-400/10 backdrop-blur-sm shadow-lg max-w-[200px] text-center">
                          <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-yellow-300 flex items-center justify-center gap-1.5">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Waiting for data
                          </div>
                          <div className="text-[11px] font-semibold text-yellow-100 leading-tight mt-1">
                            {awaiting.join(" · ")}
                          </div>
                          <div className="text-[9px] font-normal text-yellow-200/80 leading-snug mt-1.5 normal-case tracking-normal">
                            Check back shortly once your watch has synced.
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {isFallback && !suppressScore && (
                    <p className="flex items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Waiting for data
                    </p>
                  )}
              {(hasTrend || trendMode === "today") && (() => {
                // Use only valid (non-null) trend points for direction analysis
                const validPts = visibleTrend.filter((t) => t.score != null) as { day: string; score: number }[];
                const last3 = validPts.slice(-3).map((t) => t.score);
                let trendLabel: "Recovering" | "Stable" | "Declining" | "At Risk" = "Stable";
                let trendColor = "text-slate-300";
                if (last3.length >= 3) {
                  const [a, b, c] = last3;
                  const delta = c - a;
                  const strictlyDown = a > b && b > c;
                  if (strictlyDown && c < 40) { trendLabel = "At Risk"; trendColor = "text-red-400"; }
                  else if (strictlyDown) { trendLabel = "Declining"; trendColor = "text-amber-400"; }
                  else if (delta >= 5 && c >= b) { trendLabel = "Recovering"; trendColor = "text-emerald-400"; }
                  else { trendLabel = "Stable"; trendColor = "text-slate-300"; }
                }

                // Count consecutive declining days from the end
                let declineStreak = 0;
                for (let i = validPts.length - 1; i > 0; i--) {
                  if (validPts[i].score < validPts[i - 1].score) declineStreak++;
                  else break;
                }
                const showDeclineTip = declineStreak >= 3;

                return (
                <div className="rounded-xl bg-[#111a2e] border border-border/30 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-foreground">Readiness Trend</h4>
                    <div className="flex items-center gap-2">
                      <div className="inline-flex rounded-md bg-white/5 border border-border/40 p-0.5">
                        <button
                          type="button"
                          onClick={() => setTrendMode("end")}
                          className={cn(
                            "px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-sm transition-colors",
                            trendMode === "end" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          End of day
                        </button>
                        <button
                          type="button"
                          onClick={() => setTrendMode("morning")}
                          className={cn(
                            "px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-sm transition-colors",
                            trendMode === "morning" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          Morning
                        </button>
                        <button
                          type="button"
                          onClick={() => setTrendMode("today")}
                          className={cn(
                            "px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider rounded-sm transition-colors",
                            trendMode === "today" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
                          )}
                        >
                          Today
                        </button>
                      </div>
                      <span className={cn("text-[10px] font-bold uppercase tracking-[0.1em]", trendColor)}>{trendLabel}</span>
                    </div>
                  </div>
                  {trendMode === "morning" && (
                    <p className="text-[9px] text-muted-foreground/70 italic mb-2 -mt-1">
                      Morning score is taken after sleep data has synced to ensure accuracy.
                    </p>
                  )}
                  {trendMode === "today" && (
                    <p className="text-[9px] text-muted-foreground/70 italic mb-2 -mt-1">
                      Hourly snapshots taken throughout today.
                    </p>
                  )}
                  {trendMode === "today" ? (() => {
                    const allTodayPts = visibleTrend.filter((t: any) => t.score != null && typeof t.hour === "number");
                    // Dedupe: if two snapshots are within 5 min (~0.0833h), keep the more recent one.
                    const todayPts = allTodayPts.filter((p: any, i: number) => {
                      const next = allTodayPts[i + 1];
                      return !next || (next.hour - p.hour) > (5 / 60);
                    });
                    const zoneFor = (s: number) => {
                      if (s < 30) return { color: "hsl(0, 75%, 55%)", label: "Low", text: "text-red-400" };
                      if (s < 55) return { color: "hsl(38, 95%, 55%)", label: "Fair", text: "text-amber-400" };
                      if (s < 80) return { color: "hsl(142, 70%, 50%)", label: "Good", text: "text-emerald-400" };
                      return { color: "hsl(210, 95%, 62%)", label: "Peak", text: "text-sky-400" };
                    };
                    if (todayPts.length === 0) {
                      return (
                        <div className="h-[160px] flex items-center justify-center text-center px-4">
                          <p className="text-[11px] font-semibold lowercase text-muted-foreground/80 leading-snug">
                            still waiting for data
                          </p>
                        </div>
                      );
                    }
                    const first = todayPts[0];
                    const last = todayPts[todayPts.length - 1];
                    const z = zoneFor(last.score);
                    const delta = last.score - first.score;
                    const ArrowIcon = delta > 0 ? "▲" : delta < 0 ? "▼" : "■";
                    const arrowClass = delta > 0 ? "text-emerald-400" : delta < 0 ? "text-red-400" : "text-muted-foreground";
                    if (todayPts.length < 3) {
                      return (
                        <div className="rounded-xl border border-border/40 bg-card/30 px-4 py-5 text-center">
                          <div className="text-3xl font-bold text-foreground leading-none">{Math.round(last.score)}</div>
                          <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-wider", z.text)}>{z.label}</div>
                          <p className="mt-3 text-[11px] text-muted-foreground leading-snug">
                            Score recorded at {last.day} — check back later as more data builds throughout the day.
                          </p>
                        </div>
                      );
                    }
                    // dynamic x domain: 30 min before first, 30 min after last (or now)
                    const now = new Date();
                    const nowHour = now.getHours() + now.getMinutes() / 60;
                    const xMin = Math.max(0, first.hour - 0.5);
                    const xMax = Math.min(24, Math.max(last.hour, nowHour) + 0.5);
                    const scores = todayPts.map((p: any) => p.score);
                    const yMin = Math.max(0, Math.floor(Math.min(...scores) - 10));
                    const yMax = Math.min(100, Math.ceil(Math.max(...scores) + 10));
                    return (
                      <>
                        <div className="flex items-end justify-between mb-2 px-1">
                          <div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-4xl font-bold text-foreground leading-none">{Math.round(last.score)}</span>
                              <span className={cn("text-sm font-semibold", arrowClass)}>
                                {ArrowIcon} {delta > 0 ? "+" : ""}{Math.round(delta)}
                              </span>
                            </div>
                            <div className={cn("mt-1 text-[10px] font-semibold uppercase tracking-wider", z.text)}>{z.label}</div>
                          </div>
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                          <AreaChart data={todayPts} margin={{ top: 8, right: 40, bottom: 0, left: 4 }}>
                            <defs>
                              <linearGradient id="readinessTodayGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor={z.color} stopOpacity={0.4} />
                                <stop offset="100%" stopColor={z.color} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.25} vertical={false} />
                            <XAxis
                              dataKey="hour"
                              type="number"
                              domain={[xMin, xMax]}
                              tick={{ fontSize: 10 }}
                              className="fill-muted-foreground"
                              axisLine={false}
                              tickLine={false}
                              tickFormatter={(v: any) => {
                                const h = Math.floor(Number(v));
                                const m = Math.round((Number(v) - h) * 60);
                                return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                              }}
                            />
                            <YAxis domain={[0, 100]} type="number" hide />
                            <Tooltip
                              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                              labelFormatter={(_l: any, payload: any) => {
                                const d = payload?.[0]?.payload?.day;
                                return d ? `Time: ${d}` : "";
                              }}
                              formatter={(value: any) => [`${Math.round(Number(value))}`, "Readiness"]}
                            />
                            <ReferenceLine
                              y={last.score}
                              stroke={z.color}
                              strokeDasharray="3 3"
                              strokeOpacity={0.7}
                              label={{ value: String(Math.round(last.score)), position: "right", fill: z.color, fontSize: 11, fontWeight: 700 }}
                            />
                            <Area
                              type="monotone"
                              dataKey="score"
                              stroke={z.color}
                              fill="url(#readinessTodayGrad)"
                              strokeWidth={2.5}
                              dot={{ r: 5, fill: z.color, stroke: "hsl(var(--background))", strokeWidth: 2 }}
                              activeDot={{ r: 7 }}
                              isAnimationActive={false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                        <p className="mt-2 text-[10px] text-muted-foreground/80">
                          {todayPts.length} snapshot{todayPts.length === 1 ? "" : "s"} today · last at {last.day}
                        </p>
                      </>
                    );
                  })() : (
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={visibleTrend} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
                      <defs>
                        <linearGradient id="readinessTrendGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(180, 80%, 55%)" stopOpacity={0.5} />
                          <stop offset="100%" stopColor="hsl(180, 80%, 55%)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <ReferenceArea y1={0} y2={30} fill="hsl(0, 70%, 50%)" fillOpacity={0.28} ifOverflow="hidden" />
                      <ReferenceArea y1={30} y2={55} fill="hsl(38, 90%, 55%)" fillOpacity={0.25} ifOverflow="hidden" />
                      <ReferenceArea y1={55} y2={80} fill="hsl(142, 70%, 45%)" fillOpacity={0.25} ifOverflow="hidden" />
                      <ReferenceArea y1={80} y2={100} fill="hsl(210, 90%, 60%)" fillOpacity={0.28} ifOverflow="hidden" />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 10 }}
                        className="fill-muted-foreground"
                        axisLine={false}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis domain={[0, 100]} type="number" allowDataOverflow={false} hide />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(value: any) => [`${Math.round(Number(value))}`, "Readiness"]}
                      />
                      <Area type="monotone" dataKey="score" stroke="hsl(180, 90%, 60%)" fill="url(#readinessTrendGrad)" strokeWidth={2.5} dot={{ r: 3, fill: "hsl(180, 90%, 60%)" }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                  )}
                  {showDeclineTip && (
                    <p className="mt-2 text-[10px] leading-snug text-amber-300/90">
                      Your readiness has been declining for {declineStreak} days. Check your sleep and consider an easy session today.
                    </p>
                  )}
                </div>
                );
              })()}
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
                const isBattery = f.label === "Body Battery";
                const hasDetail = isBattery || [
                  "Sleep Quality",
                  "Deep Sleep",
                  "Resting HR",
                  "HRV",
                  "Stress",
                  "Yesterday's Load",
                  "Today's Effort",
                ].includes(f.label);
                const rowContent = (
                  <>
                    {/* Row 1 (mobile) / left cells (desktop): icon + title */}
                    <div className="flex items-center gap-2 sm:contents">
                      <div className="shrink-0 sm:block">{statusIcon(f.status)}</div>
                      <span className="text-foreground font-medium truncate">
                        {f.label}
                        {hasDetail && <span className="ml-1.5 text-[10px] font-normal text-cyan-400">tap →</span>}
                      </span>
                    </div>
                    {/* Row 2 (mobile) / right cells (desktop): sparkline + score */}
                    <div className="flex items-center justify-between gap-3 pl-7 sm:contents sm:pl-0">
                      <div className="flex sm:justify-center">
                        {spark ? <Sparkline points={spark} status={f.status} label={f.label} /> : <div className="w-20 h-7" />}
                      </div>
                      <div className="text-right">
                        <div className="text-foreground font-semibold text-xs leading-tight">{primary}</div>
                        {sub && <div className={`text-[10px] leading-tight mt-0.5 ${subColor}`}>{sub}</div>}
                      </div>
                    </div>
                  </>
                );
                if (hasDetail) {
                  return (
                    <button
                      key={f.label}
                      type="button"
                      onClick={() =>
                        isBattery
                          ? setBatteryDialogOpen(true)
                          : setFactorDialog({ label: f.label, status: f.status, detail: f.detail })
                      }
                      className="w-full text-left px-3 py-2.5 text-sm space-y-1.5 sm:space-y-0 sm:grid sm:grid-cols-[20px_minmax(0,1fr)_88px_104px] sm:items-center sm:gap-3 hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      {rowContent}
                    </button>
                  );
                }
                return (
                  <div key={f.label} className="px-3 py-2.5 text-sm space-y-1.5 sm:space-y-0 sm:grid sm:grid-cols-[20px_minmax(0,1fr)_88px_104px] sm:items-center sm:gap-3">
                    {rowContent}
                  </div>
                );
              })}
              {(() => {
                const score = displayResult.score;
                if (suppressScore) return null;

                const sleepPts = (sparklines["Sleep Quality"] || []).filter(p => typeof p.value === "number") as { value: number }[];
                const hrvPts = (sparklines["HRV"] || []).filter(p => typeof p.value === "number") as { value: number }[];
                const avgSleep = sleepPts.length >= 3 ? sleepPts.reduce((a, p) => a + (p.value as number), 0) / sleepPts.length : null;
                const todayLoad = data?.todayLoad ?? 0;

                // ── Recovery Countdown ──
                let recoveryLine: string | null = null;
                let recoverySecondary: string | null = null;
                if (score >= 70) {
                  recoveryLine = "You are recovered and ready.";
                  recoverySecondary = todayLoad > 60
                    ? "Keep effort moderate today to protect tomorrow's score."
                    : "A quality session is well within reach today.";
                } else {
                  const overnightCharge = avgSleep != null ? (avgSleep / 100) * 60 : null;
                  if (overnightCharge != null && overnightCharge > 5) {
                    const gap = 70 - score;
                    const nights = Math.max(1, Math.ceil(gap / overnightCharge));
                    const now = new Date();
                    const wake = new Date(now);
                    wake.setHours(7, 0, 0, 0);
                    if (wake.getTime() <= now.getTime()) wake.setDate(wake.getDate() + 1);
                    const hoursToWake = (wake.getTime() - now.getTime()) / 3600000;
                    const totalHours = Math.round(hoursToWake + (nights - 1) * 24);
                    recoveryLine = `Estimated recovery to 70+ in approximately ${totalHours} hours.`;
                    recoverySecondary = nights > 1
                      ? `Expect about ${nights} solid nights of sleep before you bounce back fully.`
                      : "Prioritise an early bedtime and you should wake refreshed.";
                  }
                }

                // ── Tomorrow's Forecast ──
                let forecastLine: string | null = null;
                let forecastSecondary: string | null = null;
                if (avgSleep != null) {
                  const sleepDelta = (avgSleep - 50) * 0.4;
                  const loadDrain = Math.min(20, todayLoad * 0.08);
                  let hrvDelta = 0;
                  let hrvTrendUp = false;
                  let hrvTrendDown = false;
                  if (hrvPts.length >= 3) {
                    const avgHrv = hrvPts.reduce((a, p) => a + (p.value as number), 0) / hrvPts.length;
                    const latestHrv = hrvPts[hrvPts.length - 1].value as number;
                    hrvDelta = ((latestHrv - avgHrv) / Math.max(1, avgHrv)) * 30;
                    hrvTrendUp = latestHrv > avgHrv * 1.05;
                    hrvTrendDown = latestHrv < avgHrv * 0.95;
                  }
                  let debtDelta = 0;
                  if (data?.recentSleepAvgHours != null && data?.baselineSleepAvgHours != null) {
                    debtDelta = (data.recentSleepAvgHours - data.baselineSleepAvgHours) * 4;
                  }
                  const projected = Math.max(0, Math.min(100, Math.round(score + sleepDelta - loadDrain + hrvDelta + debtDelta - (score - 50) * 0.3)));
                  const dir = projected > score + 2 ? " trending up" : projected < score - 2 ? " trending down" : " stable";
                  forecastLine = `Tomorrow's forecast: approximately ${projected}.${dir}.`;
                  // Pick the dominant driver
                  if (loadDrain >= 8) {
                    forecastSecondary = "Today's training load is the main drag, so refuel and rest well tonight.";
                  } else if (hrvTrendDown) {
                    forecastSecondary = "HRV is trending below your average, suggesting recovery is still incomplete.";
                  } else if (hrvTrendUp && avgSleep >= 65) {
                    forecastSecondary = "Strong HRV and steady sleep are setting you up for a productive session.";
                  } else if (avgSleep < 50) {
                    forecastSecondary = "Sleep quality has been the limiter — an earlier night should lift the score.";
                  } else {
                    forecastSecondary = "Maintain your current sleep and recovery habits to hold this trajectory.";
                  }
                }

                if (!recoveryLine && !forecastLine) return null;
                return (
                  <div className="px-3 py-3 border-t border-border/40 bg-[#0d1525]/60 space-y-2.5">
                    {recoveryLine && (
                      <div className="text-xs leading-snug text-slate-200 space-y-0.5">
                        <p>
                          <span className="font-semibold text-cyan-300">Recovery: </span>
                          {recoveryLine}
                        </p>
                        {recoverySecondary && <p className="text-slate-400">{recoverySecondary}</p>}
                      </div>
                    )}
                    {forecastLine && (
                      <div className="text-xs leading-snug text-slate-200 space-y-0.5">
                        <p>
                          <span className="font-semibold text-cyan-300">Forecast: </span>
                          {forecastLine}
                        </p>
                        {forecastSecondary && <p className="text-slate-400">{forecastSecondary}</p>}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
            );
          })()}
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
                onClick={handleManualRefresh}
                title="Refresh advice"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          {aiLoading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Coach Claire Rayners is thinking...
            </p>
          ) : isFallback ? (
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your readiness score will appear here once sleep, HRV, resting heart rate or activity data has synced.
            </p>
          ) : aiAdvice ? (
            <p className="text-sm text-muted-foreground leading-relaxed">{aiAdvice}</p>
          ) : (
            <div className="text-sm text-muted-foreground space-y-2">
              {displayResult.score <= 20 ? (
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

      <BodyBattery48hDialog open={batteryDialogOpen} onOpenChange={setBatteryDialogOpen} />
      {factorDialog && (
        <FactorDetailDialog
          open={!!factorDialog}
          onOpenChange={(v) => !v && setFactorDialog(null)}
          label={factorDialog.label}
          status={factorDialog.status}
          detail={factorDialog.detail}
        />
      )}
    </div>
  );
};

export default ReadinessWidget;
