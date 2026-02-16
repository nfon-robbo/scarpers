import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, MessageSquare, RefreshCw, AlertTriangle, CheckCircle } from "lucide-react";
import { calculateSleepScore } from "@/lib/sleep-score";
import {
  type ReadinessData,
  computeReadiness,
  groupSleepByDate,
  activityIntensityLoad,
  workoutIntensity,
} from "@/lib/readiness";
import { cn } from "@/lib/utils";

// ── Circular Gauge ──
function CircularGauge({ score, size = 180 }: { score: number; size?: number }) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score)) / 100;
  const dashOffset = circumference * (1 - progress);

  // Color based on score zones
  const gaugeColor =
    score >= 80 ? "hsl(142, 60%, 45%)" : score > 30 ? "hsl(45, 90%, 50%)" : "hsl(0, 72%, 51%)";

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={gaugeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold tracking-tight text-foreground">{score}</span>
        <span className="text-[10px] text-muted-foreground mt-1">
          Updated {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
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

  const result = useMemo(() => data ? computeReadiness(data) : null, [data]);

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

  if (loading || !result || result.factors.length === 0) return null;

  return (
    <div className="space-y-4">
      {/* Main Gauge Card */}
      <Card>
        <CardContent className="pt-6 pb-4 flex flex-col items-center">
          <CircularGauge score={result.score} />
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
          {aiLoading ? (
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
                    Score: {result.score}/100 — {result.score >= 80 ? "Well recovered" : result.score > 50 ? "Moderate readiness" : result.score > 30 ? "Below average" : "Low readiness"}
                  </p>
                  <div className="space-y-0.5 text-xs">
                    {result.factors.map((f) => (
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
          <ZoneBar score={result.score} />

          {/* Sleep contribution */}
          {data?.sleepHours != null && (
            <div className="flex items-center justify-between text-sm rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-muted-foreground">🌙 Sleep</span>
              <span className="font-medium">+{Math.round((data.sleepScore || 0) * 0.3)} · {data.sleepHours.toFixed(1)}h</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Readiness Metrics */}
      <Card>
        <CardContent className="p-4 space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Readiness Metrics
          </h3>
          {result.factors.map((f) => (
            <div key={f.label} className="flex items-center justify-between py-1.5 text-sm">
              <div className="flex items-center gap-2">
                {statusIcon(f.status)}
                <span className="text-foreground">{f.label}</span>
              </div>
              <span className="text-muted-foreground font-medium">{f.detail}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

export default ReadinessWidget;
