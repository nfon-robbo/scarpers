import { useEffect, useMemo, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { parseWorkoutsFromPlan, ParsedWorkout } from "@/lib/plan-export";
import { startOfLocalDayMs } from "@/lib/plan-utils";
import {
  Loader2, RefreshCw, Trophy, Activity as ActivityIcon, Heart, Gauge,
  Flame, Moon, Brain, Timer, Sparkles, CheckCircle2, AlertTriangle, ArrowLeft,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, Area, ReferenceDot,
  Cell,
} from "recharts";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { bpmToZone, type Zones } from "@shared/hr-zones";
import { useHrZones } from "@/hooks/useHrZones";

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  color: "hsl(var(--foreground))",
};

type Range = "all" | "4w" | "1w";

interface PlanRow {
  id: string;
  user_id: string;
  content: string;
  start_date: string;
  race_date: string | null;
  race_distance: string;
  goal_time: string | null;
  paused_at?: string | null;
  paused_until?: string | null;
  pause_reason?: string | null;
  race_date_mode?: string | null;
}
interface Activity {
  id: string;
  start_time: string;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_cadence: number | null;
  training_load: number | null;
  activity_type: string | null;
  training_plan_id: string | null;
  raw_data: any;
}
interface ReadinessSnap { score: number; recorded_at: string; kind: string; }
interface IqSnap { adjusted_score: number; recorded_at: string; }
interface DailyMetric {
  date: string;
  sleep_score: number | null;
  hrv: number | null;
  resting_heart_rate: number | null;
  deep_sleep_minutes: number | null;
  rem_sleep_minutes: number | null;
  light_sleep_minutes: number | null;
}
interface Review { activity_id: string; pace: string | null; coach_recommendation: string | null; }

// ---------- Helpers ----------

const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
const isoDay = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const isCredibleCompletedActivity = (a: Activity) => {
  const dist = Number(a.distance_meters || 0);
  const dur = Number(a.duration_seconds || 0);
  return dist >= 500 && dur >= 60;
};
const isRunActivity = (a: Activity) => {
  const type = (a.activity_type || "").toLowerCase();
  if (/walk|hike|cycle|bike|ride|swim|row|elliptical|strength|yoga|pilates/i.test(type)) return false;
  return /run|jog|treadmill/i.test(type) || (!type && Number(a.distance_meters || 0) > 0);
};
const durationTextToSeconds = (text: string): number => {
  const t = text.trim();
  if (!t) return 0;
  const repeat = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes|sec|secs|second|seconds|s)\b/i);
  if (repeat) return parseInt(repeat[1], 10) * durationTextToSeconds(`${repeat[2]} ${repeat[3]}`);
  const colon = t.match(/\b(\d{1,3}):(\d{2})\b/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  let total = 0;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|min|mins|minute|minutes|sec|secs|second|seconds|s)\b/gi)) {
    const value = parseFloat(m[1]);
    const unit = m[2].toLowerCase();
    total += unit.startsWith("h") ? value * 3600 : unit.startsWith("s") ? value : value * 60;
  }
  return Math.round(total);
};
const plannedDurationSeconds = (w: ParsedWorkout): number => {
  const fromSegments = (w.segments || []).reduce((sum, seg) => sum + durationTextToSeconds(seg.duration || ""), 0);
  if (fromSegments > 0) return fromSegments;
  const fallback = `${w.title} ${w.rawText}`.match(/Total:\s*~?\s*(\d+)\s*min/i) || `${w.title} ${w.rawText}`.match(/\(\s*~?\s*(\d+)\s*min\s*(?:total)?\s*\)/i);
  return fallback ? parseInt(fallback[1], 10) * 60 : 0;
};
const activityCompletesSession = (a: Activity, w: ParsedWorkout, planId: string, day: string) => {
  if (isoDay(new Date(a.start_time)) !== day) return false;
  const run = isRunActivity(a);
  const linkedToPlan = a.training_plan_id === planId;
  const plannedSec = plannedDurationSeconds(w);
  const actualSec = Number(a.duration_seconds || 0);
  const withinDuration = !a.training_plan_id && run && plannedSec > 0 && actualSec > 0 && Math.abs(actualSec - plannedSec) / plannedSec <= 0.5;
  const credibleRunOnPlannedDate = run && isCredibleCompletedActivity(a);
  return linkedToPlan || withinDuration || credibleRunOnPlannedDate;
};
const paceSecPerKm = (a: Activity): number | null => {
  if (!a.distance_meters || !a.duration_seconds || a.distance_meters < 100) return null;
  return Math.round(a.duration_seconds / (a.distance_meters / 1000));
};
const fmtPace = (s: number | null) => {
  if (s == null || !isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};
const fmtHMS = (sec: number) => {
  if (!isFinite(sec) || sec <= 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}` : `${m}:${s.toString().padStart(2, "0")}`;
};

function raceDistanceKm(label: string): number | null {
  if (!label) return null;
  const s = label.toLowerCase();
  if (/half/.test(s)) return 21.0975;
  if (/marathon/.test(s)) return 42.195;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(k|km|mi)/);
  if (m) return /mi/.test(m[2]) ? parseFloat(m[1]) * 1.60934 : parseFloat(m[1]);
  return null;
}
function goalTimeSec(t: string | null): number | null {
  if (!t) return null;
  const hms = t.trim().match(/^(\d+):(\d{1,2}):(\d{2})$/);
  if (hms) return +hms[1] * 3600 + +hms[2] * 60 + +hms[3];
  const ms = t.trim().match(/^(\d{1,3}):(\d{2})$/);
  if (ms) return +ms[1] * 60 + +ms[2];
  return null;
}

function targetPaceFromWorkout(w: ParsedWorkout): number | null {
  const main = w.segments.find((s) => /main|interval|tempo|run|race/i.test(s.segment)) || w.segments[0];
  if (!main) return null;
  const txt = `${main.target} ${main.notes || ""}`;
  const m = txt.match(/(\d{1,2}):(\d{2})\s*\/\s*km/);
  if (m) return +m[1] * 60 + +m[2];
  return null;
}

function intensityWeight(title: string): number {
  if (/race|interval|vo2|sprint/i.test(title)) return 2.0;
  if (/tempo|threshold/i.test(title)) return 1.6;
  if (/long/i.test(title)) return 1.2;
  if (/easy|recovery/i.test(title)) return 0.8;
  return 1.0;
}

function hrZonesFromActivity(a: Activity, zones: Zones) {
  // Use raw_data HR samples if available, else estimate from avg HR.
  const samples: number[] = Array.isArray(a.raw_data?.hr_samples) ? a.raw_data.hr_samples : [];
  const dur = a.duration_seconds || 0;
  const perZone = [0, 0, 0, 0, 0]; // Z1..Z5 minutes
  if (samples.length > 1 && dur > 0) {
    const per = dur / samples.length / 60; // minutes per sample
    for (const hr of samples) {
      perZone[bpmToZone(hr, zones) - 1] += per;
    }
    return perZone;
  }
  // Fallback: dump duration in single zone matching avg HR.
  if (a.avg_heart_rate && dur > 0) {
    perZone[bpmToZone(a.avg_heart_rate, zones) - 1] = dur / 60;
  }
  return perZone;
}

function isoWeekKey(d: Date): string {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 4 - (t.getDay() || 7));
  const yearStart = new Date(t.getFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getFullYear()}-W${week.toString().padStart(2, "0")}`;
}

function rolling7(series: { date: string; value: number | null }[]): { date: string; value: number | null }[] {
  return series.map((_, i) => {
    const window = series.slice(Math.max(0, i - 6), i + 1).map((s) => s.value).filter((v): v is number => v != null);
    return { date: series[i].date, value: window.length ? window.reduce((a, b) => a + b, 0) / window.length : null };
  });
}

// ---------- Component ----------

export default function Analytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("all");
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [readiness, setReadiness] = useState<ReadinessSnap[]>([]);
  const [iq, setIq] = useState<IqSnap[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const { zones: hrZones } = useHrZones();
  const [aiSummary, setAiSummary] = useState<string>("");
  const [aiGeneratedAt, setAiGeneratedAt] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  // ----- Data load -----
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data: planData }, { data: profileData }] = await Promise.all([
        supabase
          .from("training_plans")
          .select("id, user_id, content, start_date, race_date, race_distance, goal_time, paused_at, paused_until, pause_reason, race_date_mode")
          .eq("user_id", user.id)
          .eq("archived", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("profiles").select("date_of_birth").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const p = planData as PlanRow | null;
      setPlan(p);

      // Max HR now resolved centrally via useHrZones (LTHR band model).
      const dob = (profileData as any)?.date_of_birth;
      void dob;

      const startDate = p ? p.start_date : new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
      const sinceIso = new Date(startDate).toISOString();

      const [actsRes, readyRes, iqRes, metricsRes] = await Promise.all([
        supabase
          .from("activities")
          .select("id, start_time, distance_meters, duration_seconds, avg_heart_rate, max_heart_rate, avg_cadence, training_load, activity_type, training_plan_id, raw_data")
          .eq("user_id", user.id)
          .gte("start_time", sinceIso)
          .order("start_time", { ascending: true }),
        supabase
          .from("readiness_snapshots")
          .select("score, recorded_at, kind")
          .eq("user_id", user.id)
          .gte("recorded_at", sinceIso)
          .order("recorded_at", { ascending: true }),
        supabase
          .from("running_iq_snapshots")
          .select("adjusted_score, recorded_at")
          .eq("user_id", user.id)
          .gte("recorded_at", sinceIso)
          .order("recorded_at", { ascending: true }),
        supabase
          .from("daily_metrics")
          .select("date, sleep_score, hrv, resting_heart_rate, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes")
          .eq("user_id", user.id)
          .gte("date", startDate)
          .order("date", { ascending: true }),
      ]);
      if (cancelled) return;

      const acts = (actsRes.data as Activity[]) || [];
      setActivities(acts);
      setReadiness((readyRes.data as ReadinessSnap[]) || []);
      setIq((iqRes.data as IqSnap[]) || []);
      setMetrics((metricsRes.data as DailyMetric[]) || []);

      if (acts.length) {
        const ids = acts.map((a) => a.id);
        const { data: revs } = await supabase
          .from("workout_reviews")
          .select("activity_id, pace, coach_recommendation")
          .in("activity_id", ids);
        setReviews((revs as Review[]) || []);
      }

      // Load cached AI summary
      const { data: sum } = await supabase
        .from("analytics_summaries")
        .select("summary, generated_at")
        .eq("user_id", user.id)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sum) {
        setAiSummary((sum as any).summary);
        setAiGeneratedAt((sum as any).generated_at);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ----- Range filter -----
  const cutoff = useMemo(() => {
    if (range === "all") return 0;
    const days = range === "4w" ? 28 : 7;
    return Date.now() - days * 86400000;
  }, [range]);

  const fActs = useMemo(
    () => activities.filter((a) => new Date(a.start_time).getTime() >= cutoff),
    [activities, cutoff],
  );
  const fReady = useMemo(
    () => readiness.filter((r) => new Date(r.recorded_at).getTime() >= cutoff),
    [readiness, cutoff],
  );
  const fIq = useMemo(
    () => iq.filter((r) => new Date(r.recorded_at).getTime() >= cutoff),
    [iq, cutoff],
  );
  const fMetrics = useMemo(
    () => metrics.filter((m) => new Date(m.date).getTime() >= cutoff),
    [metrics, cutoff],
  );

  // ----- Parse plan workouts (full plan, ignore range filter) -----
  const planWorkouts = useMemo(
    () => (plan ? parseWorkoutsFromPlan(plan.content) : []),
    [plan],
  );

  // ----- 1. Plan progress -----
  const progress = useMemo(() => {
    if (!plan) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const credibleActivityDays = new Set(
      activities.filter(isCredibleCompletedActivity).map((a) => isoDay(new Date(a.start_time))),
    );
    let completed = 0, upcoming = 0, skipped = 0, rest = 0, total = 0;
    const pauseStart = plan.paused_at ? startOfLocalDayMs(new Date(plan.paused_at)) : null;
    const pauseEnd = plan.paused_until ? startOfLocalDayMs(new Date(plan.paused_until)) : null;
    const days = planWorkouts.map((w, index) => {
      if (!w.dateObj) return null;
      const day = isoDay(w.dateObj);
      const isRest = /rest/i.test(w.title);
      const inPauseWindow = pauseStart !== null && pauseEnd !== null &&
        startOfLocalDayMs(w.dateObj) >= pauseStart && startOfLocalDayMs(w.dateObj) < pauseEnd;
      let status: "completed" | "upcoming" | "skipped" | "rest";
      const hasCompletion = activities.some((a) => activityCompletesSession(a, w, plan.id, day));
      if (hasCompletion) {
        status = "completed"; completed++; total++;
      } else if (isRest || inPauseWindow) {
        status = "rest"; rest++;
      } else {
        total++;
        if (w.dateObj < today && !credibleActivityDays.has(day)) { status = "skipped"; skipped++; }
        else { status = "upcoming"; upcoming++; }
      }
      return { key: `${day}-${index}`, date: day, dateObj: w.dateObj, title: w.title, status };
    }).filter(Boolean) as { key: string; date: string; dateObj: Date; title: string; status: string }[];

    const pct = total ? Math.round((completed / total) * 100) : 0;
    const raceDate = plan.race_date ? new Date(plan.race_date.split("/").reverse().join("-")) : null;
    const raceDays = raceDate && !isNaN(raceDate.getTime()) ? Math.max(0, Math.ceil((raceDate.getTime() - Date.now()) / 86400000)) : null;
    const weeksRemaining = raceDays != null ? Math.ceil(raceDays / 7) : null;
    return { days, completed, upcoming, skipped, rest, total, pct, raceDays, weeksRemaining };
  }, [plan, planWorkouts, activities]);

  // ----- 2. Performance trends -----
  const perfData = useMemo(() => {
    const planByDate = new Map<string, ParsedWorkout>();
    for (const w of planWorkouts) if (w.dateObj) planByDate.set(isoDay(w.dateObj), w);

    return fActs.filter((a) => paceSecPerKm(a) != null).map((a, i) => {
      const day = isoDay(new Date(a.start_time));
      const w = planByDate.get(day);
      const target = w ? targetPaceFromWorkout(w) : null;
      const actual = paceSecPerKm(a)!;
      // Estimated race time = scale current pace to race distance
      const km = plan ? raceDistanceKm(plan.race_distance) : null;
      const estRace = km ? actual * km : null;
      return {
        date: fmtDate(new Date(a.start_time)),
        actual,
        target,
        cadence: a.avg_cadence ? Math.round(a.avg_cadence * (a.avg_cadence < 120 ? 2 : 1)) : null, // some sources report half cadence
        estRace,
        idx: i,
      };
    });
  }, [fActs, planWorkouts, plan]);

  // ----- 3. HR zones -----
  const hrData = useMemo(() => {
    const byWeek = new Map<string, number[]>();
    for (const a of fActs) {
      const wk = isoWeekKey(new Date(a.start_time));
      const z = hrZones ? hrZonesFromActivity(a, hrZones) : [0, 0, 0, 0, 0];
      const cur = byWeek.get(wk) || [0, 0, 0, 0, 0];
      for (let i = 0; i < 5; i++) cur[i] += z[i];
      byWeek.set(wk, cur);
    }
    return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([wk, z]) => ({
      week: wk.split("-W")[1] ? `Wk ${parseInt(wk.split("-W")[1])}` : wk,
      Z1: Math.round(z[0]), Z2: Math.round(z[1]), Z3: Math.round(z[2]),
      Z4: Math.round(z[3]), Z5: Math.round(z[4]),
    }));
  }, [fActs, hrZones]);

  // ----- 4. Readiness vs performance -----
  const readyVsPerf = useMemo(() => {
    const planByDate = new Map<string, ParsedWorkout>();
    for (const w of planWorkouts) if (w.dateObj) planByDate.set(isoDay(w.dateObj), w);
    // morning readiness per day
    const morning = new Map<string, number>();
    for (const r of fReady) {
      const day = isoDay(new Date(r.recorded_at));
      if (!morning.has(day)) morning.set(day, r.score);
    }
    return fActs.map((a) => {
      const day = isoDay(new Date(a.start_time));
      const r = morning.get(day);
      const w = planByDate.get(day);
      const target = w ? targetPaceFromWorkout(w) : null;
      const actual = paceSecPerKm(a);
      if (r == null || target == null || actual == null) return null;
      const delta = ((actual - target) / target) * 100; // negative = faster than target
      return { readiness: r, paceDelta: delta, type: w?.title.split(" ")[0] || "Run" };
    }).filter(Boolean) as { readiness: number; paceDelta: number; type: string }[];
  }, [fActs, fReady, planWorkouts]);

  // ----- 5. Completion stats / streak -----
  const stats = useMemo(() => {
    if (!progress) return null;
    const sorted = [...progress.days].sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    let curStreak = 0, longest = 0, run = 0;
    for (const d of sorted) {
      if (d.status === "rest") continue;
      if (d.status === "completed") { run++; longest = Math.max(longest, run); }
      else if (d.status === "skipped") run = 0;
    }
    // current streak = trailing completed
    for (let i = sorted.length - 1; i >= 0; i--) {
      const d = sorted[i];
      if (d.status === "rest") continue;
      if (d.dateObj > new Date()) continue;
      if (d.status === "completed") curStreak++;
      else break;
    }
    const adapted = reviews.filter((r) => r.coach_recommendation && /swap|easy recovery|rest/i.test(r.coach_recommendation)).length;
    return {
      pct: progress.pct,
      curStreak,
      longest,
      adapted,
      original: Math.max(0, progress.completed - adapted),
    };
  }, [progress, reviews]);

  // ----- 6. Load and recovery -----
  const loadRecovery = useMemo(() => {
    const byWeek = new Map<string, { load: number; readiness: number[] }>();
    for (const a of fActs) {
      const wk = isoWeekKey(new Date(a.start_time));
      const w = byWeek.get(wk) || { load: 0, readiness: [] };
      const mins = (a.duration_seconds || 0) / 60;
      w.load += mins * intensityWeight(a.activity_type || "");
      byWeek.set(wk, w);
    }
    for (const r of fReady) {
      const wk = isoWeekKey(new Date(r.recorded_at));
      const w = byWeek.get(wk) || { load: 0, readiness: [] };
      w.readiness.push(r.score);
      byWeek.set(wk, w);
    }
    const arr = Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([wk, v]) => ({
      week: wk.split("-W")[1] ? `Wk ${parseInt(wk.split("-W")[1])}` : wk,
      load: Math.round(v.load),
      readiness: v.readiness.length ? Math.round(v.readiness.reduce((a, b) => a + b, 0) / v.readiness.length) : null,
    }));
    // Highlight spikes
    return arr.map((d, i) => {
      const prev = arr[i - 1];
      const spike = prev && d.load > prev.load * 1.3 && (d.readiness ?? 100) < (prev.readiness ?? 0) - 5;
      return { ...d, spike };
    });
  }, [fActs, fReady]);

  // ----- 7. Body battery / sleep trend -----
  const sleepTrend = useMemo(() => {
    // body battery proxy = sleep_score scaled + HRV influence; here use sleep_score as charge.
    const series = fMetrics.map((m) => ({
      date: m.date,
      value: m.sleep_score != null ? Number(m.sleep_score) : null,
    }));
    const battery = fMetrics.map((m) => {
      const deep = Number(m.deep_sleep_minutes || 0);
      const rem = Number(m.rem_sleep_minutes || 0);
      const total = deep + rem + Number(m.light_sleep_minutes || 0);
      const quality = total ? Math.min(100, Math.round(((deep * 1.5) + rem) / 4 + total / 8)) : null;
      return { date: m.date, value: quality };
    });
    const sleepRoll = rolling7(series);
    const batteryRoll = rolling7(battery);
    return sleepRoll.map((s, i) => ({
      date: fmtDate(new Date(s.date)),
      sleep: s.value != null ? Math.round(s.value) : null,
      battery: batteryRoll[i].value != null ? Math.round(batteryRoll[i].value!) : null,
    }));
  }, [fMetrics]);

  // ----- 8. Running IQ trend -----
  const iqTrend = useMemo(() => {
    return fIq.map((s) => ({
      date: fmtDate(new Date(s.recorded_at)),
      score: s.adjusted_score,
      ts: new Date(s.recorded_at).getTime(),
    }));
  }, [fIq]);

  const milestones = useMemo(() => {
    const ms: { date: string; label: string; score: number }[] = [];
    if (!iqTrend.length) return ms;
    // First continuous run = first activity over 20 min without rest
    const cont = fActs.find((a) => (a.duration_seconds || 0) >= 20 * 60);
    const first5k = fActs.find((a) => (a.distance_meters || 0) >= 5000);
    const racePace = fActs.find((a) => /race|tempo|threshold/i.test(a.activity_type || ""));
    const matchIq = (act: Activity | undefined, label: string) => {
      if (!act) return;
      const ts = new Date(act.start_time).getTime();
      const closest = iqTrend.reduce((best, s) => Math.abs(s.ts - ts) < Math.abs(best.ts - ts) ? s : best, iqTrend[0]);
      ms.push({ date: closest.date, label, score: closest.score });
    };
    matchIq(cont, "First continuous run");
    matchIq(first5k, "First 5K");
    matchIq(racePace, "First race-pace");
    return ms;
  }, [fActs, iqTrend]);

  // ----- 9. Race time gauge history -----
  const raceTimeHistory = useMemo(() => {
    if (!plan) return [];
    const km = raceDistanceKm(plan.race_distance);
    if (!km) return [];
    const goal = goalTimeSec(plan.goal_time);
    const byWeek = new Map<string, number[]>();
    for (const a of fActs) {
      const p = paceSecPerKm(a);
      if (p == null) continue;
      const wk = isoWeekKey(new Date(a.start_time));
      const arr = byWeek.get(wk) || [];
      arr.push(p * km);
      byWeek.set(wk, arr);
    }
    return Array.from(byWeek.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([wk, arr]) => ({
      week: wk.split("-W")[1] ? `Wk ${parseInt(wk.split("-W")[1])}` : wk,
      estimate: Math.min(...arr),
      goal,
    }));
  }, [fActs, plan]);

  // ----- AI Summary regenerate -----
  const refreshAi = useCallback(async () => {
    if (!user || !plan) return;
    setAiLoading(true);
    try {
      const payload = {
        plan: { distance: plan.race_distance, goal: plan.goal_time, weeksRemaining: progress?.weeksRemaining },
        progress: progress ? { pct: progress.pct, completed: progress.completed, total: progress.total } : null,
        recentPaces: perfData.slice(-6).map((p) => ({ date: p.date, actual: fmtPace(p.actual), target: fmtPace(p.target) })),
        readinessAvg: fReady.length ? Math.round(fReady.reduce((a, b) => a + b.score, 0) / fReady.length) : null,
        cadenceLatest: perfData.slice(-3).map((p) => p.cadence).filter(Boolean),
        iqLatest: iqTrend.slice(-3).map((p) => p.score),
        loadByWeek: loadRecovery.map((d) => ({ week: d.week, load: d.load, readiness: d.readiness })),
        streak: stats?.curStreak,
      };
      const { data, error } = await supabase.functions.invoke("analytics-summary", {
        body: { planId: plan.id, force: true, payload },
      });
      if (error) throw error;
      if ((data as any)?.summary) {
        setAiSummary((data as any).summary);
        setAiGeneratedAt((data as any).generated_at);
        toast.success("Summary refreshed");
      }
    } catch (e) {
      toast.error("Couldn't refresh summary", { description: e instanceof Error ? e.message : "Try again later" });
    } finally {
      setAiLoading(false);
    }
  }, [user, plan, progress, perfData, fReady, iqTrend, loadRecovery, stats]);

  // Auto-generate if missing or stale (>7 days)
  useEffect(() => {
    if (loading || !plan || aiSummary) return;
    refreshAi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, plan]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!plan) {
    return (
      <Card>
        <CardContent className="py-16 text-center space-y-3">
          <Trophy className="w-10 h-10 mx-auto text-muted-foreground" />
          <p className="text-lg font-semibold">No active training plan</p>
          <p className="text-sm text-muted-foreground">Create a plan to unlock analytics.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 h-8 px-2 text-muted-foreground hover:text-foreground">
            <Link to="/training-plan">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to plan
            </Link>
          </Button>
          <h1 className="font-['Bebas_Neue'] text-4xl tracking-wide">Plan Analytics</h1>
          <p className="text-sm text-muted-foreground">
            {plan.race_distance}{plan.goal_time ? ` · Goal ${plan.goal_time}` : ""}
            {progress?.raceDays != null ? ` · ${progress.raceDays} days to race` : ""}
          </p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList>
            <TabsTrigger value="all">Full plan</TabsTrigger>
            <TabsTrigger value="4w">4 weeks</TabsTrigger>
            <TabsTrigger value="1w">This week</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* AI Summary */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                Coach's Summary
              </CardTitle>
              <CardDescription className="text-xs">
                {aiGeneratedAt ? `Updated ${new Date(aiGeneratedAt).toLocaleDateString("en-GB")}` : "Generating…"}
              </CardDescription>
            </div>
            <Button size="sm" variant="ghost" onClick={refreshAi} disabled={aiLoading}>
              <RefreshCw className={cn("w-4 h-4", aiLoading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {aiLoading && !aiSummary ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Claire is analysing your data…
            </div>
          ) : aiSummary ? (
            <div className="text-sm leading-relaxed whitespace-pre-line">{aiSummary}</div>
          ) : (
            <p className="text-sm text-muted-foreground">No summary yet.</p>
          )}
        </CardContent>
      </Card>

      {/* 1. Plan Progress */}
      {progress && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Trophy className="w-4 h-4 text-primary" /> Plan Progress
            </CardTitle>
            <CardDescription className="text-xs">
              {progress.pct}% complete · {progress.completed}/{progress.total} sessions
              {progress.weeksRemaining != null ? ` · ${progress.weeksRemaining} weeks remaining` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-2 text-center">
              <StatPill label="Done" value={progress.completed} color="emerald" />
              <StatPill label="Upcoming" value={progress.upcoming} color="blue" />
              <StatPill label="Skipped" value={progress.skipped} color="red" />
              <StatPill label="Rest" value={progress.rest} color="muted" />
            </div>
            <div className="overflow-x-auto">
              <div className="flex gap-1 min-w-max pb-1">
                {progress.days.map((d) => (
                  <div
                    key={d.key}
                    title={`${d.date} · ${d.title} · ${d.status}`}
                    className={cn(
                      "h-8 w-3 rounded-sm shrink-0",
                      d.status === "completed" && "bg-emerald-500",
                      d.status === "upcoming" && "bg-blue-500/70",
                      d.status === "skipped" && "bg-red-500",
                      d.status === "rest" && "bg-muted",
                    )}
                  />
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Performance Trends */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ActivityIcon className="w-4 h-4 text-primary" /> Performance Trends
          </CardTitle>
          <CardDescription className="text-xs">Actual vs target pace, race estimate, cadence</CardDescription>
        </CardHeader>
        <CardContent>
          {perfData.length < 2 ? (
            <EmptyMsg>Need at least 2 completed sessions.</EmptyMsg>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={perfData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="pace" reversed tickFormatter={(v) => fmtPace(v)} tick={{ fontSize: 10 }} />
                <YAxis yAxisId="cad" orientation="right" tick={{ fontSize: 10 }} domain={[140, 200]} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any, name: string) => {
                  if (name === "Cadence") return [`${v} spm`, name];
                  if (name === "Est race time") return [fmtHMS(v), name];
                  return [fmtPace(v), name];
                }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line yAxisId="pace" type="monotone" dataKey="actual" name="Actual pace" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="pace" type="monotone" dataKey="target" name="Target pace" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                <Line yAxisId="pace" type="monotone" dataKey="estRace" name="Est race time" stroke="hsl(var(--chart-3))" strokeWidth={1.5} dot={false} />
                <Line yAxisId="cad" type="monotone" dataKey="cadence" name="Cadence" stroke="hsl(var(--chart-2))" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 3. HR analysis */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Heart className="w-4 h-4 text-primary" /> Heart Rate Zones
          </CardTitle>
          <CardDescription className="text-xs">Minutes per zone, by week (max HR ≈ {hrZones?.maxHr ?? "…"}, LTHR {hrZones?.lthr ?? "…"} bpm{hrZones?.lthrSource === "measured" ? "" : " est."})</CardDescription>
        </CardHeader>
        <CardContent>
          {hrData.length === 0 ? (
            <EmptyMsg>No HR data yet.</EmptyMsg>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={hrData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Z1" stackId="a" fill="hsl(var(--chart-1))" />
                <Bar dataKey="Z2" stackId="a" fill="hsl(var(--chart-2))" />
                <Bar dataKey="Z3" stackId="a" fill="hsl(var(--chart-3))" />
                <Bar dataKey="Z4" stackId="a" fill="hsl(var(--chart-4))" />
                <Bar dataKey="Z5" stackId="a" fill="hsl(var(--chart-5))" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 4. Readiness vs performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Gauge className="w-4 h-4 text-primary" /> Readiness vs Performance
          </CardTitle>
          <CardDescription className="text-xs">
            Each dot = a session. Below 0% = faster than target.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {readyVsPerf.length < 2 ? (
            <EmptyMsg>Need readiness scores and target paces.</EmptyMsg>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ScatterChart>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis type="number" dataKey="readiness" name="Readiness" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis type="number" dataKey="paceDelta" name="Pace Δ" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ strokeDasharray: "3 3" }} formatter={(v: any, n: string) => n === "Pace Δ" ? `${(v as number).toFixed(1)}%` : v} />
                <Scatter data={readyVsPerf} fill="hsl(var(--primary))">
                  {readyVsPerf.map((d, i) => (
                    <Cell key={i} fill={d.paceDelta < 0 ? "hsl(var(--chart-2))" : "hsl(var(--chart-5))"} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 5. Completion stats */}
      {stats && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" /> Completion
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBlock label="Completion" value={`${stats.pct}%`} />
              <StatBlock label="Current streak" value={`${stats.curStreak}`} />
              <StatBlock label="Longest streak" value={`${stats.longest}`} />
              <StatBlock label="Original / Adapted" value={`${stats.original} / ${stats.adapted}`} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* 6. Load and recovery */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Flame className="w-4 h-4 text-primary" /> Load &amp; Recovery
          </CardTitle>
          <CardDescription className="text-xs">Weekly intensity-weighted minutes vs avg readiness</CardDescription>
        </CardHeader>
        <CardContent>
          {loadRecovery.length === 0 ? (
            <EmptyMsg>No load data yet.</EmptyMsg>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={loadRecovery}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="load" tick={{ fontSize: 10 }} />
                <YAxis yAxisId="ready" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="load" dataKey="load" name="Load (min)" fill="hsl(var(--primary))">
                  {loadRecovery.map((d, i) => (
                    <Cell key={i} fill={d.spike ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                  ))}
                </Bar>
                <Line yAxisId="ready" type="monotone" dataKey="readiness" name="Readiness" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
          {loadRecovery.some((d) => d.spike) && (
            <p className="text-xs text-destructive flex items-center gap-1 mt-2">
              <AlertTriangle className="w-3 h-3" /> Red bars = load spike with readiness drop
            </p>
          )}
        </CardContent>
      </Card>

      {/* 7. Body battery & sleep */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Moon className="w-4 h-4 text-primary" /> Sleep &amp; Recovery Trend
          </CardTitle>
          <CardDescription className="text-xs">7-day rolling average</CardDescription>
        </CardHeader>
        <CardContent>
          {sleepTrend.length === 0 ? (
            <EmptyMsg>No sleep data yet.</EmptyMsg>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={sleepTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="sleep" name="Sleep score" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="battery" name="Body battery" stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 8. Running IQ trend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Brain className="w-4 h-4 text-primary" /> Running IQ
          </CardTitle>
          <CardDescription className="text-xs">Score over time with milestones</CardDescription>
        </CardHeader>
        <CardContent>
          {iqTrend.length < 2 ? (
            <EmptyMsg>Need at least 2 IQ snapshots.</EmptyMsg>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={iqTrend}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                <YAxis domain={[0, 200]} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="score" name="IQ" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                {milestones.map((m, i) => (
                  <ReferenceDot key={i} x={m.date} y={m.score} r={5} fill="hsl(var(--chart-3))" stroke="hsl(var(--background))" label={{ value: m.label, position: "top", fontSize: 9 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* 9. Race time history */}
      {raceTimeHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Timer className="w-4 h-4 text-primary" /> Estimated Race Time
            </CardTitle>
            <CardDescription className="text-xs">
              Best weekly estimate trending toward goal{plan.goal_time ? ` (${plan.goal_time})` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={raceTimeHistory}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                <YAxis reversed tickFormatter={(v) => fmtHMS(v)} tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: any) => fmtHMS(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="estimate" name="Estimate" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
                {goalTimeSec(plan.goal_time) && (
                  <Line type="monotone" dataKey="goal" name="Goal" stroke="hsl(var(--chart-3))" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                )}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ----- Tiny inline helpers -----

function StatPill({ label, value, color }: { label: string; value: number; color: "emerald" | "blue" | "red" | "muted" }) {
  const cls = {
    emerald: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    red: "bg-red-500/15 text-red-600 dark:text-red-400",
    muted: "bg-muted text-muted-foreground",
  }[color];
  return (
    <div className={cn("rounded-lg py-2 px-1", cls)}>
      <div className="text-lg font-semibold leading-tight">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 p-3 text-center">
      <div className="text-2xl font-bold text-foreground">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
function EmptyMsg({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground py-8 text-center">{children}</p>;
}
