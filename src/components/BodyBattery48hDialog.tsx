import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

interface HourPoint {
  ts: number;
  label: string;
  hour: number;
  battery: number;
  state: "sleep" | "awake" | "active";
}

// Passive drain per hour-awake bucket (matches readiness.ts curve, expressed as delta per hour)
function passiveDrainForHour(hoursAwake: number): number {
  if (hoursAwake <= 4) return 1;
  if (hoursAwake <= 8) return 1.5;
  if (hoursAwake <= 12) return 2;
  if (hoursAwake <= 16) return 2.5;
  return 3;
}

const BodyBattery48hDialog = ({ open, onOpenChange }: Props) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState<HourPoint[]>([]);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);

    const now = new Date();
    // Snap to current hour
    now.setMinutes(0, 0, 0);
    const startMs = now.getTime() - 47 * 3600_000;
    const startIso = new Date(startMs - 12 * 3600_000).toISOString(); // pad lookback for sleep windows
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
      // Build sleep intervals (any non-awake stage counts as sleeping/recharging)
      const sleepIntervals: { start: number; end: number; weight: number }[] = [];
      for (const s of stages as any[]) {
        if (!s.start_time || !s.end_time) continue;
        const stage = (s.stage || "").toLowerCase();
        if (stage === "awake") continue;
        // Recharge weight: deep > rem > light/sleep
        const w = stage === "deep" ? 9 : stage === "rem" ? 7 : 5;
        sleepIntervals.push({
          start: new Date(s.start_time).getTime(),
          end: new Date(s.end_time).getTime(),
          weight: w,
        });
      }

      // Build activity intervals with intensity load per second
      const actIntervals: { start: number; end: number; drainPerHour: number }[] = [];
      for (const a of acts as any[]) {
        if (!a.start_time || !a.duration_seconds) continue;
        const start = new Date(a.start_time).getTime();
        const end = start + a.duration_seconds * 1000;
        // Intensity-weighted load → spread across activity duration
        const mins = a.duration_seconds / 60;
        let load = mins;
        if (a.training_load && a.training_load > 0) load = a.training_load;
        else if (a.training_effect && a.training_effect > 0)
          load = mins * (0.25 + (a.training_effect / 5) * 1.75);
        else if (a.avg_heart_rate && a.avg_heart_rate > 0)
          load = mins * Math.max(0.5, Math.min(2.0, a.avg_heart_rate / 140));
        // Convert load (intensity-minutes) to battery drain per hour during activity
        // Heuristic: every intensity-minute drains ~0.4 battery
        const totalDrain = Math.min(40, load * 0.4);
        const hours = Math.max(0.1, a.duration_seconds / 3600);
        actIntervals.push({ start, end, drainPerHour: totalDrain / hours });
      }

      // Helper: are we sleeping at time t?
      const sleepAt = (t: number) => {
        for (const iv of sleepIntervals) {
          if (t >= iv.start && t < iv.end) return iv.weight;
        }
        return 0;
      };
      const activityAt = (t: number) => {
        let drain = 0;
        for (const iv of actIntervals) {
          if (t >= iv.start && t < iv.end) drain += iv.drainPerHour;
        }
        return drain;
      };

      // Walk hour by hour from 48h ago using a fine-grained sub-step (15-min) for smoother transitions
      const stepMin = 15;
      const stepMs = stepMin * 60_000;
      const totalSteps = (48 * 60) / stepMin;

      let battery = 60; // starting estimate 48h ago
      let hoursAwake = 6;

      const hourly: HourPoint[] = [];

      for (let i = 0; i <= totalSteps; i++) {
        const t = startMs + i * stepMs;
        const sleepW = sleepAt(t);
        const actDrain = activityAt(t);

        if (sleepW > 0) {
          // Recharge: +weight per hour scaled by step
          battery += (sleepW * stepMin) / 60;
          hoursAwake = 0;
        } else {
          hoursAwake += stepMin / 60;
          const passive = passiveDrainForHour(hoursAwake);
          battery -= (passive * stepMin) / 60;
          if (actDrain > 0) battery -= (actDrain * stepMin) / 60;
        }
        battery = Math.max(5, Math.min(100, battery));

        // Record on the hour
        if (t % 3600_000 === 0) {
          const d = new Date(t);
          const state: HourPoint["state"] = sleepW > 0 ? "sleep" : actDrain > 0 ? "active" : "awake";
          hourly.push({
            ts: t,
            label: d.toLocaleString("en-GB", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }),
            hour: d.getHours(),
            battery: Math.round(battery),
            state,
          });
        }
      }

      setPoints(hourly);
      setLoading(false);
    });
  }, [open, user]);

  // Find midnight markers for x-axis context
  const midnightTicks = points.filter((p) => p.hour === 0).map((p) => p.label);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Body Battery — Past 48 hours</DialogTitle>
          <DialogDescription>
            Hourly charge level. Green peaks = recharge during sleep, dips = activity and waking drain.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : points.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data available.</p>
        ) : (
          <div className="space-y-3">
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                  <defs>
                    <linearGradient id="batteryGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142, 70%, 50%)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(142, 70%, 50%)" stopOpacity={0.05} />
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
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: any, _n, p: any) => [`${v}% (${p?.payload?.state})`, "Battery"]}
                    labelFormatter={(l) => `At ${l}`}
                  />
                  <ReferenceLine y={25} stroke="hsl(0, 75%, 55%)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={75} stroke="hsl(142, 70%, 50%)" strokeDasharray="3 3" strokeOpacity={0.4} />
                  {midnightTicks.map((t) => (
                    <ReferenceLine key={t} x={t} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 4" strokeOpacity={0.4} />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="battery"
                    stroke="hsl(142, 70%, 50%)"
                    fill="url(#batteryGrad)"
                    strokeWidth={2}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Recharging (sleep)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> Awake drain
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Activity drain
              </span>
              <span className="ml-auto">
                Now: <strong className="text-foreground">{points[points.length - 1]?.battery}%</strong>
              </span>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default BodyBattery48hDialog;
