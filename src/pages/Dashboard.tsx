import { useEffect, useState, useMemo } from "react";
import { useProfile } from "@/hooks/useProfile";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Upload, Brain, Calendar, Activity, TrendingUp, Heart,
  Timer, Zap, Flame, ArrowUpRight, ArrowDownRight, Minus,
  Moon, Footprints,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line,
} from "recharts";
import ReadinessWidget from "@/components/ReadinessWidget";

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

const Dashboard = () => {
  const { profile } = useProfile();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [metrics, setMetrics] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const since = new Date();
    since.setDate(since.getDate() - 56);

    // Fetch activities
    supabase
      .from("activities")
      .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, avg_speed, avg_power, calories, training_effect")
      .eq("user_id", user.id)
      .gte("start_time", since.toISOString())
      .order("start_time", { ascending: true })
      .then(({ data }) => {
        setActivities((data as ActivityRow[]) || []);
      });

    // Fetch daily metrics
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

    // Weekly load (duration in minutes per week)
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

    // Acute (7d) vs Chronic (28d) load
    const now = new Date();
    const acute = activities
      .filter((a) => a.start_time && new Date(a.start_time) >= new Date(now.getTime() - 7 * 86400000))
      .reduce((s, a) => s + (a.duration_seconds || 0) / 60, 0);
    const chronic = activities
      .filter((a) => a.start_time && new Date(a.start_time) >= new Date(now.getTime() - 28 * 86400000))
      .reduce((s, a) => s + (a.duration_seconds || 0) / 60, 0) / 4;

    const acwr = chronic > 0 ? acute / chronic : null;

    // HR trend per activity
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome{profile?.name ? `, ${profile.name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your AI-powered endurance training dashboard
        </p>
      </div>

      {/* Morning Readiness */}
      <ReadinessWidget />

      {/* Quick actions */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ActionCard icon={Upload} title="Import Data" desc="Upload FIT files" to="/upload" navigate={navigate} />
        <ActionCard icon={Brain} title="AI Analysis" desc="Get training insights" to="/analysis" navigate={navigate} />
        <ActionCard icon={Calendar} title="Training Plan" desc="Generate your plan" to="/training-plan" navigate={navigate} />
      </div>

      {!hasData ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Upload className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No data yet</p>
            <p className="text-sm">Upload your first FIT file to get started</p>
            <Button className="mt-4" onClick={() => navigate("/upload")}>Import Data</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <KPICard icon={Activity} label="Activities" value={`${stats.count}`} sub="Last 8 weeks" />
            <KPICard icon={Timer} label="Total Time" value={`${stats.totalHours}h`} sub="Training volume" />
            <KPICard icon={Heart} label="Avg HR" value={stats.avgHR ? `${stats.avgHR} bpm` : "—"} sub="Across sessions" />
            <KPICard
              icon={TrendingUp}
              label="ACWR"
              value={stats.acwr !== null ? `${stats.acwr}` : "—"}
              sub={
                stats.acwr !== null
                  ? stats.acwr >= 0.8 && stats.acwr <= 1.3
                    ? "✅ Sweet spot"
                    : stats.acwr > 1.5
                    ? "⚠️ High risk"
                    : "📉 Under-training"
                  : "Need more data"
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

          {/* Training Load Chart */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />
                  Weekly Training Load
                </CardTitle>
                <CardDescription>Minutes per week</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stats.weeks}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="week" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Bar dataKey="load" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Heart className="w-4 h-4 text-destructive" />
                  Heart Rate Trend
                </CardTitle>
                <CardDescription>Average HR per session</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={stats.hrTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    <Area type="monotone" dataKey="hr" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.1} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Load Balance */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="w-4 h-4 text-accent" />
                Load Balance
              </CardTitle>
              <CardDescription>Acute (7d) vs Chronic (28d) training load</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center">
                  <p className="text-2xl font-bold">{stats.acuteLoad}</p>
                  <p className="text-xs text-muted-foreground">Acute Load (min)</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold">{stats.chronicLoad}</p>
                  <p className="text-xs text-muted-foreground">Chronic Load (min/wk)</p>
                </div>
                <div className="text-center">
                  <p className={`text-2xl font-bold ${
                    stats.acwr !== null && stats.acwr >= 0.8 && stats.acwr <= 1.3
                      ? "text-primary"
                      : stats.acwr !== null && stats.acwr > 1.5
                      ? "text-destructive"
                      : "text-accent"
                  }`}>
                    {stats.acwr ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">ACWR Ratio</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Wellness Charts */}
          {metrics.length > 0 && (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Sleep Score */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Moon className="w-4 h-4 text-primary" />
                      Sleep Score
                    </CardTitle>
                    <CardDescription>Daily sleep quality</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={metrics.filter(m => m.sleep_score != null).map(m => ({
                        date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                        score: m.sleep_score,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Area type="monotone" dataKey="score" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.15} strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Steps */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Footprints className="w-4 h-4 text-primary" />
                      Daily Steps
                    </CardTitle>
                    <CardDescription>Step count trend</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={200}>
                      <BarChart data={metrics.filter(m => m.steps != null).map(m => ({
                        date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                        steps: m.steps,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Bar dataKey="steps" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Resting HR */}
              {metrics.some(m => m.resting_heart_rate != null) && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Heart className="w-4 h-4 text-destructive" />
                      Resting Heart Rate
                    </CardTitle>
                    <CardDescription>Daily resting HR trend</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={metrics.filter(m => m.resting_heart_rate != null).map(m => ({
                        date: new Date(m.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
                        rhr: Math.round(m.resting_heart_rate!),
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                        <Tooltip
                          contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                          labelStyle={{ color: "hsl(var(--foreground))" }}
                        />
                        <Line type="monotone" dataKey="rhr" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

const ActionCard = ({
  icon: Icon,
  title,
  desc,
  to,
  navigate,
}: {
  icon: any;
  title: string;
  desc: string;
  to: string;
  navigate: (to: string) => void;
}) => (
  <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate(to)}>
    <CardHeader className="flex flex-row items-center gap-3 p-4">
      <div className="rounded-lg bg-primary/10 p-2">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{desc}</CardDescription>
      </div>
    </CardHeader>
  </Card>
);

const KPICard = ({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: any;
  label: string;
  value: string;
  sub: string;
  trend?: "up" | "down" | "neutral";
}) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 text-muted-foreground" />
        {trend === "up" && <ArrowUpRight className="w-4 h-4 text-destructive" />}
        {trend === "down" && <ArrowDownRight className="w-4 h-4 text-accent" />}
        {trend === "neutral" && <Minus className="w-4 h-4 text-primary" />}
      </div>
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </CardContent>
  </Card>
);

export default Dashboard;
