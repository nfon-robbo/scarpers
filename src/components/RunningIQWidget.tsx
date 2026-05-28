import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, TrendingUp, ChevronRight, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { computeRunningIQ, type RunActivity, type RunningIQResult } from "@/lib/running-iq";
import RunningIQHistoryDialog from "./RunningIQHistoryDialog";
import { computeReadiness, groupSleepByDate, activityIntensityLoad, workoutIntensity, type ReadinessData } from "@/lib/readiness";
import { calculateSleepScore } from "@/lib/sleep-score";

// ── Large Score Display ──
function IQGauge({ score, label }: { score: number; label: string }) {
  const color =
    score >= 140
      ? "text-emerald-400"
      : score >= 80
      ? "text-amber-400"
      : "text-destructive";

  return (
    <div className="flex flex-col items-end">
      <span className={`text-6xl font-black tracking-tighter ${color}`}>
        {score}
      </span>
      <span className="text-sm text-muted-foreground">/ 200</span>
    </div>
  );
}

// ── Pillar Bar ──
function PillarBar({ name, score, icon, weight }: { name: string; score: number; icon: string; weight: number }) {
  const barColor =
    score >= 80
      ? "bg-emerald-500"
      : score >= 50
      ? "bg-amber-500"
      : "bg-destructive";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <span>{icon}</span>
          {name}
          <span className="text-muted-foreground/60 text-[10px]">({Math.round(weight * 100)}%)</span>
        </span>
        <span className="text-xs font-bold">{score}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-1000 ease-out ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

const RunningIQWidget = () => {
  const { user } = useAuth();
  const { profile } = useProfile();
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<RunningIQResult | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const loadScore = (userId: string, opts: { force?: boolean } = {}) => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000).toISOString();

    if (opts.force) {
      localStorage.removeItem(`running_iq_snapshot_last_${userId}`);
      computeFromData(userId, now);
      return;
    }

    supabase
      .from("running_iq_snapshots")
      .select("*")
      .eq("user_id", userId)
      .gte("recorded_at", oneHourAgo)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .then(({ data: snapshots }) => {
        if (snapshots && snapshots.length > 0) {
          const s = snapshots[0] as any;
          setResult({
            totalScore: s.score,
            adjustedScore: s.adjusted_score,
            label: s.label,
            pillars: (s.pillars as any[]) || [],
            lowestPillar: s.lowest_pillar || "",
            coachingTip: s.coaching_tip || "",
          });
          setLoading(false);
          return;
        }
        computeFromData(userId, now);
      });
  };

  useEffect(() => {
    if (!user) return;
    loadScore(user.id);
  }, [user]);

  const handleRecalculate = async () => {
    if (!user || recalculating) return;
    setRecalculating(true);
    setLoading(true);
    try {
      loadScore(user.id, { force: true });
      toast.success("Running IQ recalculated");
    } finally {
      // setLoading will be flipped off inside computeFromData
      setTimeout(() => setRecalculating(false), 500);
    }
  };

  const computeFromData = (userId: string, now: Date) => {
    const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * 86400000);
    const today = now.toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];
    const twentyEightDaysAgo = new Date(Date.now() - 28 * 86400000).toISOString().split("T")[0];

    Promise.all([
      supabase
        .from("activities")
        .select("distance_meters, duration_seconds, avg_heart_rate, max_heart_rate, avg_cadence, start_time, training_load, training_effect, activity_type, raw_data")
        .eq("user_id", userId)
        .gte("start_time", twelveWeeksAgo.toISOString())
        .order("start_time", { ascending: true })
        .then(({ data }) => data || []),

      supabase
        .from("daily_metrics")
        .select("date, resting_heart_rate, hrv, sleep_score, vo2_max")
        .eq("user_id", userId)
        .gte("date", twentyEightDaysAgo)
        .order("date", { ascending: false })
        .then(({ data }) => data || []),

      supabase
        .from("sleep_stages")
        .select("stage, duration_seconds, date, end_time")
        .eq("user_id", userId)
        .in("date", [today, yesterday])
        .then(({ data }) => data || []),

      supabase
        .from("training_plans")
        .select("training_days, start_date")
        .eq("user_id", userId)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .then(({ data }) => data || []),
    ]).then(([activities, allMetrics, sleepStages, plans]) => {
      const runs = (activities as any[]).map((a) => ({
        distance_meters: a.distance_meters,
        duration_seconds: a.duration_seconds,
        avg_heart_rate: a.avg_heart_rate,
        max_heart_rate: a.max_heart_rate,
        avg_cadence: a.avg_cadence,
        start_time: a.start_time,
        activity_type: a.activity_type,
        raw_data: a.raw_data,
      })) as RunActivity[];

      const metrics = allMetrics as any[];
      const latestWithVO2 = metrics.find((m) => m.vo2_max);
      const rhrValues = metrics.filter((m) => m.resting_heart_rate).slice(0, 14);
      const avgRHR = rhrValues.length
        ? rhrValues.reduce((s: number, m: any) => s + m.resting_heart_rate, 0) / rhrValues.length
        : null;
      const latestHRV = metrics.find((m) => m.hrv);
      const latestSleep = metrics.find((m) => m.sleep_score);

      let readinessScore = 50;
      try {
        const stages = groupSleepByDate(sleepStages as any);
        const totalSleep = stages.deep + stages.light + stages.rem;
        const sleepScore = totalSleep > 0 ? calculateSleepScore(stages) : null;
        const todayMetrics = metrics.find((m: any) => m.date === today);

        const readinessData: ReadinessData = {
          sleepScore: sleepScore ?? (todayMetrics?.sleep_score ?? null),
          sleepHours: totalSleep > 0 ? totalSleep / 3600 : null,
          deepPct: null, remPct: null,
          rhr: todayMetrics?.resting_heart_rate ?? null, rhrBaseline: avgRHR,
          hrv: todayMetrics?.hrv ?? null, hrvBaseline: null,
          yesterdayLoad: null, stressScore: null, todayLoad: null,
          recoveryHoursSinceLastHard: null, lastWorkoutIntensity: null,
          recentSleepAvgHours: null, baselineSleepAvgHours: null,
          stressHistory: [], weeklyLoadAvg: null, monthlyLoadAvg: null,
          currentHour: now.getHours(), wakeTimeIso: null, todayActivities: [],
        };
        const readinessResult = computeReadiness(readinessData);
        readinessScore = readinessResult.score;
      } catch { /* use default 50 */ }

      let missed = 0;
      let planned = 0;
      if (plans.length > 0) {
        const plan = plans[0] as any;
        const trainingDays = plan.training_days || [];
        planned = trainingDays.length * 4;
        const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000);
        const recentRunCount = runs.filter(
          (r) => r.start_time && new Date(r.start_time) >= fourWeeksAgo
        ).length;
        missed = Math.max(0, planned - recentRunCount);
      }

      const ageYears = 30;

      const iqResult = computeRunningIQ({
        runs,
        vo2Max: latestWithVO2?.vo2_max ?? null,
        restingHR: avgRHR,
        hrv: latestHRV?.hrv ?? null,
        sleepScore: latestSleep?.sleep_score ?? null,
        readinessScore,
        ageYears,
        gender: "UNSPECIFIED",
        missedWorkoutsLast4Weeks: missed,
        plannedWorkoutsLast4Weeks: planned,
      });

      setResult(iqResult);
      setLoading(false);

      // Save snapshot (throttled: max once per hour)
      const cacheKey = `running_iq_snapshot_last_${userId}`;
      const last = localStorage.getItem(cacheKey);
      const nowMs = Date.now();
      if (!last || nowMs - Number(last) >= 3600000) {
        localStorage.setItem(cacheKey, String(nowMs));
        supabase
          .from("running_iq_snapshots")
          .insert({
            user_id: userId,
            score: iqResult.totalScore,
            adjusted_score: iqResult.adjustedScore,
            label: iqResult.label,
            pillars: iqResult.pillars as any,
            lowest_pillar: iqResult.lowestPillar,
            coaching_tip: iqResult.coachingTip,
            recorded_at: new Date().toISOString(),
          })
          .then(({ error }) => {
            if (error) localStorage.removeItem(cacheKey);
          });
      }
    });
  };

  if (loading) {
    return (
      <Card className="glass border-border/30">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-3 animate-fade-in">
      {/* Main IQ Card */}
      <Card className="glass border-border/30 overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />
        <CardContent className="p-5 relative z-10">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-bold text-foreground">Running IQ</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Keep running — history will appear here
              </p>
            </div>
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={handleRecalculate}
                disabled={recalculating}
                title="Recalculate now"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${recalculating ? "animate-spin" : ""}`} />
              </button>
              <IQGauge score={result.adjustedScore} label={result.label} />
            </div>
          </div>

          {/* Label badge */}
          <div className="mb-5">
            <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${
              result.adjustedScore >= 140
                ? "bg-emerald-500/10 text-emerald-500"
                : result.adjustedScore >= 80
                ? "bg-amber-500/10 text-amber-500"
                : "bg-destructive/10 text-destructive"
            }`}>
              {result.label}
            </span>
          </div>

          {/* Pillar Breakdown */}
          <div className="space-y-3">
            {result.pillars.map((p) => (
              <PillarBar key={p.name} {...p} />
            ))}
          </div>

          {/* History / explainer link */}
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="mt-5 w-full flex items-center justify-between text-xs font-medium text-primary hover:text-primary/80 transition-colors group"
          >
            <span className="flex items-center gap-1.5">
              <History className="w-3.5 h-3.5" />
              View history & what your score means
            </span>
            <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </CardContent>
      </Card>

      <RunningIQHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        current={result}
      />
    </div>
  );
};

export default RunningIQWidget;
