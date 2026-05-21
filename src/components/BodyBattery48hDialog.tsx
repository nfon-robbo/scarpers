import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, Moon, Sun, Activity, TrendingUp, TrendingDown, Sparkles, RefreshCw, BatteryLow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { passiveDrainRate, activityDrain, initialBatteryFromSleep, computeBodyBattery, type BodyBatteryResult } from "@/lib/body-battery";
import type { ReadinessData } from "@/lib/readiness";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  readinessData?: ReadinessData | null;
}

interface HourPoint {
  ts: number;
  label: string;
  hour: number;
  battery: number;
  delta: number;
  state: "sleep" | "awake" | "active";
  dominantStage?: "deep" | "rem" | "light";
  // separate series so each phase fills with its own color
  sleepBand: number | null;
  awakeBand: number | null;
  activeBand: number | null;
}

interface Totals {
  rechargeTotal: number;
  drainAwake: number;        // since last wake (today)
  drainActive: number;       // since last wake (today)
  rechargeDeep: number;
  rechargeRem: number;
  rechargeLight: number;
  hoursSinceWake: number;
}

function passiveDrainForHour(hoursAwake: number): number {
  return passiveDrainRate(hoursAwake);
}

const COLORS = {
  sleep: "hsl(142, 70%, 50%)",
  awake: "hsl(45, 90%, 55%)",
  active: "hsl(0, 75%, 58%)",
};

const BodyBattery48hDialog = ({ open, onOpenChange, readinessData }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<HourPoint[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [truth, setTruth] = useState<BodyBatteryResult | null>(null);
  const [prevSleep, setPrevSleep] = useState<{ hours: number; deepPct: number; remPct: number } | null>(null);
  const [insight, setInsight] = useState<{ loading: boolean; text: string | null }>({ loading: false, text: null });
  const insightKeyRef = useRef<string | null>(null);
  const hasChartDataRef = useRef(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    const showFullLoader = !hasChartDataRef.current;
    setLoading(showFullLoader);
    setRefreshing(!showFullLoader);
    let cancelled = false;

    const now = new Date();
    now.setMinutes(0, 0, 0);
    const startMs = now.getTime() - 47 * 3600_000;
    const startIso = new Date(startMs - 12 * 3600_000).toISOString();
    const startDate = new Date(startMs - 86400_000).toISOString().split("T")[0];

    Promise.all([
      supabase
        .from("sleep_stages")
        .select("stage, start_time, end_time, duration_seconds, date")
        .eq("user_id", user.id)
        .gte("date", startDate)
        .then(({ data }) => data || []),
      supabase
        .from("activities")
        .select("start_time, duration_seconds, avg_heart_rate, training_load, training_effect")
        .eq("user_id", user.id)
        .gte("start_time", startIso)
        .then(({ data }) => data || []),
    ]).then(([stages, acts]) => {
      if (cancelled) return;
      // Aggregate prev night sleep (most recent date with >=3h before today's wake date)
      const todayWakeDate = readinessData?.wakeTimeIso
        ? new Date(readinessData.wakeTimeIso).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];
      const byDate: Record<string, { total: number; deep: number; rem: number }> = {};
      for (const s of stages as any[]) {
        if (!s.date || !s.duration_seconds) continue;
        const d = byDate[s.date] || (byDate[s.date] = { total: 0, deep: 0, rem: 0 });
        const stage = (s.stage || "").toLowerCase();
        if (stage === "awake") continue;
        d.total += s.duration_seconds;
        if (stage === "deep") d.deep += s.duration_seconds;
        else if (stage === "rem") d.rem += s.duration_seconds;
      }
      const prevDates = Object.keys(byDate)
        .filter((d) => d < todayWakeDate && byDate[d].total >= 3 * 3600)
        .sort();
      const prevDate = prevDates[prevDates.length - 1];
      const prevSleepAgg = prevDate
        ? {
            hours: byDate[prevDate].total / 3600,
            deepPct: byDate[prevDate].total ? (byDate[prevDate].deep / byDate[prevDate].total) * 100 : 0,
            remPct: byDate[prevDate].total ? (byDate[prevDate].rem / byDate[prevDate].total) * 100 : 0,
          }
        : null;
      setPrevSleep(prevSleepAgg);

      const sleepIntervals: { start: number; end: number; weight: number; stage: "deep" | "rem" | "light" }[] = [];
      for (const s of stages as any[]) {
        if (!s.start_time || !s.end_time) continue;
        const stage = (s.stage || "").toLowerCase();
        if (stage === "awake") continue;
        const norm: "deep" | "rem" | "light" = stage === "deep" ? "deep" : stage === "rem" ? "rem" : "light";
        const w = norm === "deep" ? 9 : norm === "rem" ? 7 : 5;
        sleepIntervals.push({
          start: new Date(s.start_time).getTime(),
          end: new Date(s.end_time).getTime(),
          weight: w,
          stage: norm,
        });
      }

      const actIntervals: { start: number; end: number; drainPerHour: number }[] = [];
      for (const a of acts as any[]) {
        if (!a.start_time || !a.duration_seconds) continue;
        const start = new Date(a.start_time).getTime();
        const end = start + a.duration_seconds * 1000;
        const mins = a.duration_seconds / 60;
        let load = mins;
        if (a.training_load && a.training_load > 0) load = a.training_load;
        else if (a.training_effect && a.training_effect > 0)
          load = mins * (0.25 + (a.training_effect / 5) * 1.75);
        else if (a.avg_heart_rate && a.avg_heart_rate > 0)
          load = mins * Math.max(0.5, Math.min(2.0, a.avg_heart_rate / 140));
        const totalDrain = activityDrain(load);
        const hours = Math.max(0.1, a.duration_seconds / 3600);
        actIntervals.push({ start, end, drainPerHour: totalDrain / hours });
      }

      const sleepAt = (t: number) => {
        for (const iv of sleepIntervals) {
          if (t >= iv.start && t < iv.end) return iv;
        }
        return null;
      };
      const activityAt = (t: number) => {
        let drain = 0;
        for (const iv of actIntervals) {
          if (t >= iv.start && t < iv.end) drain += iv.drainPerHour;
        }
        return drain;
      };

      const stepMin = 15;
      const stepMs = stepMin * 60_000;
      const totalSteps = (47 * 60) / stepMin;
      const nowMs = now.getTime();

      let battery = 60;
      let hoursAwake = 6;

      const hourly: HourPoint[] = [];
      // Per-hour accumulators
      let hourDelta = 0;
      let hourState: HourPoint["state"] = "awake";
      let hourStageWeights: Record<string, number> = {};

      const tot: Totals = {
        rechargeTotal: 0,
        drainAwake: 0,
        drainActive: 0,
        rechargeDeep: 0,
        rechargeRem: 0,
        rechargeLight: 0,
        hoursSinceWake: 0,
      };

      // Track most recent sleep→awake transition for "today only" drain card.
      let lastWakeMs: number | null = null;
      let wasSleeping = true; // assume we start mid-sleep so first awake step sets lastWakeMs

      for (let i = 0; i <= totalSteps; i++) {
        const t = startMs + i * stepMs;
        if (t > nowMs) break;
        const sleep = sleepAt(t);
        const actDrain = activityAt(t);

        let delta = 0;
        let stepState: HourPoint["state"] = "awake";

        if (sleep) {
          const gain = (sleep.weight * stepMin) / 60;
          delta = gain;
          stepState = "sleep";
          tot.rechargeTotal += gain;
          if (sleep.stage === "deep") tot.rechargeDeep += gain;
          else if (sleep.stage === "rem") tot.rechargeRem += gain;
          else tot.rechargeLight += gain;
          hourStageWeights[sleep.stage] = (hourStageWeights[sleep.stage] || 0) + gain;
          hoursAwake = 0;
          wasSleeping = true;
        } else {
          hoursAwake += stepMin / 60;
          // sleep → awake transition
          if (wasSleeping) {
            lastWakeMs = t;
            tot.drainAwake = 0;
            tot.drainActive = 0;
            wasSleeping = false;
          }
          const passive = passiveDrainForHour(hoursAwake);
          const passiveD = (passive * stepMin) / 60;
          delta = -passiveD;
          if (lastWakeMs != null && t >= lastWakeMs) tot.drainAwake += passiveD;
          const ambientD = (0.5 * stepMin) / 60;
          delta -= ambientD;
          if (lastWakeMs != null && t >= lastWakeMs) tot.drainActive += ambientD;
          if (actDrain > 0) {
            const actD = (actDrain * stepMin) / 60;
            delta -= actD;
            if (lastWakeMs != null && t >= lastWakeMs) tot.drainActive += actD;
            stepState = "active";
          } else {
            stepState = "awake";
          }
        }

        battery += delta;
        battery = Math.max(5, Math.min(100, battery));

        hourDelta += delta;
        if (stepState === "active") hourState = "active";
        else if (stepState === "sleep" && hourState !== "active") hourState = "sleep";
        else if (hourState !== "active" && hourState !== "sleep") hourState = "awake";

        if (t % 3600_000 === 0) {
          const d = new Date(t);
          let dominant: HourPoint["dominantStage"] | undefined;
          const entries = Object.entries(hourStageWeights);
          if (entries.length) {
            entries.sort((a, b) => b[1] - a[1]);
            dominant = entries[0][0] as any;
          }
          const value = Math.round(battery);
          hourly.push({
            ts: t,
            label: d.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
            hour: d.getHours(),
            battery: value,
            delta: Math.round(hourDelta * 10) / 10,
            state: hourState,
            dominantStage: dominant,
            sleepBand: hourState === "sleep" ? value : null,
            awakeBand: hourState === "awake" ? value : null,
            activeBand: hourState === "active" ? value : null,
          });
          hourDelta = 0;
          hourState = "awake";
          hourStageWeights = {};
        }
      }

      tot.hoursSinceWake = lastWakeMs != null
        ? Math.max(0, (Date.now() - lastWakeMs) / 3600_000)
        : hoursAwake;

      // ── Single source of truth: computeBodyBattery() with the same inputs as the dashboard ──
      let truthResult: BodyBatteryResult | null = null;
      if (readinessData) {
        const sleepInputs = {
          sleepScore: readinessData.sleepScore,
          sleepHours: readinessData.sleepHours,
          deepPct: readinessData.deepPct,
          remPct: readinessData.remPct,
          hrv: readinessData.hrv,
          hrvBaseline: readinessData.hrvBaseline,
          recentSleepAvgHours: readinessData.recentSleepAvgHours,
          baselineSleepAvgHours: readinessData.baselineSleepAvgHours,
        };
        truthResult = computeBodyBattery({
          sleep: sleepInputs,
          wakeTimeIso: readinessData.wakeTimeIso,
          todayActivities: readinessData.todayActivities,
          now: Date.now(),
        });
        if (hourly.length > 0) {
          const wakeMs = readinessData.wakeTimeIso ? new Date(readinessData.wakeTimeIso).getTime() : null;
          if (wakeMs != null && Number.isFinite(wakeMs)) {
            for (const p of hourly) {
              if (p.ts < wakeMs) continue;
              const modelAtPoint = computeBodyBattery({
                sleep: sleepInputs,
                wakeTimeIso: readinessData.wakeTimeIso,
                todayActivities: readinessData.todayActivities,
                now: p.ts,
              });
              const newVal = modelAtPoint.percent;
              p.battery = newVal;
              if (p.sleepBand != null) p.sleepBand = newVal;
              if (p.awakeBand != null) p.awakeBand = newVal;
              if (p.activeBand != null) p.activeBand = newVal;
            }
          }
          const last = hourly[hourly.length - 1];
          last.battery = truthResult.percent;
          if (last.awakeBand != null) last.awakeBand = truthResult.percent;
          if (last.activeBand != null) last.activeBand = truthResult.percent;
          if (last.sleepBand != null) last.sleepBand = truthResult.percent;

          // Append a "now" point so the line visibly reaches the current minute,
          // not just the last whole-hour bucket.
          const nowMs2 = Date.now();
          if (nowMs2 - last.ts >= 60_000) {
            const nowD = new Date(nowMs2);
            const nowState = last.state === "sleep" ? "sleep" : last.state;
            hourly.push({
              ts: nowMs2,
              label: nowD.toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }),
              hour: nowD.getHours(),
              battery: truthResult.percent,
              delta: 0,
              state: nowState,
              dominantStage: last.dominantStage,
              sleepBand: nowState === "sleep" ? truthResult.percent : null,
              awakeBand: nowState === "awake" ? truthResult.percent : null,
              activeBand: nowState === "active" ? truthResult.percent : null,
            });
          }
        }
      }


      // Bridge nulls between phases so segments visually connect.
      const bands: ("sleepBand" | "awakeBand" | "activeBand")[] = ["sleepBand", "awakeBand", "activeBand"];
      for (const b of bands) {
        for (let i = 0; i < hourly.length; i++) {
          if (hourly[i][b] == null) {
            const prev = hourly[i - 1];
            const next = hourly[i + 1];
            if ((prev && prev[b] != null) || (next && next[b] != null)) {
              hourly[i] = { ...hourly[i], [b]: hourly[i].battery } as HourPoint;
            }
          }
        }
      }

      setPoints(hourly);
      setTotals(tot);
      setTruth(truthResult);
      setLastUpdated(Date.now());
      hasChartDataRef.current = true;
      setLoading(false);
      setRefreshing(false);
    }).catch(() => {
      if (cancelled) return;
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, user, readinessData, refreshTick]);

  // Auto-refresh every 5 minutes while dialog is open so the value visibly ticks.
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setRefreshTick((t) => t + 1), 5 * 60_000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      hasChartDataRef.current = false;
      setRefreshing(false);
    }
  }, [open]);

  const handleRecompute = useCallback(() => setRefreshTick((t) => t + 1), []);

  // Fetch AI insight when truth data changes (cached across reopens by data values).
  useEffect(() => {
    if (!open || !user || !truth || points.length === 0 || !readinessData) return;
    const key = `${truth.percent}|${truth.hoursAwake.toFixed(1)}|${truth.drainAwake}|${truth.drainActive}|${truth.startPercent}`;
    if (insightKeyRef.current === key) return;


    // Pattern detection from chart points
    const q = Math.max(1, Math.floor(points.length / 4));
    const avg = (arr: HourPoint[]) => arr.reduce((s, p) => s + p.battery, 0) / arr.length;
    const q1 = avg(points.slice(0, q));
    const mid = avg(points.slice(Math.floor(points.length / 3), Math.floor((2 * points.length) / 3)));
    const q4 = avg(points.slice(-q));
    let pattern = "gradual decline";
    if (q4 > q1 + 10) pattern = "recharged overnight then steady";
    else if (q1 - q4 > 30) pattern = "started high, gradual decline";
    else if (Math.abs(q4 - q1) < 10) pattern = "mostly flat";
    else if (q4 > mid + 10 && mid < q1) pattern = "dipped low then recovered";
    else if (q4 > q1) pattern = "climbing through the day";
    else if (q4 < 30) pattern = "low and staying low";
    let maxDrop = { drop: 0, ts: 0 };
    for (let i = 1; i < points.length; i++) {
      const d = points[i - 1].battery - points[i].battery;
      if (d > maxDrop.drop) maxDrop = { drop: d, ts: points[i].ts };
    }
    if (maxDrop.drop > 15) pattern += `, big drop around ${new Date(maxDrop.ts).getHours()}:00`;

    // HRV vs baseline string
    const hrv = readinessData.hrv;
    const baseline = readinessData.hrvBaseline;
    let hrvVsBaseline = "n/a";
    if (hrv && baseline) {
      const diffPct = Math.round(((hrv - baseline) / baseline) * 100);
      if (Math.abs(diffPct) < 5) hrvVsBaseline = "baseline";
      else hrvVsBaseline = diffPct > 0 ? `+${diffPct}%` : `${diffPct}%`;
    }

    const fallback = `Your battery is at ${truth.percent}% after ${truth.hoursAwake.toFixed(1)}h awake today.`;
    setInsight({ loading: true, text: null });

    supabase.functions
      .invoke("body-battery-insight", {
        body: {
          percent: truth.percent,
          status: truth.status,
          startPercent: truth.startPercent,
          hoursAwake: truth.hoursAwake,
          sleepHours: readinessData.sleepHours ?? 0,
          deepPct: readinessData.deepPct ?? 0,
          remPct: readinessData.remPct ?? 0,
          hrvVsBaseline,
          drainAwake: truth.drainAwake,
          drainActive: truth.drainActive,
          prevSleep,
          pattern,
        },
      })
      .then(({ data, error }) => {
        if (error || !data?.insight) setInsight({ loading: false, text: fallback });
        else {
          insightKeyRef.current = key;
          setInsight({ loading: false, text: data.insight });
        }
      })
      .catch(() => setInsight({ loading: false, text: fallback }));
  }, [open, user, truth, points, readinessData, prevSleep]);


  const midnightTicks = points.filter((p) => p.hour === 0).map((p) => p.label);

  const renderTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const p: HourPoint = payload[0].payload;
    const stateLabel =
      p.state === "sleep"
        ? `Sleeping${p.dominantStage ? ` (${p.dominantStage.toUpperCase()})` : ""}`
        : p.state === "active"
        ? "Activity"
        : "Awake";
    const deltaSign = p.delta > 0 ? "+" : "";
    const deltaColor = p.delta > 0 ? "text-emerald-500" : "text-red-500";
    return (
      <div className="rounded-lg border border-border/60 bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
        <div className="font-medium text-foreground">At {p.label}</div>
        <div className="text-muted-foreground mt-0.5">{stateLabel}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="text-foreground font-semibold">{p.battery}%</span>
          <span className={`font-mono ${deltaColor}`}>
            {deltaSign}
            {p.delta}
          </span>
        </div>
        <div className="text-[10px] text-muted-foreground mt-0.5">
          {p.delta > 0 ? "recharged" : p.delta < 0 ? "drained" : "no change"} this hour
        </div>
      </div>
    );
  };

  const fmt = (n: number) => Math.round(n);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <DialogTitle>Body Battery — Past 48 hours</DialogTitle>
              <DialogDescription>
                Modelled from your sleep, time awake and today's activity. Not a live watch reading — refreshes every few minutes from your data.
              </DialogDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRecompute}
              disabled={loading || refreshing}
              className="shrink-0 h-8 px-2 text-xs gap-1.5"
              title="Recompute now"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading || refreshing ? "animate-spin" : ""}`} />
              {lastUpdated ? `Updated ${new Date(lastUpdated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}` : "Recompute"}
            </Button>
          </div>
        </DialogHeader>


        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : points.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data available.</p>
        ) : (
          <div className="space-y-4">
            {/* Summary panel */}
            {totals && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium uppercase tracking-wide">
                    <TrendingUp className="w-3.5 h-3.5" /> Recharged
                  </div>
                  <div className="text-2xl font-bold text-foreground mt-0.5">+{fmt(totals.rechargeTotal)}%</div>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1">
                        <Moon className="w-3 h-3" /> Deep
                      </span>
                      <span className="font-mono text-foreground">+{fmt(totals.rechargeDeep)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>REM</span>
                      <span className="font-mono text-foreground">+{fmt(totals.rechargeRem)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Light</span>
                      <span className="font-mono text-foreground">+{fmt(totals.rechargeLight)}%</span>
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] text-red-400 font-medium uppercase tracking-wide">
                    <TrendingDown className="w-3.5 h-3.5" /> Drained
                  </div>
                  <div className="text-2xl font-bold text-foreground mt-0.5">
                    −{fmt((truth?.drainAwake ?? totals.drainAwake) + (truth?.drainActive ?? totals.drainActive))}%
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1">
                        <Sun className="w-3 h-3" /> Awake
                      </span>
                      <span className="font-mono text-foreground">−{fmt(truth?.drainAwake ?? totals.drainAwake)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="flex items-center gap-1">
                        <Activity className="w-3 h-3" /> Activity
                      </span>
                      <span className="font-mono text-foreground">−{fmt(truth?.drainActive ?? totals.drainActive)}%</span>
                    </div>
                    <div className="pt-1 border-t border-border/40 text-[10px] text-muted-foreground">
                      Since last wake ({(truth?.hoursAwake ?? totals.hoursSinceWake).toFixed(1)}h ago)
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className={`h-72 w-full transition-opacity ${refreshing ? "opacity-80" : "opacity-100"}`}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.sleep} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={COLORS.sleep} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="awakeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.awake} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={COLORS.awake} stopOpacity={0.05} />
                    </linearGradient>
                    <linearGradient id="activeGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={COLORS.active} stopOpacity={0.55} />
                      <stop offset="100%" stopColor={COLORS.active} stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--border))" strokeOpacity={0.3} vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    interval={5}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                  />
                  <Tooltip content={renderTooltip} />
                  <ReferenceLine y={25} stroke="hsl(0, 75%, 55%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={75} stroke="hsl(142, 70%, 50%)" strokeDasharray="3 3" strokeOpacity={0.4} />
                  {midnightTicks.map((t) => (
                    <ReferenceLine
                      key={t}
                      x={t}
                      stroke="hsl(var(--muted-foreground))"
                      strokeDasharray="2 4"
                      strokeOpacity={0.4}
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="sleepBand"
                    stroke={COLORS.sleep}
                    fill="url(#sleepGrad)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="awakeBand"
                    stroke={COLORS.awake}
                    fill="url(#awakeGrad)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="activeBand"
                    stroke={COLORS.active}
                    fill="url(#activeGrad)"
                    strokeWidth={2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>



            {/* AI insight */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-primary font-medium">
                <Sparkles className="w-3.5 h-3.5" /> What's happening
              </div>
              {insight.loading ? (
                <div className="mt-1.5 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Analysing your pattern…
                </div>
              ) : (
                <p className="mt-1.5 text-sm leading-relaxed text-foreground/90">{insight.text}</p>
              )}
            </div>

            {(() => {
              // Reserve-mode badge: last 2+ hourly buckets all <25 with no activity.
              const tail = points.slice(-3);
              const reserve =
                tail.length >= 2 &&
                tail.every((p) => p.battery < 25 && p.state !== "active");
              if (!reserve) return null;
              return (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
                  <BatteryLow className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    Reserve mode — drain has slowed. Your reserves are low, so the curve flattens until you sleep or refuel.
                  </span>
                </div>
              );
            })()}

            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.sleep }} /> Recharging (sleep)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.awake }} /> Awake drain
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: COLORS.active }} /> Activity drain
              </span>
              <span className="ml-auto">
                Now: <strong className="text-foreground">{truth?.percent ?? points[points.length - 1]?.battery}%</strong>
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BodyBattery48hDialog;
