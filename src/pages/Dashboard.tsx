import { useEffect, useState, useMemo } from "react";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload, Brain, Calendar, Activity, TrendingUp, Heart,
  Timer, Zap, Flame, ArrowUpRight, ArrowDownRight, Minus,
  Moon, Footprints, ChevronRight, RefreshCw,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";
import ReadinessWidget from "@/components/ReadinessWidget";
import ReadinessHistoryChart from "@/components/ReadinessHistoryChart";

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
}

interface MetricsRow {
  date: string;
  sleep_score: number | null;
  sleep_duration_seconds: number | null;
  steps: number | null;
  resting_heart_rate: number | null;
  hrv: number | null;
}

// ── Shared tooltip style ──

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.1)",
};

// ── Dashboard ──

const Dashboard = () => {
  const { profile } = useProfile();
  const { user, session } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [metrics, setMetrics] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const handleSyncAll = async () => {
    if (!session?.access_token || syncing) return;
    setSyncing(true);
    const results: string[] = [];
    const headers = {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    };
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;

    try {
      // Strava
      const stravaRes = await fetch(`${baseUrl}/functions/v1/strava-import`, {
        method: "POST", headers, body: JSON.stringify({ mode: "recent" }),
      }).catch(() => null);
      if (stravaRes?.ok) {
        const d = await stravaRes.json();
        if (d.imported > 0) results.push(`${d.imported} Strava activities`);
      }

      // Intervals.icu wellness
      const intRes = await fetch(`${baseUrl}/functions/v1/intervals-wellness`, {
        method: "POST", headers,
      }).catch(() => null);
      if (intRes?.ok) {
        const d = await intRes.json();
        if (d.upserted > 0) results.push(`${d.upserted} wellness records`);
      }

      // Google Fit sleep
      const gfRes = await fetch(`${baseUrl}/functions/v1/google-fit-sleep`, {
        method: "POST", headers, body: JSON.stringify({ days: 3 }),
      }).catch(() => null);
      if (gfRes?.ok) {
        const d = await gfRes.json();
        if (d.synced > 0) results.push(`${d.synced} sleep segments`);
      }

      toast({
        title: results.length > 0 ? "Sync complete" : "Everything up to date",
        description: results.length > 0 ? results.join(", ") : "No new data found from any source",
      });

      // Refresh dashboard data
      if (results.length > 0 && user) {
        const since = new Date();
        since.setDate(since.getDate() - 56);
        supabase.from("activities")
          .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, avg_power, calories, training_effect")
          .eq("user_id", user.id).gte("start_time", since.toISOString()).order("start_time", { ascending: true })
          .then(({ data }) => setActivities((data as ActivityRow[]) || []));
        supabase.from("daily_metrics")
          .select("date, sleep_score, sleep_duration_seconds, steps, resting_heart_rate, hrv")
          .eq("user_id", user.id).gte("date", since.toISOString().split("T")[0]).order("date", { ascending: true })
          .then(({ data }) => setMetrics((data as MetricsRow[]) || []));
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    const since = new Date();
    since.setDate(since.getDate() - 56);

    supabase
      .from("activities")
      .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, avg_power, calories, training_effect")
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

  const hasData = stats && stats.count > 0;

  // Greeting based on time of day
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 5) return "Late night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Late night";
  }, []);

  return (
    <div className="space-y-8 pb-8">
      {/* ── Hero Header ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-card to-accent/5 border border-primary/10 p-6 sm:p-8">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/5 to-transparent rounded-full blur-3xl -translate-y-1/2 translate-x-1/4" />
        <div className="relative">
          <p className="text-sm font-medium text-primary tracking-wide uppercase mb-1">{greeting}</p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {profile?.name || "Athlete"}
          </h1>
          <p className="text-muted-foreground mt-2 max-w-md">
            Your AI-powered endurance training command centre
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4 gap-2"
            onClick={handleSyncAll}
            disabled={syncing}
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync All Sources"}
          </Button>
        </div>
      </div>

      {/* ── Readiness ── */}
      <ReadinessWidget />
      <ReadinessHistoryChart />

      {/* ── Quick Actions ── */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ActionCard icon={Upload} title="Import Data" desc="Upload FIT files" to="/upload" navigate={navigate} accent="primary" />
        <ActionCard icon={Brain} title="AI Analysis" desc="Get training insights" to="/analysis" navigate={navigate} accent="chart-2" />
        <ActionCard icon={Calendar} title="Training Plan" desc="Generate your plan" to="/training-plan" navigate={navigate} accent="accent" />
      </div>

      {!hasData ? (
        <Card className="border-dashed border-2 border-muted-foreground/20">
          <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <div className="rounded-full bg-muted p-6 mb-6">
              <Upload className="w-10 h-10 opacity-40" />
            </div>
            <p className="text-xl font-semibold text-foreground">No data yet</p>
            <p className="text-sm mt-1 mb-6">Upload your first FIT file to unlock your dashboard</p>
            <Button size="lg" className="gap-2 shadow-lg shadow-primary/20" onClick={() => navigate("/upload")}>
              <Upload className="w-4 h-4" />
              Import Data
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── KPI Strip ── */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KPICard
              icon={Activity}
              label="Activities"
              value={`${stats.count}`}
              sub="Last 8 weeks"
              color="primary"
            />
            <KPICard
              icon={Timer}
              label="Total Time"
              value={`${stats.totalHours}h`}
              sub="Training volume"
              color="chart-2"
            />
            <KPICard
              icon={Heart}
              label="Avg HR"
              value={stats.avgHR ? `${stats.avgHR}` : "—"}
              unit={stats.avgHR ? "bpm" : ""}
              sub="Across sessions"
              color="destructive"
            />
            <KPICard
              icon={TrendingUp}
              label="ACWR"
              value={stats.acwr !== null ? `${stats.acwr}` : "—"}
              sub={
                stats.acwr !== null
                  ? stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "Sweet spot"
                    : stats.acwr > 1.5
                    ? "High risk"
                    : "Under-training"
                  : "Need more data"
              }
              color={
                stats.acwr !== null && stats.acwr >= 0.8 && stats.acwr <= 1.3
                  ? "primary"
                  : stats.acwr !== null && stats.acwr > 1.3
                  ? "destructive"
                  : "accent"
              }
              trend={
                stats.acwr !== null
                  ? stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "neutral"
                    : stats.acwr > 1.3
                    ? "up"
                    : "down"
                  : undefined
              }
            />
          </div>

          {/* ── Load Balance Highlight ── */}
          <Card className="overflow-hidden">
            <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
              <LoadStat label="Acute Load" value={stats.acuteLoad} unit="min" sub="Last 7 days" />
              <LoadStat label="Chronic Load" value={stats.chronicLoad} unit="min/wk" sub="Last 28 days" />
              <div className="p-6 flex flex-col items-center justify-center text-center">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ACWR Ratio</p>
                <p className={`text-4xl font-black tracking-tight ${
                  stats.acwr !== null && stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "text-primary"
                    : stats.acwr !== null && stats.acwr > 1.5
                    ? "text-destructive"
                    : "text-accent"
                }`}>
                  {stats.acwr ?? "—"}
                </p>
                <div className={`mt-2 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${
                  stats.acwr !== null && stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "bg-primary/10 text-primary"
                    : stats.acwr !== null && stats.acwr > 1.5
                    ? "bg-destructive/10 text-destructive"
                    : "bg-accent/10 text-accent"
                }`}>
                  {stats.acwr !== null
                    ? stats.acwr >= 0.8 && stats.acwr <= 1.3
                      ? "✅ Optimal zone"
                      : stats.acwr > 1.5
                      ? "⚠️ Injury risk"
                      : "📉 Build more"
                    : "Insufficient data"}
                </div>
              </div>
            </div>
          </Card>

          {/* ── Charts Grid ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              icon={<Zap className="w-4 h-4" />}
              title="Weekly Training Load"
              description="Minutes per week"
              iconColor="text-primary"
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.weeks} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
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

            <ChartCard
              icon={<Heart className="w-4 h-4" />}
              title="Heart Rate Trend"
              description="Average HR per session"
              iconColor="text-destructive"
            >
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={stats.hrTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
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
              <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
                <Moon className="w-4 h-4 text-primary" />
                Wellness Trends
              </h2>

              <div className="grid gap-4 lg:grid-cols-2">
                {/* Sleep Score */}
                <ChartCard
                  icon={<Moon className="w-4 h-4" />}
                  title="Sleep Score"
                  description="Daily sleep quality"
                  iconColor="text-primary"
                >
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={metrics.filter(m => m.sleep_score != null).map(m => ({
                      date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      score: m.sleep_score,
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
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

                {/* Steps */}
                <ChartCard
                  icon={<Footprints className="w-4 h-4" />}
                  title="Daily Steps"
                  description="Step count trend"
                  iconColor="text-primary"
                >
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={metrics.filter(m => m.steps != null).map(m => ({
                      date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      steps: m.steps,
                    }))} barCategoryGap="15%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
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

              {/* Resting HR */}
              {metrics.some(m => m.resting_heart_rate != null) && (
                <ChartCard
                  icon={<Heart className="w-4 h-4" />}
                  title="Resting Heart Rate"
                  description="Daily resting HR trend"
                  iconColor="text-destructive"
                >
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={metrics.filter(m => m.resting_heart_rate != null).map(m => ({
                      date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                      rhr: Math.round(m.resting_heart_rate!),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
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
    </div>
  );
};

// ── Sub-components ──

const ActionCard = ({
  icon: Icon, title, desc, to, navigate, accent,
}: {
  icon: any; title: string; desc: string; to: string; navigate: (to: string) => void; accent: string;
}) => (
  <Card
    className="group cursor-pointer border-transparent bg-gradient-to-br from-card to-muted/30 hover:border-primary/20 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300"
    onClick={() => navigate(to)}
  >
    <CardHeader className="flex flex-row items-center gap-3 p-4">
      <div className="rounded-xl bg-primary/10 p-2.5 group-hover:bg-primary/15 transition-colors">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
    </CardHeader>
  </Card>
);

const KPICard = ({
  icon: Icon, label, value, unit, sub, color, trend,
}: {
  icon: any; label: string; value: string; unit?: string; sub: string; color: string; trend?: "up" | "down" | "neutral";
}) => (
  <Card className="group hover:shadow-md transition-shadow duration-200 overflow-hidden relative">
    <div className={`absolute inset-x-0 top-0 h-1 bg-${color}`} />
    <CardContent className="p-4 pt-5">
      <div className="flex items-center justify-between mb-3">
        <div className={`rounded-lg bg-${color}/10 p-1.5`}>
          <Icon className={`w-3.5 h-3.5 text-${color}`} />
        </div>
        {trend === "up" && <ArrowUpRight className="w-4 h-4 text-destructive" />}
        {trend === "down" && <ArrowDownRight className="w-4 h-4 text-accent" />}
        {trend === "neutral" && <Minus className="w-4 h-4 text-primary" />}
      </div>
      <div className="flex items-baseline gap-1">
        <p className="text-2xl font-black tracking-tight">{value}</p>
        {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
      </div>
      <p className="text-xs font-medium text-muted-foreground mt-0.5">{label}</p>
      <p className="text-[11px] text-muted-foreground/70 mt-0.5">{sub}</p>
    </CardContent>
  </Card>
);

const LoadStat = ({ label, value, unit, sub }: { label: string; value: number; unit: string; sub: string }) => (
  <div className="p-6 text-center">
    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
    <div className="flex items-baseline justify-center gap-1">
      <p className="text-3xl font-black tracking-tight">{value}</p>
      <span className="text-sm font-medium text-muted-foreground">{unit}</span>
    </div>
    <p className="text-xs text-muted-foreground/70 mt-1">{sub}</p>
  </div>
);

const ChartCard = ({
  icon, title, description, iconColor, children,
}: {
  icon: React.ReactNode; title: string; description: string; iconColor: string; children: React.ReactNode;
}) => (
  <Card className="overflow-hidden">
    <CardHeader className="pb-2">
      <CardTitle className="text-sm font-semibold flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        {title}
      </CardTitle>
      <CardDescription className="text-xs">{description}</CardDescription>
    </CardHeader>
    <CardContent className="pr-2">
      {children}
    </CardContent>
  </Card>
);

export default Dashboard;
