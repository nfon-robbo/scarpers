import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Zap, AlertTriangle, CheckCircle, BatteryCharging, Loader2, MessageSquare } from "lucide-react";
import { calculateSleepScore } from "@/lib/sleep-score";
import {
  type ReadinessData,
  computeReadiness,
  groupSleepByDate,
  activityIntensityLoad,
  workoutIntensity,
} from "@/lib/readiness";

const statusIcon = (s: "good" | "warning" | "poor") => {
  if (s === "good") return <CheckCircle className="w-3.5 h-3.5 text-primary" />;
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
      // Sleep stages — fetch with date so we can group and pick most recent night
      supabase
        .from("sleep_stages")
        .select("stage, duration_seconds, date")
        .eq("user_id", user.id)
        .in("date", [today, yesterday])
        .then(({ data }) => data || []),

      // Daily metrics — 30 days for baselines
      supabase
        .from("daily_metrics")
        .select("date, resting_heart_rate, hrv, stress_score, sleep_score, sleep_duration_seconds")
        .eq("user_id", user.id)
        .gte("date", twentyEightDaysAgo)
        .order("date", { ascending: true })
        .then(({ data }) => data || []),

      // Activities — 28 days for monotony + recovery + today's load
      supabase
        .from("activities")
        .select("duration_seconds, start_time, avg_heart_rate, training_load, training_effect")
        .eq("user_id", user.id)
        .gte("start_time", twentyEightDaysAgo + "T00:00:00Z")
        .order("start_time", { ascending: false })
        .then(({ data }) => data || []),
    ]).then(([sleepStages, allMetrics, allActivities]) => {
      // ── Sleep (fix double-count) ──
      const stages = groupSleepByDate(sleepStages as any);
      const totalSleep = stages.deep + stages.light + stages.rem;
      const hasSleepStages = totalSleep > 0;
      const sleepScore = hasSleepStages ? calculateSleepScore(stages) : null;

      // ── Metrics ──
      const todayMetrics = allMetrics.find((m: any) => m.date === today);
      const yesterdayMetrics = allMetrics.find((m: any) => m.date === yesterday);
      const latestMetrics = todayMetrics || yesterdayMetrics;

      const baseline = allMetrics.filter((m: any) => m.date < today);
      const rhrVals = baseline.filter((m: any) => m.resting_heart_rate).map((m: any) => m.resting_heart_rate);
      const hrvVals = baseline.filter((m: any) => m.hrv).map((m: any) => m.hrv);
      const rhrBaseline = rhrVals.length ? rhrVals.reduce((a: number, b: number) => a + b, 0) / rhrVals.length : null;
      const hrvBaseline = hrvVals.length ? hrvVals.reduce((a: number, b: number) => a + b, 0) / hrvVals.length : null;

      // Detect stale sleep: if most recent sleep_stages date is older than yesterday, treat as not synced
      const sleepDates = [...new Set((sleepStages as any[]).map((s: any) => s.date))].sort().reverse();
      const mostRecentSleepDate = sleepDates[0] || null;
      const isSleepCurrent = mostRecentSleepDate && (mostRecentSleepDate === today || mostRecentSleepDate === yesterday);
      const finalSleepScore = isSleepCurrent ? (sleepScore ?? (latestMetrics as any)?.sleep_score ?? null) : null;
      const sleepDuration = isSleepCurrent && hasSleepStages ? totalSleep : isSleepCurrent ? ((latestMetrics as any)?.sleep_duration_seconds ?? null) : null;

      // ── 3-day sleep avg vs 30-day avg ──
      const recentMetrics = allMetrics.filter((m: any) => m.date >= threeDaysAgo && m.date <= today);
      const recentSleepSecs = recentMetrics.filter((m: any) => m.sleep_duration_seconds).map((m: any) => m.sleep_duration_seconds);
      const recentSleepAvgHours = recentSleepSecs.length ? (recentSleepSecs.reduce((a: number, b: number) => a + b, 0) / recentSleepSecs.length) / 3600 : null;

      const allSleepSecs = baseline.filter((m: any) => m.sleep_duration_seconds).map((m: any) => m.sleep_duration_seconds);
      const baselineSleepAvgHours = allSleepSecs.length ? (allSleepSecs.reduce((a: number, b: number) => a + b, 0) / allSleepSecs.length) / 3600 : null;

      // ── 3-day stress history ──
      const stressHistory = recentMetrics
        .filter((m: any) => m.stress_score != null)
        .map((m: any) => m.stress_score as number);

      // ── Activities breakdown ──
      const yesterdayActs = allActivities.filter((a: any) => {
        const d = a.start_time?.split("T")[0];
        return d === yesterday;
      });
      const todayActs = allActivities.filter((a: any) => {
        const d = a.start_time?.split("T")[0];
        return d === today;
      });

      // Yesterday's intensity-weighted load
      const yesterdayLoad = yesterdayActs.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);

      // Today's intensity-weighted load
      const todayLoad = todayActs.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);

      // Recovery: hours since last activity ended
      let recoveryHours: number | null = null;
      let lastIntensity: number | null = null;
      if (allActivities.length > 0) {
        const last = allActivities[0]; // sorted desc
        if (last.start_time) {
          const endMs = new Date(last.start_time).getTime() + ((last.duration_seconds || 0) * 1000);
          recoveryHours = (Date.now() - endMs) / (1000 * 3600);
          lastIntensity = workoutIntensity(last);
        }
      }

      // Training monotony: 7-day daily avg vs 28-day daily avg
      const sevenDayActs = allActivities.filter((a: any) => a.start_time && a.start_time >= sevenDaysAgo + "T00:00:00Z");
      const weeklyTotal = sevenDayActs.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);
      const monthlyTotal = allActivities.reduce((s: number, a: any) => s + activityIntensityLoad(a), 0);

      const weeklyLoadAvg = weeklyTotal / 7;
      const monthlyLoadAvg = monthlyTotal / 28;

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
      });
      setLoading(false);
    });
  }, [user]);

  const result = useMemo(() => data ? computeReadiness(data) : null, [data]);

  // Fetch AI advice with 1-hour cache, refresh if score changes
  useEffect(() => {
    if (!result || result.factors.length === 0) return;

    const cacheKey = "readiness_advice_cache";
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

    const fetchAdvice = async () => {
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
    fetchAdvice();
  }, [result]);

  if (loading || !result || result.factors.length === 0) return null;

  const readinessLabel = result.score >= 80 ? "Locked In" : result.score >= 60 ? "Decent" : result.score >= 40 ? "Rough Day" : "Train Wreck";
  const readinessColor = result.score >= 80 ? "text-primary" : result.score >= 60 ? "text-yellow-500" : "text-destructive";
  const badgeVariant = result.score >= 80 ? "default" : result.score >= 60 ? "secondary" : "destructive";

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" />
            Readiness Now
          </CardTitle>
          <Badge variant={badgeVariant as any}>{readinessLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Score bar */}
        <div className="space-y-1">
          <div className="flex justify-between items-baseline">
            <span className={`text-3xl font-bold ${readinessColor}`}>{result.score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
          </div>
          <Progress value={result.score} className="h-2" />
        </div>

        {/* Factor breakdown */}
        <div className="space-y-2">
          {result.factors.map((f) => (
            <div key={f.label} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                {statusIcon(f.status)}
                <span className="text-muted-foreground">{f.label}</span>
              </div>
              <span className="font-medium">{f.detail}</span>
            </div>
          ))}
        </div>

        {/* AI Coach Advice */}
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          {aiLoading ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Coach is thinking of something mean to say...
            </p>
          ) : aiAdvice ? (
            <p className="flex items-start gap-1.5">
              <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
              <span>{aiAdvice}</span>
            </p>
          ) : (
            <p className="font-medium flex items-center gap-1.5">
              <BatteryCharging className="w-3.5 h-3.5" />
              {result.score >= 80
                ? "You're well recovered — go crush it, you beautiful bastard."
                : result.score >= 60
                ? "Not your best, not your worst — don't be a hero today."
                : result.score >= 40
                ? "Your body is begging for mercy — take it easy, champ."
                : "For the love of all that is holy, rest. Just rest."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

export default ReadinessWidget;
