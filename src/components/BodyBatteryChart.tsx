import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Battery, Zap } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Dot,
} from "recharts";
import { activityIntensityLoad } from "@/lib/readiness";

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.1)",
};

interface TimelinePoint {
  time: string;
  hour: number;
  score: number;
  isActivity?: boolean;
  activityLabel?: string;
}

/** Passive drain curve matching readiness.ts bodyBatteryDrain */
function passiveDrainAt(hoursAwake: number): number {
  const h = Math.min(20, Math.max(0, hoursAwake));
  if (h <= 4) return h * 1;
  if (h <= 8) return 4 + (h - 4) * 1.5;
  if (h <= 12) return 10 + (h - 8) * 2;
  if (h <= 16) return 18 + (h - 12) * 2.5;
  return 28 + (h - 16) * 3;
}

const BodyBatteryChart = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [wakeScore, setWakeScore] = useState<number | null>(null);
  const [wakeHour, setWakeHour] = useState<number | null>(null);
  const [activities, setActivities] = useState<
    { startHour: number; load: number; type: string }[]
  >([]);

  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    Promise.all([
      // Get earliest snapshot today for wake score
      supabase
        .from("readiness_snapshots")
        .select("score, hour, recorded_at")
        .eq("user_id", user.id)
        .gte("recorded_at", today + "T00:00:00Z")
        .order("recorded_at", { ascending: true })
        .limit(1)
        .then(({ data }) => data || []),
      // Get today's activities
      supabase
        .from("activities")
        .select("start_time, duration_seconds, activity_type, training_load, training_effect, avg_heart_rate")
        .eq("user_id", user.id)
        .gte("start_time", today + "T00:00:00Z")
        .order("start_time", { ascending: true })
        .then(({ data }) => data || []),
      // Get wake time from sleep stages
      supabase
        .from("sleep_stages")
        .select("end_time")
        .eq("user_id", user.id)
        .in("date", [today, yesterday])
        .not("end_time", "is", null)
        .order("end_time", { ascending: false })
        .limit(1)
        .then(({ data }) => data || []),
    ]).then(([snapshots, acts, sleepEnd]) => {
      // Wake score: use first snapshot or default 75
      const snap = (snapshots as any[])[0];
      setWakeScore(snap ? snap.score : 75);

      // Wake hour
      const sleepEndTime = (sleepEnd as any[])[0]?.end_time;
      if (sleepEndTime) {
        setWakeHour(new Date(sleepEndTime).getHours() + new Date(sleepEndTime).getMinutes() / 60);
      } else {
        setWakeHour(7); // default
      }

      // Activities
      setActivities(
        (acts as any[]).map((a) => ({
          startHour:
            new Date(a.start_time).getHours() +
            new Date(a.start_time).getMinutes() / 60,
          load: activityIntensityLoad(a),
          type: a.activity_type || "Activity",
        }))
      );
      setLoading(false);
    });
  }, [user]);

  const timeline = useMemo(() => {
    if (wakeScore == null || wakeHour == null) return [];

    const nowHour = new Date().getHours() + new Date().getMinutes() / 60;
    const points: TimelinePoint[] = [];

    // Build activity drain map (hour → total drain)
    const activityDrainMap = new Map<number, { drain: number; label: string }>();
    let cumulativeActivityDrain = 0;
    for (const act of activities) {
      const drain = Math.min(10, act.load * 0.2);
      cumulativeActivityDrain += drain;
      const roundedHour = Math.round(act.startHour * 2) / 2; // snap to half hours
      activityDrainMap.set(roundedHour, {
        drain: cumulativeActivityDrain,
        label: act.type,
      });
    }

    // Generate points every 30 min from wake to now
    for (let h = wakeHour; h <= Math.min(nowHour, 23.5); h += 0.5) {
      const hoursAwake = h - wakeHour;
      const passive = passiveDrainAt(hoursAwake);

      // Cumulative activity drain up to this hour
      let actDrain = 0;
      for (const [actH, info] of activityDrainMap) {
        if (actH <= h) actDrain = info.drain;
      }

      const score = Math.max(5, Math.round(wakeScore - passive - actDrain));
      const isAct = activityDrainMap.has(Math.round(h * 2) / 2);
      const actLabel = isAct
        ? activityDrainMap.get(Math.round(h * 2) / 2)?.label
        : undefined;

      const hourInt = Math.floor(h);
      const min = Math.round((h - hourInt) * 60);
      points.push({
        time: `${hourInt.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`,
        hour: h,
        score,
        isActivity: isAct,
        activityLabel: actLabel,
      });
    }

    return points;
  }, [wakeScore, wakeHour, activities]);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (timeline.length < 3) return null;

  const currentScore = timeline[timeline.length - 1]?.score ?? 0;
  const gaugeColor =
    currentScore >= 80
      ? "hsl(142, 60%, 45%)"
      : currentScore > 30
      ? "hsl(45, 90%, 50%)"
      : "hsl(0, 72%, 51%)";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Battery className="w-4 h-4 text-primary" />
          Body Battery Today
          <span
            className="ml-auto text-lg font-bold"
            style={{ color: gaugeColor }}
          >
            {currentScore}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pr-2 pb-3">
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={timeline}>
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 10 }}
              className="fill-muted-foreground"
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11 }}
              className="fill-muted-foreground"
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={{ color: "hsl(var(--foreground))" }}
              formatter={(value: number, _name: string, props: any) => {
                const label = props.payload?.activityLabel;
                return [
                  `${value}${label ? ` — ${label}` : ""}`,
                  "Battery",
                ];
              }}
            />
            <ReferenceLine
              y={80}
              stroke="hsl(142, 60%, 45%)"
              strokeDasharray="4 4"
              strokeOpacity={0.3}
            />
            <ReferenceLine
              y={60}
              stroke="hsl(45, 90%, 50%)"
              strokeDasharray="4 4"
              strokeOpacity={0.3}
            />
            <ReferenceLine
              y={40}
              stroke="hsl(0, 72%, 51%)"
              strokeDasharray="4 4"
              strokeOpacity={0.3}
            />
            <defs>
              <linearGradient id="batteryGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="score"
              stroke="hsl(var(--primary))"
              fill="url(#batteryGrad)"
              strokeWidth={2.5}
              dot={(props: any) => {
                if (props.payload?.isActivity) {
                  return (
                    <g key={props.index}>
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={6}
                        fill="hsl(var(--destructive))"
                        fillOpacity={0.2}
                        stroke="hsl(var(--destructive))"
                        strokeWidth={2}
                      />
                      <circle
                        cx={props.cx}
                        cy={props.cy}
                        r={2.5}
                        fill="hsl(var(--destructive))"
                      />
                    </g>
                  );
                }
                return <g key={props.index} />;
              }}
              activeDot={{ r: 4, strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
        {activities.length > 0 && (
          <div className="flex items-center gap-3 mt-2 px-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-destructive inline-block" />
              Activity drain
            </span>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3" />
              {activities.length} workout{activities.length > 1 ? "s" : ""} today
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default BodyBatteryChart;
