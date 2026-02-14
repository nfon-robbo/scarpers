import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Moon, Footprints, Heart, Activity, Brain, TrendingDown, TrendingUp,
  Loader2, RefreshCw, Weight as WeightIcon, Gauge,
} from "lucide-react";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ComposedChart,
} from "recharts";
import { useToast } from "@/hooks/use-toast";
import { format, subDays, parseISO } from "date-fns";
import GoogleFitConnect from "@/components/GoogleFitConnect";
import SleepStagesChart from "@/components/SleepStagesChart";
interface MetricsRow {
  date: string;
  sleep_score: number | null;
  sleep_duration_seconds: number | null;
  steps: number | null;
  resting_heart_rate: number | null;
  hrv: number | null;
  weight: number | null;
  stress_score: number | null;
  body_fat_percentage: number | null;
  calories_total: number | null;
}

const WellnessPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [metrics, setMetrics] = useState<MetricsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!user) return;
    const since = subDays(new Date(), 90).toISOString().split("T")[0];
    supabase
      .from("daily_metrics")
      .select("date, sleep_score, sleep_duration_seconds, steps, resting_heart_rate, hrv, weight, stress_score, body_fat_percentage, calories_total")
      .eq("user_id", user.id)
      .gte("date", since)
      .order("date", { ascending: true })
      .then(({ data }) => {
        setMetrics((data as MetricsRow[]) || []);
        setLoading(false);
      });
  }, [user]);

  const syncWellness = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intervals-wellness`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({}),
        }
      );
      const data = await resp.json();
      if (!resp.ok) {
        toast({ title: "Sync failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Synced", description: `${data.synced} days updated` });
        // Reload
        const since = subDays(new Date(), 90).toISOString().split("T")[0];
        const { data: fresh } = await supabase
          .from("daily_metrics")
          .select("date, sleep_score, sleep_duration_seconds, steps, resting_heart_rate, hrv, weight, stress_score, body_fat_percentage, calories_total")
          .eq("user_id", user.id)
          .gte("date", since)
          .order("date", { ascending: true });
        setMetrics((fresh as MetricsRow[]) || []);
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const summary = useMemo(() => {
    if (metrics.length === 0) return null;
    const last7 = metrics.slice(-7);
    const sleepScores = last7.filter(m => m.sleep_score != null).map(m => m.sleep_score!);
    const stepCounts = last7.filter(m => m.steps != null).map(m => m.steps!);
    const rhrs = last7.filter(m => m.resting_heart_rate != null).map(m => m.resting_heart_rate!);

    const avg = (arr: number[]) => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;

    return {
      avgSleep7d: avg(sleepScores),
      avgSteps7d: avg(stepCounts),
      avgRHR7d: avg(rhrs),
      todaySleep: metrics[metrics.length - 1]?.sleep_score,
      todaySteps: metrics[metrics.length - 1]?.steps,
      todayRHR: metrics[metrics.length - 1]?.resting_heart_rate,
    };
  }, [metrics]);

  const fmtDate = (d: string) => {
    try { return format(parseISO(d), "dd MMM"); } catch { return d; }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Moon className="w-6 h-6 sm:w-8 sm:h-8 text-primary shrink-0" />
            Wellness
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Sleep, steps, heart rate & recovery metrics</p>
        </div>
        <Button variant="outline" size="sm" onClick={syncWellness} disabled={syncing}>
          {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Sync
        </Button>
      </div>

      {metrics.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Moon className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No wellness data yet</p>
            <p className="text-sm mb-4">Sync from Intervals.icu or upload FIT monitoring files</p>
            <Button onClick={syncWellness} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Sync Wellness Data
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* KPI Summary */}
          {summary && (
            <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
              <KPICard
                icon={Footprints}
                label="Steps"
                value={summary.todaySteps != null ? summary.todaySteps.toLocaleString() : "—"}
                sub={summary.avgSteps7d != null ? `7d avg: ${summary.avgSteps7d.toLocaleString()}` : "No data"}
                color="text-primary"
              />
              <KPICard
                icon={Heart}
                label="Resting HR"
                value={summary.todayRHR != null ? `${Math.round(summary.todayRHR)} bpm` : "—"}
                sub={summary.avgRHR7d != null ? `7d avg: ${summary.avgRHR7d} bpm` : "No data"}
                color="text-destructive"
              />
            </div>
          )}

          {/* Sleep Stages from Google Fit */}
          <SleepStagesChart />


          {metrics.some(m => m.steps != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Footprints className="w-4 h-4 text-primary" />
                  Daily Steps
                </CardTitle>
                <CardDescription>Step count over time</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={metrics.filter(m => m.steps != null).map(m => ({
                    date: fmtDate(m.date),
                    steps: m.steps,
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(v: number) => [v.toLocaleString(), "Steps"]}
                    />
                    <Bar dataKey="steps" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Resting HR & HRV */}
          <div className="grid gap-4 lg:grid-cols-2">
            {metrics.some(m => m.resting_heart_rate != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Heart className="w-4 h-4 text-destructive" />
                    Resting Heart Rate
                  </CardTitle>
                  <CardDescription>Lower is generally better for endurance athletes</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={metrics.filter(m => m.resting_heart_rate != null).map(m => ({
                      date: fmtDate(m.date),
                      rhr: Math.round(m.resting_heart_rate!),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number) => [`${v} bpm`, "RHR"]}
                      />
                      <Line type="monotone" dataKey="rhr" stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 2.5 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {metrics.some(m => m.hrv != null) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    Heart Rate Variability (HRV)
                  </CardTitle>
                  <CardDescription>Higher HRV indicates better recovery</CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={metrics.filter(m => m.hrv != null).map(m => ({
                      date: fmtDate(m.date),
                      hrv: Math.round(m.hrv!),
                    }))}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
                      <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                        labelStyle={{ color: "hsl(var(--foreground))" }}
                        formatter={(v: number) => [`${v} ms`, "HRV"]}
                      />
                      <Area type="monotone" dataKey="hrv" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.1} strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Weight & Body Composition */}
          {metrics.some(m => m.weight != null) && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <WeightIcon className="w-4 h-4 text-muted-foreground" />
                  Weight
                </CardTitle>
                <CardDescription>Body weight trend</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={metrics.filter(m => m.weight != null).map(m => ({
                    date: fmtDate(m.date),
                    weight: Number(m.weight!.toFixed(1)),
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                      formatter={(v: number) => [`${v} kg`, "Weight"]}
                    />
                    <Line type="monotone" dataKey="weight" stroke="hsl(var(--foreground))" strokeWidth={2} dot={{ r: 2.5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Data Table - Last 7 days */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent Wellness Data</CardTitle>
              <CardDescription>Last 7 days at a glance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Date</th>
                      <th className="text-center py-2 px-2 font-medium text-muted-foreground">Sleep</th>
                      <th className="text-center py-2 px-2 font-medium text-muted-foreground">Steps</th>
                      <th className="text-center py-2 px-2 font-medium text-muted-foreground">RHR</th>
                      <th className="text-center py-2 px-2 font-medium text-muted-foreground">HRV</th>
                      <th className="text-center py-2 px-2 font-medium text-muted-foreground">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.slice(-7).reverse().map(m => (
                      <tr key={m.date} className="border-b border-border/50">
                        <td className="py-2 pr-4 font-medium">{format(parseISO(m.date), "EEE dd MMM")}</td>
                        <td className="py-2 px-2 text-center">
                          {m.sleep_score != null ? (
                            <span className={m.sleep_score >= 70 ? "text-primary" : m.sleep_score >= 50 ? "text-accent" : "text-destructive"}>
                              {m.sleep_score}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="py-2 px-2 text-center">{m.steps != null ? m.steps.toLocaleString() : "—"}</td>
                        <td className="py-2 px-2 text-center">{m.resting_heart_rate != null ? `${Math.round(m.resting_heart_rate)}` : "—"}</td>
                        <td className="py-2 px-2 text-center">{m.hrv != null ? `${Math.round(m.hrv)}` : "—"}</td>
                        <td className="py-2 px-2 text-center">{m.weight != null ? `${m.weight.toFixed(1)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Sleep Stages from Google Fit */}
          <SleepStagesChart />

          {/* Google Fit Connection */}
          <GoogleFitConnect />
        </>
      )}
    </div>
  );
};

const KPICard = ({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  sub: string;
  color: string;
}) => (
  <Card>
    <CardContent className="p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-4 h-4 ${color}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{sub}</p>
    </CardContent>
  </Card>
);

export default WellnessPage;
