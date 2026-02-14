import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sunrise, Moon, Activity, Heart, Brain, BatteryCharging, AlertTriangle, CheckCircle } from "lucide-react";
import { calculateSleepScore, scoreLabel, type SleepStageData } from "@/lib/sleep-score";

interface ReadinessData {
  sleepScore: number | null;
  sleepHours: number | null;
  deepPct: number | null;
  remPct: number | null;
  rhr: number | null;
  rhrBaseline: number | null;
  hrv: number | null;
  hrvBaseline: number | null;
  yesterdayLoad: number | null; // minutes
  stressScore: number | null;
}

function computeReadiness(d: ReadinessData): { score: number; factors: { label: string; status: "good" | "warning" | "poor"; detail: string }[] } {
  const factors: { label: string; status: "good" | "warning" | "poor"; detail: string }[] = [];
  let total = 0;
  let count = 0;

  // Sleep score (0-100 maps directly)
  if (d.sleepScore != null) {
    const s = d.sleepScore;
    total += s;
    count++;
    const sl = scoreLabel(s);
    factors.push({
      label: "Sleep Quality",
      status: s >= 70 ? "good" : s >= 50 ? "warning" : "poor",
      detail: `${s}/100 (${sl.label}) · ${d.sleepHours != null ? d.sleepHours.toFixed(1) + "h" : "—"}`,
    });
  }

  // RHR vs baseline
  if (d.rhr != null && d.rhrBaseline != null) {
    const diff = d.rhr - d.rhrBaseline;
    const rhrScore = diff <= 2 ? 90 : diff <= 5 ? 70 : diff <= 10 ? 50 : 30;
    total += rhrScore;
    count++;
    factors.push({
      label: "Resting HR",
      status: diff <= 3 ? "good" : diff <= 7 ? "warning" : "poor",
      detail: `${Math.round(d.rhr)} bpm (${diff > 0 ? "+" : ""}${Math.round(diff)} vs avg)`,
    });
  } else if (d.rhr != null) {
    factors.push({ label: "Resting HR", status: "good", detail: `${Math.round(d.rhr)} bpm` });
  }

  // HRV vs baseline
  if (d.hrv != null && d.hrvBaseline != null) {
    const diff = d.hrv - d.hrvBaseline;
    const pct = d.hrvBaseline > 0 ? (diff / d.hrvBaseline) * 100 : 0;
    const hrvScore = pct >= -5 ? 90 : pct >= -15 ? 65 : 40;
    total += hrvScore;
    count++;
    factors.push({
      label: "HRV",
      status: pct >= -10 ? "good" : pct >= -20 ? "warning" : "poor",
      detail: `${Math.round(d.hrv)} ms (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs avg)`,
    });
  }

  // Yesterday's training load
  if (d.yesterdayLoad != null) {
    const loadScore = d.yesterdayLoad <= 30 ? 90 : d.yesterdayLoad <= 60 ? 75 : d.yesterdayLoad <= 120 ? 55 : 35;
    total += loadScore;
    count++;
    factors.push({
      label: "Yesterday's Load",
      status: d.yesterdayLoad <= 45 ? "good" : d.yesterdayLoad <= 90 ? "warning" : "poor",
      detail: `${Math.round(d.yesterdayLoad)} min training`,
    });
  }

  // Stress
  if (d.stressScore != null) {
    const stressVal = d.stressScore;
    const stressScore = stressVal <= 25 ? 90 : stressVal <= 50 ? 70 : stressVal <= 75 ? 45 : 25;
    total += stressScore;
    count++;
    factors.push({
      label: "Stress",
      status: stressVal <= 30 ? "good" : stressVal <= 60 ? "warning" : "poor",
      detail: `${Math.round(stressVal)}/100`,
    });
  }

  const score = count > 0 ? Math.round(total / count) : 0;
  return { score, factors };
}

const statusIcon = (s: "good" | "warning" | "poor") => {
  if (s === "good") return <CheckCircle className="w-3.5 h-3.5 text-primary" />;
  if (s === "warning") return <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />;
  return <AlertTriangle className="w-3.5 h-3.5 text-destructive" />;
};

const ReadinessWidget = () => {
  const { user } = useAuth();
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const baselineStart = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

    Promise.all([
      // Last night's sleep stages
      supabase
        .from("sleep_stages")
        .select("stage, duration_seconds")
        .eq("user_id", user.id)
        .in("date", [today, yesterday])
        .then(({ data }) => data || []),
      // Today + yesterday metrics
      supabase
        .from("daily_metrics")
        .select("date, resting_heart_rate, hrv, stress_score, sleep_score, sleep_duration_seconds")
        .eq("user_id", user.id)
        .gte("date", baselineStart)
        .order("date", { ascending: true })
        .then(({ data }) => data || []),
      // Yesterday's activities
      supabase
        .from("activities")
        .select("duration_seconds, start_time")
        .eq("user_id", user.id)
        .gte("start_time", yesterday + "T00:00:00Z")
        .lt("start_time", today + "T00:00:00Z")
        .then(({ data }) => data || []),
    ]).then(([sleepStages, allMetrics, yesterdayActs]) => {
      // Calculate sleep score from stages
      const stages: SleepStageData = { deep: 0, light: 0, rem: 0, awake: 0 };
      sleepStages.forEach((s: any) => {
        const key = s.stage?.toLowerCase();
        if (key === "deep") stages.deep += s.duration_seconds || 0;
        else if (key === "light") stages.light += s.duration_seconds || 0;
        else if (key === "rem") stages.rem += s.duration_seconds || 0;
        else if (key === "awake") stages.awake += s.duration_seconds || 0;
      });
      const totalSleep = stages.deep + stages.light + stages.rem;
      const hasSleepStages = totalSleep > 0;
      const sleepScore = hasSleepStages ? calculateSleepScore(stages) : null;

      // Today's metrics (or most recent)
      const todayMetrics = allMetrics.find((m: any) => m.date === today);
      const yesterdayMetrics = allMetrics.find((m: any) => m.date === yesterday);
      const latestMetrics = todayMetrics || yesterdayMetrics;

      // Baselines (30-day avg excluding today)
      const baseline = allMetrics.filter((m: any) => m.date < today);
      const rhrVals = baseline.filter((m: any) => m.resting_heart_rate).map((m: any) => m.resting_heart_rate);
      const hrvVals = baseline.filter((m: any) => m.hrv).map((m: any) => m.hrv);
      const rhrBaseline = rhrVals.length ? rhrVals.reduce((a: number, b: number) => a + b, 0) / rhrVals.length : null;
      const hrvBaseline = hrvVals.length ? hrvVals.reduce((a: number, b: number) => a + b, 0) / hrvVals.length : null;

      // Fallback sleep score from daily_metrics
      const finalSleepScore = sleepScore ?? (latestMetrics as any)?.sleep_score ?? null;
      const sleepDuration = hasSleepStages ? totalSleep : (latestMetrics as any)?.sleep_duration_seconds ?? null;

      const yesterdayLoad = yesterdayActs.reduce((s: number, a: any) => s + ((a.duration_seconds || 0) / 60), 0);

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
      });
      setLoading(false);
    });
  }, [user]);

  const result = useMemo(() => data ? computeReadiness(data) : null, [data]);

  if (loading || !result || result.factors.length === 0) return null;

  const readinessLabel = result.score >= 80 ? "Ready to Train" : result.score >= 60 ? "Moderate" : result.score >= 40 ? "Consider Recovery" : "Rest Day Advised";
  const readinessColor = result.score >= 80 ? "text-primary" : result.score >= 60 ? "text-yellow-500" : "text-destructive";
  const badgeVariant = result.score >= 80 ? "default" : result.score >= 60 ? "secondary" : "destructive";

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sunrise className="w-4 h-4 text-primary" />
            Morning Readiness
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

        {/* Recommendation */}
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="font-medium flex items-center gap-1.5">
            <BatteryCharging className="w-3.5 h-3.5" />
            {result.score >= 80
              ? "You're well recovered — go for your planned workout."
              : result.score >= 60
              ? "Recovery is moderate — consider reducing intensity by 10-15%."
              : result.score >= 40
              ? "Recovery is low — swap for an easy session or active recovery."
              : "Your body needs rest — take a full rest day or very light movement."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReadinessWidget;
