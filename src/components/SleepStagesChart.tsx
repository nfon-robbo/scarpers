import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Moon } from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { format, parseISO, subDays } from "date-fns";

interface SleepStageRow {
  date: string;
  stage: string;
  duration_seconds: number;
}

interface DailyStages {
  date: string;
  deep: number;
  light: number;
  rem: number;
  awake: number;
}

const SleepStagesChart = () => {
  const { user } = useAuth();
  const [stages, setStages] = useState<SleepStageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStages = async () => {
    if (!user) return;
    const since = subDays(new Date(), 30).toISOString().split("T")[0];
    const { data } = await supabase
      .from("sleep_stages")
      .select("date, stage, duration_seconds")
      .eq("user_id", user.id)
      .gte("date", since)
      .order("date", { ascending: true });
    setStages((data as SleepStageRow[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchStages();

    const handler = () => fetchStages();
    window.addEventListener("sleep-stages-synced", handler);
    return () => window.removeEventListener("sleep-stages-synced", handler);
  }, [user]);

  const chartData = useMemo(() => {
    const byDate: Record<string, DailyStages> = {};
    for (const s of stages) {
      if (!byDate[s.date]) {
        byDate[s.date] = { date: s.date, deep: 0, light: 0, rem: 0, awake: 0 };
      }
      const key = s.stage as keyof Omit<DailyStages, "date">;
      if (key in byDate[s.date]) {
        byDate[s.date][key] += s.duration_seconds / 3600;
      }
    }
    return Object.values(byDate).map(d => ({
      ...d,
      date: format(parseISO(d.date), "dd MMM"),
      deep: Number(d.deep.toFixed(1)),
      light: Number(d.light.toFixed(1)),
      rem: Number(d.rem.toFixed(1)),
      awake: Number(d.awake.toFixed(1)),
    }));
  }, [stages]);

  // Latest night summary
  const latestSummary = useMemo(() => {
    if (chartData.length === 0) return null;
    const latest = chartData[chartData.length - 1];
    const total = latest.deep + latest.light + latest.rem + latest.awake;
    return { ...latest, total: Number(total.toFixed(1)) };
  }, [chartData]);

  if (loading || stages.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Moon className="w-4 h-4 text-primary" />
          Sleep Stages
        </CardTitle>
        <CardDescription>
          Deep, Light, REM & Awake breakdown from Google Fit
          {latestSummary && (
            <span className="ml-2 text-foreground font-medium">
              — Last night: {latestSummary.total}h (Deep {latestSummary.deep}h, REM {latestSummary.rem}h, Light {latestSummary.light}h)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} className="fill-muted-foreground" interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" label={{ value: "Hours", angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(v: number, name: string) => [`${v}h`, name.charAt(0).toUpperCase() + name.slice(1)]}
            />
            <Legend />
            <Bar dataKey="deep" stackId="a" fill="hsl(var(--primary))" name="Deep" radius={[0, 0, 0, 0]} />
            <Bar dataKey="rem" stackId="a" fill="hsl(220 70% 60%)" name="REM" />
            <Bar dataKey="light" stackId="a" fill="hsl(var(--muted-foreground) / 0.4)" name="Light" />
            <Bar dataKey="awake" stackId="a" fill="hsl(var(--destructive) / 0.5)" name="Awake" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
};

export default SleepStagesChart;
