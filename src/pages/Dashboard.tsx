import { useEffect, useState, useMemo } from "react";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload, Brain, Calendar, Activity, TrendingUp, Heart,
  Timer, Zap, Flame, Moon, Footprints, RefreshCw, Medal,
  ChevronRight, Trash2, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";
import RunningIQWidget from "@/components/RunningIQWidget";
import ActivityDetailDialog from "@/components/ActivityDetailDialog";
import FeedbackCard from "@/components/FeedbackCard";
import { parseWorkoutsFromPlan } from "@/lib/plan-export";
import { format, isToday, isAfter, startOfDay } from "date-fns";
import { dedupeActivities, purgeAllStravaOverlaps } from "@/lib/activity-dedupe";
import HeroPlanCard from "@/components/HeroPlanCard";
import BlogPreview from "@/components/BlogPreview";
import WorkoutReviewDialog from "@/components/WorkoutReviewDialog";


// ── Types ──

interface ActivityRow {
  id: string;
  activity_type: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_speed: number | null;
  avg_power: number | null;
  calories: number | null;
  training_effect: number | null;
  source_file: string | null;
}

interface MetricsRow {
  date: string;
  sleep_score: number | null;
  sleep_duration_seconds: number | null;
  steps: number | null;
  resting_heart_rate: number | null;
  hrv: number | null;
}

interface PlanRow {
  content: string;
  start_date: string;
  training_days: string[];
  race_distance: string | null;
}

// ── Motivational quotes ──
const quotes = [
  { text: "We run, not because we think it is doing us good, but because we enjoy it and cannot help ourselves.", author: "Sir Roger Bannister" },
  { text: "The miracle isn't that I finished. The miracle is that I had the courage to start.", author: "John Bingham" },
  { text: "Run when you can, walk if you have to, crawl if you must; just never give up.", author: "Dean Karnazes" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "Pain is temporary. Quitting lasts forever.", author: "Lance Armstrong" },
  { text: "The only bad workout is the one that didn't happen.", author: "Unknown" },
];

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.1)",
};

// ── Circular Progress Ring ──
function ProgressRing({
  value,
  max,
  size = 160,
  strokeWidth = 10,
}: {
  value: number;
  max: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = max > 0 ? Math.min(value / max, 1) : 0;
  const dashOffset = circumference * (1 - progress);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--destructive))"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-all duration-1000 ease-out"
          style={{ filter: "drop-shadow(0 0 8px hsl(var(--destructive) / 0.5))" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black tracking-tight">{value}</span>
        <span className="text-xs text-muted-foreground">/ {max}</span>
      </div>
    </div>
  );
}

// ── Dashboard ──

const Dashboard = () => {
  const { profile } = useProfile();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [metrics, setMetrics] = useState<MetricsRow[]>([]);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);

  const deleteRun = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this activity? This cannot be undone.")) return;
    setDeletingRunId(id);
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      setActivities((prev) => prev.filter((a) => a.id !== id));
      toast({ title: "Activity deleted" });
    }
    setDeletingRunId(null);
  };

  const dailyQuote = useMemo(() => {
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    return quotes[dayOfYear % quotes.length];
  }, []);

  const handleSyncAll = async () => {
    if (!session?.access_token || syncing) return;
    setSyncing(true);
    const headers = {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    };
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;

    interface SyncResult { source: string; status: "success" | "skipped" | "error"; detail: string }
    const results: SyncResult[] = [];

    // Intervals.icu wellness
    try {
      const res = await fetch(`${baseUrl}/functions/v1/intervals-wellness`, {
        method: "POST", headers,
      });
      if (res.ok) {
        const d = await res.json();
        results.push({
          source: "Intervals.icu",
          status: d.synced > 0 ? "success" : "skipped",
          detail: d.synced > 0 ? `${d.synced} wellness records` : "No new wellness data",
        });
      } else {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        results.push({ source: "Intervals.icu", status: "error", detail: errBody.error || `HTTP ${res.status}` });
      }
    } catch {
      results.push({ source: "Intervals.icu", status: "error", detail: "Not connected" });
    }

    // Google Fit sleep
    try {
      const res = await fetch(`${baseUrl}/functions/v1/google-fit-sleep`, {
        method: "POST", headers, body: JSON.stringify({ days: 7 }),
      });
      if (res.ok) {
        const d = await res.json();
        results.push({
          source: "Google Fit",
          status: d.synced > 0 ? "success" : "skipped",
          detail: d.synced > 0 ? `${d.synced} sleep segments` : "No new sleep data",
        });
      } else {
        const errBody = await res.json().catch(() => ({ error: res.statusText }));
        results.push({ source: "Google Fit", status: "error", detail: errBody.error || `HTTP ${res.status}` });
      }
    } catch {
      results.push({ source: "Google Fit", status: "error", detail: "Not connected" });
    }

    // Build detailed toast
    const successCount = results.filter(r => r.status === "success").length;
    const errorCount = results.filter(r => r.status === "error").length;
    const icons: Record<string, string> = { success: "✅", skipped: "—", error: "❌" };

    const descriptionEl = (
      <div className="flex flex-col gap-1 mt-1">
        {results.map((r, i) => (
          <div key={i} className="text-sm">
            {icons[r.status]} <span className="font-medium">{r.source}:</span> {r.detail}
          </div>
        ))}
      </div>
    );

    toast({
      title: successCount > 0
        ? `Sync complete — ${successCount} source${successCount > 1 ? "s" : ""} updated`
        : errorCount === results.length
        ? "Sync failed"
        : "Everything up to date",
      description: descriptionEl,
      variant: errorCount === results.length ? "destructive" : undefined,
      duration: 8000,
    });

    // Refresh data if anything was synced
    if (successCount > 0 && user) {
      const since = new Date();
      since.setDate(since.getDate() - 56);
      supabase.from("activities")
        .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, avg_power, calories, training_effect, source_file")
        .eq("user_id", user.id).gte("start_time", since.toISOString()).order("start_time", { ascending: true })
        .then(({ data }) => setActivities((data as ActivityRow[]) || []));
      supabase.from("daily_metrics")
        .select("date, sleep_score, sleep_duration_seconds, steps, resting_heart_rate, hrv")
        .eq("user_id", user.id).gte("date", since.toISOString().split("T")[0]).order("date", { ascending: true })
        .then(({ data }) => setMetrics((data as MetricsRow[]) || []));
    }

    setSyncing(false);
  };

  useEffect(() => {
    if (!user) return;
    const since = new Date();
    since.setDate(since.getDate() - 56);

    supabase
      .from("activities")
      .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, avg_power, calories, training_effect, source_file")
      .eq("user_id", user.id)
      .gte("start_time", since.toISOString())
      .order("start_time", { ascending: true })
      .then(({ data }) => setActivities((data as ActivityRow[]) || []));

    supabase
      .from("daily_metrics")
      .select("date, sleep_score, sleep_duration_seconds, steps, resting_heart_rate, hrv")
      .eq("user_id", user.id)
      .gte("date", since.toISOString().split("T")[0])
      .order("date", { ascending: true })
      .then(({ data }) => {
        setMetrics((data as MetricsRow[]) || []);
        setLoading(false);
      });

    // Get latest training plan for "Today's Workout" card
    supabase
      .from("training_plans")
      .select("content, start_date, training_days, race_distance")
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) setPlan(data[0] as PlanRow);
      });

    // One-time cleanup: delete any Strava activities that overlap a FIT
    // activity (FIT always wins). Refreshes the visible list when rows change.
    purgeAllStravaOverlaps(user.id).then((removed) => {
      if (removed > 0) {
        supabase
          .from("activities")
          .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, avg_power, calories, training_effect, source_file")
          .eq("user_id", user.id)
          .gte("start_time", since.toISOString())
          .order("start_time", { ascending: true })
          .then(({ data }) => setActivities((data as ActivityRow[]) || []));
      }
    }).catch((e) => console.error("Strava sweep failed:", e));
  }, [user]);

  const stats = useMemo(() => {
    if (activities.length === 0) return null;

    const totalDuration = activities.reduce((s, a) => s + (a.duration_seconds || 0), 0);
    const totalCalories = activities.reduce((s, a) => s + (a.calories || 0), 0);
    const hrs = activities.filter((a) => a.avg_heart_rate).map((a) => a.avg_heart_rate!);
    const avgHR = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;

    const weekMap = new Map<string, number>();
    activities.forEach((a) => {
      if (!a.start_time) return;
      const d = new Date(a.start_time);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = weekStart.toISOString().split("T")[0];
      weekMap.set(key, (weekMap.get(key) || 0) + (a.duration_seconds || 0) / 60);
    });

    const weeks = Array.from(weekMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, mins]) => ({
        week: new Date(week).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        load: Math.round(mins),
      }));

    const now = new Date();
    const acute = activities
      .filter((a) => a.start_time && new Date(a.start_time) >= new Date(now.getTime() - 7 * 86400000))
      .reduce((s, a) => s + (a.duration_seconds || 0) / 60, 0);
    const chronic = activities
      .filter((a) => a.start_time && new Date(a.start_time) >= new Date(now.getTime() - 28 * 86400000))
      .reduce((s, a) => s + (a.duration_seconds || 0) / 60, 0) / 4;

    const acwr = chronic > 0 ? acute / chronic : null;

    const hrTrend = activities
      .filter((a) => a.avg_heart_rate && a.start_time)
      .map((a) => ({
        date: new Date(a.start_time!).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        hr: Math.round(a.avg_heart_rate!),
      }));

    return {
      count: activities.length,
      totalHours: Math.round(totalDuration / 3600 * 10) / 10,
      totalCalories: Math.round(totalCalories),
      avgHR,
      weeks,
      acwr: acwr ? Math.round(acwr * 100) / 100 : null,
      acuteLoad: Math.round(acute),
      chronicLoad: Math.round(chronic),
      hrTrend,
    };
  }, [activities]);

  // Weekly progress (Mon–Sun, based on the actual training plan)
  const weeklyProgress = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    const dow = now.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    startOfWeek.setDate(now.getDate() + diffToMon);
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 7);
    const lastWeekStart = new Date(startOfWeek);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);

    const inRange = (d: Date, s: Date, e: Date) => d >= s && d < e;
    const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    // Activity dates (yyyy-mm-dd) this week and last week
    const activityDatesThisWeek = new Set<string>();
    let lastWeekActivityCount = 0;
    // Only count running activities — walks shouldn't count as completed workouts
    const isRunning = (a: any) => {
      const t = (a.activity_type || "").toLowerCase();
      return t.includes("run");
    };
    for (const a of activities) {
      if (!a.start_time || !isRunning(a)) continue;
      const d = new Date(a.start_time);
      if (inRange(d, startOfWeek, endOfWeek)) activityDatesThisWeek.add(ymd(d));
      else if (inRange(d, lastWeekStart, startOfWeek)) lastWeekActivityCount++;
    }

    // Planned (non-rest) workouts this week from the parsed plan
    let plannedDates: string[] = [];
    if (plan?.content) {
      const workouts = parseWorkoutsFromPlan(plan.content);
      plannedDates = workouts
        .filter((w) => w.dateObj && inRange(w.dateObj, startOfWeek, endOfWeek) && !/rest/i.test(w.title))
        .map((w) => ymd(w.dateObj!));
    }

    const planned = plannedDates.length;
    // Completed = a planned workout date that has at least one activity logged on that day
    const completed = plannedDates.filter((d) => activityDatesThisWeek.has(d)).length;

    return {
      completed,
      planned,
      delta: activityDatesThisWeek.size - lastWeekActivityCount,
    };
  }, [activities, plan]);

  // Recent runs (last 3)
  const recentRuns = useMemo(() => {
    return dedupeActivities(activities)
      .filter((a) => a.distance_meters && a.duration_seconds)
      .filter((a) => !/walk/i.test(a.activity_type || ""))
      .slice(0, 3)
      .map((a, i) => {
        const distMi = (a.distance_meters || 0) / 1609.34;
        const durMin = (a.duration_seconds || 0) / 60;
        const pace = distMi > 0 ? durMin / distMi : 0;
        const paceMin = Math.floor(pace);
        const paceSec = Math.round((pace - paceMin) * 60);
        const colors = ["bg-emerald-500", "bg-amber-500", "bg-purple-500"];
        const d = a.start_time ? new Date(a.start_time) : null;
        const dateStr = d
          ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getFullYear()).slice(-2)}`
          : "";
        return {
          id: a.id,
          dist: distMi.toFixed(2),
          pace: `${paceMin}:${paceSec.toString().padStart(2, "0")}`,
          color: colors[i % colors.length],
          type: a.activity_type || "Run",
          date: dateStr,
        };
      });
  }, [activities]);

  // Today's workout (or next upcoming) from plan
  const todaysWorkout = useMemo(() => {
    if (!plan?.content) return null;
    const workouts = parseWorkoutsFromPlan(plan.content).filter(w => w.dateObj);
    if (workouts.length === 0) return null;
    const today = startOfDay(new Date());

    const isRest = (w: typeof workouts[number]) => /rest/i.test(w.title);

    const todays = workouts.find(w => isToday(w.dateObj!));
    if (todays && !isRest(todays)) {
      return { workout: todays, isNext: false };
    }

    // Today is rest or no workout today → find next non-rest workout
    const upcoming = workouts
      .filter(w => isAfter(startOfDay(w.dateObj!), today) && !isRest(w))
      .sort((a, b) => a.dateObj!.getTime() - b.dateObj!.getTime())[0];

    return upcoming ? { workout: upcoming, isNext: true } : null;
  }, [plan]);

  // Has the user completed a run today?
  const completedToday = useMemo(() => {
    return activities.some((a) => {
      if (!a.start_time) return false;
      if (/walk/i.test(a.activity_type || "")) return false;
      if (!a.distance_meters || !a.duration_seconds) return false;
      return isToday(new Date(a.start_time));
    });
  }, [activities]);

  // Today's completed activity (full row) — used for the review dialog
  const todaysActivity = useMemo(() => {
    return activities.find((a) => {
      if (!a.start_time) return false;
      if (/walk/i.test(a.activity_type || "")) return false;
      if (!a.distance_meters || !a.duration_seconds) return false;
      return isToday(new Date(a.start_time));
    }) || null;
  }, [activities]);

  const [reviewOpen, setReviewOpen] = useState(false);

  // Latest resting HR
  const latestRHR = useMemo(() => {
    const withRHR = metrics.filter((m) => m.resting_heart_rate);
    return withRHR.length > 0 ? withRHR[withRHR.length - 1].resting_heart_rate : null;
  }, [metrics]);

  // Completed run dates + parsed workouts for hero strip
  const heroData = useMemo(() => {
    const ymd = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const completed = new Set<string>();
    for (const a of activities) {
      if (!a.start_time) continue;
      if (/walk/i.test(a.activity_type || "")) continue;
      if (!a.distance_meters || !a.duration_seconds) continue;
      completed.add(ymd(new Date(a.start_time)));
    }
    const workouts = plan?.content ? parseWorkoutsFromPlan(plan.content) : [];
    return { completed, workouts };
  }, [activities, plan]);

  const hasData = stats && stats.count > 0;

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Late night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Late night";
  }, []);

  // AI coach focus message
  const coachFocus = useMemo(() => {
    if (!stats) return null;
    const { acwr, count } = stats;
    if (count < 3) return "Let's work on your solid — Some gaps in training detected — 3+ runs per week for 6+ weeks unlocks the best adaptations.";
    if (acwr !== null && acwr > 1.5) return "Your training load is ramping up fast. Consider an easy week to let your body adapt and reduce injury risk.";
    if (acwr !== null && acwr < 0.8) return "You have capacity to train harder. Gradually increase volume this week — your body is ready for more.";
    return "You're in the sweet spot! Keep this consistent training rhythm going. Consistency beats intensity over time.";
  }, [stats]);

  return (
    <div className="space-y-4 pb-8 animate-fade-in">
      {/* ── Hero Plan Card (full-bleed) ── */}
      <div className="-mx-4 sm:-mx-6 lg:-mx-8 -mt-6">
        <HeroPlanCard
          name={profile?.name || null}
          raceDistance={plan?.race_distance || null}
          planStartDate={plan?.start_date || null}
          nextRunDate={todaysWorkout?.workout?.dateObj || null}
          completedDates={heroData.completed}
          workouts={heroData.workouts}
        />
      </div>

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
          {greeting}, <span className="gradient-text">{profile?.name || "Runner"}</span>
        </h1>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl"
            onClick={handleSyncAll}
            disabled={syncing}
          >
            <RefreshCw className={`w-5 h-5 ${syncing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* ── Motivational Quote ── */}
      <p className="text-sm text-muted-foreground leading-relaxed italic">
        "{dailyQuote.text}" — {dailyQuote.author}
      </p>

      {/* ── Build a plan CTA (when user has no plan) ── */}
      {!plan && (
        <Card
          className="glass border-primary/30 bg-gradient-to-r from-primary/15 via-accent/10 to-primary/15 cursor-pointer hover:from-primary/25 hover:to-primary/25 transition-colors"
          onClick={() => navigate("/training-plan")}
        >
          <CardContent className="flex items-center gap-4 py-4 px-5">
            <div className="rounded-full bg-primary/20 p-3">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold">Build a plan!</p>
              <p className="text-xs text-muted-foreground">
                Get a personalised AI training plan tailored to your goals.
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-primary" />
          </CardContent>
        </Card>
      )}

      {/* ── Running IQ ── */}
      <RunningIQWidget />
      

      {!hasData ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <div className="rounded-full bg-muted p-5 mb-5">
              <Upload className="w-8 h-8 opacity-40" />
            </div>
            <p className="text-lg font-semibold text-foreground">No data yet</p>
            <p className="text-sm mt-1 mb-5">Upload your first FIT file to unlock your dashboard</p>
            <Button size="lg" className="gap-2 shadow-lg shadow-primary/20" onClick={() => navigate("/upload")}>
              <Upload className="w-4 h-4" />
              Import Data
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Weekly Progress + Today's Workout ── */}
          <div className="grid grid-cols-2 gap-3">
            {/* Weekly Progress */}
            <Card className="glass border-border/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Weekly Progress</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-center pb-4 px-4">
                <ProgressRing value={weeklyProgress.completed} max={weeklyProgress.planned} size={140} />
                <div className="mt-3 text-center">
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Footprints className="w-3 h-3" />
                    {weeklyProgress.completed} of {weeklyProgress.planned} workouts
                  </p>
                  <p className={`text-xs font-medium mt-0.5 ${weeklyProgress.delta >= 0 ? "text-emerald-500" : "text-destructive"}`}>
                    {weeklyProgress.delta >= 0 ? "+" : ""}{weeklyProgress.delta} vs last week
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Today's Workout */}
            <Card
              className={`glass border-border/30 relative overflow-hidden ${completedToday && !todaysWorkout?.isNext ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
              onClick={() => {
                if (completedToday && !todaysWorkout?.isNext && todaysWorkout?.workout && todaysActivity) {
                  setReviewOpen(true);
                }
              }}
            >
              {completedToday && !todaysWorkout?.isNext && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                  <div
                    className="select-none -rotate-12 px-5 py-2 rounded-md border-[3px] border-emerald-500/80 text-emerald-500 font-extrabold tracking-wider uppercase text-2xl bg-background/40 backdrop-blur-[2px]"
                    style={{
                      boxShadow: "inset 0 0 0 2px hsl(var(--background) / 0.6)",
                      fontFamily: "'Space Grotesk', sans-serif",
                      textShadow: "1px 1px 0 hsl(var(--background) / 0.3)",
                    }}
                  >
                    Completed&nbsp;It!
                  </div>
                </div>
              )}
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">
                  {todaysWorkout?.isNext ? "Next Run" : "Today's Run"}
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
                {todaysWorkout ? (
                  <div className="space-y-1.5">
                    {todaysWorkout.isNext && todaysWorkout.workout.dateObj && (
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {format(todaysWorkout.workout.dateObj, "EEE d MMM")}
                      </p>
                    )}
                    <p className="text-xs font-semibold text-primary">
                      {todaysWorkout.workout.title.replace(/\s*\(Total:.*?\)/, "")}
                    </p>
                    {todaysWorkout.workout.segments.slice(0, 4).map((s, i) => (
                      <p key={i} className="text-xs text-muted-foreground leading-tight">
                        {s.segment}: {s.duration}{s.target && s.target !== "—" ? ` @ ${s.target}` : ""}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No upcoming workouts. Enjoy your rest! 🧘</p>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-3 text-xs gap-1.5 bg-gradient-to-r from-primary/20 to-accent/20 hover:from-primary/30 hover:to-accent/30 rounded-xl"
                  onClick={(e) => { e.stopPropagation(); navigate("/training-plan"); }}
                >
                  <Calendar className="w-3 h-3" />
                  View Plan
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* ── Workouts This Week Summary ── */}
          <Card className="glass border-border/30">
            <CardContent className="flex items-center gap-4 py-4 px-5">
              <span className="text-2xl">🏃</span>
              <div className="flex-1">
                <p className="text-sm font-bold">
                  {weeklyProgress.completed} / {weeklyProgress.planned} workouts this week
                </p>
                <p className="text-xs text-muted-foreground">
                  ↓ {Math.abs(weeklyProgress.delta)} last week
                </p>
              </div>
              <div className="text-sm font-bold px-3 py-1 rounded-full bg-primary/10 text-primary">
                +{weeklyProgress.delta >= 0 ? weeklyProgress.delta : 0}
              </div>
            </CardContent>
          </Card>

          {/* ── Recent Runs + Resting HR ── */}
          <div className="grid grid-cols-5 gap-3">
            {/* Recent Runs - takes 3 columns */}
            <Card className="col-span-3 glass border-border/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-semibold">Recent Runs</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2.5">
                {recentRuns.length > 0 ? recentRuns.map((run) => (
                  <div
                    key={run.id}
                    className="w-full flex items-center gap-3 rounded-lg px-1 py-1 -mx-1 hover:bg-muted/40 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setOpenActivityId(run.id)}
                      className="flex items-center gap-3 flex-1 text-left min-w-0"
                    >
                      <span className={`w-2.5 h-2.5 rounded-full ${run.color} shrink-0`} />
                      <span className="text-[11px] text-muted-foreground w-14 shrink-0">{run.date}</span>
                      <span className="text-sm font-semibold flex-1">{run.dist} mi</span>
                      <span className="text-xs text-muted-foreground">{run.pace} /mi</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => deleteRun(run.id, e)}
                      disabled={deletingRunId === run.id}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                      aria-label="Delete activity"
                    >
                      {deletingRunId === run.id
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                )) : (
                  <p className="text-xs text-muted-foreground">No recent runs yet</p>
                )}
              </CardContent>
            </Card>

            {/* Resting HR + Recovery Tip - takes 2 columns */}
            <div className="col-span-2 space-y-3">
              <Card className="glass border-border/30">
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground mb-1">Hydrate well today to aid your recovery</p>
                </CardContent>
              </Card>

              <Card className="glass border-border/30">
                <CardContent className="p-4 flex flex-col items-center">
                  <Heart className="w-5 h-5 text-destructive mb-1" />
                  <p className="text-2xl font-black">{latestRHR ?? "—"}<span className="text-sm font-normal text-muted-foreground ml-1">bpm</span></p>
                  <p className="text-[10px] text-muted-foreground">Resting HR</p>
                </CardContent>
              </Card>
            </div>
          </div>


          {/* ── Quick Actions ── */}
          <div className="grid gap-3 sm:grid-cols-3">
            <ActionCard icon={Upload} title="Import Data" desc="Upload FIT files" to="/upload" navigate={navigate} />
            <ActionCard icon={Brain} title="AI Analysis" desc="Get training insights" to="/analysis" navigate={navigate} />
            <ActionCard icon={Calendar} title="Training Plan" desc="Generate your plan" to="/training-plan" navigate={navigate} />
          </div>

          {/* ── KPI Strip ── */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KPICard icon={Activity} label="Activities" value={`${stats.count}`} sub="Last 8 weeks" />
            <KPICard icon={Timer} label="Total Time" value={`${stats.totalHours}h`} sub="Training volume" />
            <KPICard icon={Heart} label="Avg HR" value={stats.avgHR ? `${stats.avgHR}` : "—"} unit={stats.avgHR ? "bpm" : ""} sub="Across sessions" />
            <KPICard icon={TrendingUp} label="ACWR" value={stats.acwr !== null ? `${stats.acwr}` : "—"} sub={
              stats.acwr !== null
                ? stats.acwr >= 0.8 && stats.acwr <= 1.3 ? "Sweet spot" : stats.acwr > 1.5 ? "High risk" : "Under-training"
                : "Need more data"
            } />
          </div>

          {/* ── Load Balance ── */}
          <Card className="overflow-hidden glass border-border/30">
            <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <LoadStat label="Acute Load" value={stats.acuteLoad} unit="min" sub="Last 7 days" />
              <LoadStat label="Chronic Load" value={stats.chronicLoad} unit="min/wk" sub="Last 28 days" />
              <div className="p-5 flex flex-col items-center justify-center text-center">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">ACWR</p>
                <p className={`text-3xl font-black tracking-tight ${
                  stats.acwr !== null && stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "text-primary" : stats.acwr !== null && stats.acwr > 1.5 ? "text-destructive" : "text-accent"
                }`}>{stats.acwr ?? "—"}</p>
                <div className={`mt-1.5 inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full ${
                  stats.acwr !== null && stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "bg-primary/10 text-primary" : stats.acwr !== null && stats.acwr > 1.5 ? "bg-destructive/10 text-destructive" : "bg-accent/10 text-accent"
                }`}>
                  {stats.acwr !== null
                    ? stats.acwr >= 0.8 && stats.acwr <= 1.3 ? "✅ Optimal" : stats.acwr > 1.5 ? "⚠️ Injury risk" : "📉 Build more"
                    : "Insufficient data"}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Charts ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard icon={<Zap className="w-4 h-4" />} title="Weekly Training Load" description="Minutes per week" iconColor="text-primary">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={stats.weeks} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} cursor={{ fill: "hsl(var(--muted))" }} />
                  <defs>
                    <linearGradient id="loadGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.4} />
                    </linearGradient>
                  </defs>
                  <Bar dataKey="load" fill="url(#loadGrad)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard icon={<Heart className="w-4 h-4" />} title="Heart Rate Trend" description="Average HR per session" iconColor="text-destructive">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={stats.hrTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} />
                  <defs>
                    <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="hr" stroke="hsl(var(--destructive))" fill="url(#hrGrad)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* ── Wellness Charts ── */}
          {metrics.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-base font-semibold tracking-tight flex items-center gap-2">
                <Moon className="w-4 h-4 text-primary" />
                Wellness Trends
              </h2>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard icon={<Moon className="w-4 h-4" />} title="Sleep Score" description="Daily sleep quality" iconColor="text-primary">
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={metrics.filter(m => m.sleep_score != null).map(m => ({
                      date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      score: m.sleep_score,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} />
                      <defs>
                        <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--chart-4))" stopOpacity={0.25} />
                          <stop offset="100%" stopColor="hsl(var(--chart-4))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="score" stroke="hsl(var(--chart-4))" fill="url(#sleepGrad)" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard icon={<Footprints className="w-4 h-4" />} title="Daily Steps" description="Step count trend" iconColor="text-primary">
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={metrics.filter(m => m.steps != null).map(m => ({
                      date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      steps: m.steps,
                    }))} barCategoryGap="15%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} />
                      <defs>
                        <linearGradient id="stepsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--chart-3))" stopOpacity={0.8} />
                          <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity={0.3} />
                        </linearGradient>
                      </defs>
                      <Bar dataKey="steps" fill="url(#stepsGrad)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              {metrics.some(m => m.resting_heart_rate != null) && (
                <ChartCard icon={<Heart className="w-4 h-4" />} title="Resting Heart Rate" description="Daily resting HR trend" iconColor="text-destructive">
                  <ResponsiveContainer width="100%" height={160}>
                    <LineChart data={metrics.filter(m => m.resting_heart_rate != null).map(m => ({
                      date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      rhr: Math.round(m.resting_heart_rate!),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} />
                      <Line type="monotone" dataKey="rhr" stroke="hsl(var(--destructive))" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 2, fill: "hsl(var(--destructive))" }} />
                    </LineChart>
                  </ResponsiveContainer>
                </ChartCard>
              )}
            </div>
          )}
        </>
      )}
      <FeedbackCard />
      <BlogPreview className="mt-2" />
      <ActivityDetailDialog activityId={openActivityId} onClose={() => setOpenActivityId(null)} />
    </div>
  );
};

// ── Sub-components ──

const ActionCard = ({
  icon: Icon, title, desc, to, navigate,
}: {
  icon: any; title: string; desc: string; to: string; navigate: (to: string) => void;
}) => (
  <Card
    className="group cursor-pointer glass card-hover border-border/30 hover:border-primary/30"
    onClick={() => navigate(to)}
  >
    <CardContent className="flex items-center gap-3 p-4">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 flex items-center justify-center group-hover:from-primary/25 group-hover:to-accent/15 transition-all duration-300">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-300" />
    </CardContent>
  </Card>
);

const KPICard = ({
  icon: Icon, label, value, unit, sub,
}: {
  icon: any; label: string; value: string; unit?: string; sub: string;
}) => (
  <Card className="glass border-border/30 overflow-hidden">
    <CardContent className="p-4">
      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
        <Icon className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex items-baseline gap-1">
        <p className="text-xl font-black tracking-tight">{value}</p>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <p className="text-[11px] font-semibold text-muted-foreground mt-0.5">{label}</p>
      <p className="text-[10px] text-muted-foreground/60">{sub}</p>
    </CardContent>
  </Card>
);

const LoadStat = ({ label, value, unit, sub }: { label: string; value: number; unit: string; sub: string }) => (
  <div className="p-5 text-center">
    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
    <div className="flex items-baseline justify-center gap-1">
      <p className="text-2xl font-black tracking-tight">{value}</p>
      <span className="text-xs text-muted-foreground">{unit}</span>
    </div>
    <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>
  </div>
);

const ChartCard = ({
  icon, title, description, iconColor, children,
}: {
  icon: React.ReactNode; title: string; description: string; iconColor: string; children: React.ReactNode;
}) => (
  <Card className="overflow-hidden glass border-border/30">
    <CardHeader className="pb-1 pt-4 px-4">
      <CardTitle className="text-sm font-semibold flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        {title}
      </CardTitle>
      <p className="text-[11px] text-muted-foreground">{description}</p>
    </CardHeader>
    <CardContent className="pr-2 pb-3 px-4">
      {children}
    </CardContent>
  </Card>
);

export default Dashboard;
