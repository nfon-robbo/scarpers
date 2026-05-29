import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Gauge } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.1)",
};

interface Snapshot {
  score: number;
  hour: number;
  recorded_at: string;
}

const ReadinessHistoryChart = () => {
  const { user } = useAuth();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    supabase
      .from("readiness_snapshots")
      .select("score, hour, recorded_at")
      .eq("user_id", user.id)
      .gte("recorded_at", startOfToday.toISOString())
      .order("recorded_at", { ascending: true })
      .then(({ data }) => {
        setSnapshots((data as Snapshot[]) || []);
        setLoading(false);
      });
  }, [user]);

  // Build two datasets:
  // 1) Time-of-day average (aggregated by hour across all days)
  // 2) Chronological timeline
  const { hourlyAvg, timeline } = useMemo(() => {
    if (snapshots.length === 0) return { hourlyAvg: [], timeline: [] };

    // Hourly averages
    const byHour = new Map<number, number[]>();
    for (const s of snapshots) {
      if (!byHour.has(s.hour)) byHour.set(s.hour, []);
      byHour.get(s.hour)!.push(s.score);
    }

    const hourlyAvg = Array.from({ length: 24 }, (_, h) => {
      const vals = byHour.get(h);
      return {
        hour: `${h.toString().padStart(2, "0")}:00`,
        score: vals ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null,
      };
    }).filter((d) => d.score !== null);

    // Chronological timeline
    const timeline = snapshots.map((s) => ({
      time: new Date(s.recorded_at).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      score: s.score,
    }));

    return { hourlyAvg, timeline };
  }, [snapshots]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (snapshots.length < 2) return null;

  return (
    <div className="space-y-4">
      {/* Chronological timeline */}
      {timeline.length >= 3 && (
        <Card className="overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Gauge className="w-4 h-4 text-chart-2" />
              Readiness Timeline
            </CardTitle>
            <CardDescription className="text-xs">
              Score snapshots over the last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent className="pr-2">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timeline}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} className="fill-muted-foreground" axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "hsl(var(--foreground))" }} />
                <ReferenceLine y={60} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeOpacity={0.4} />
                <defs>
                  <linearGradient id="timelineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="hsl(var(--chart-2))"
                  fill="url(#timelineGrad)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ReadinessHistoryChart;
