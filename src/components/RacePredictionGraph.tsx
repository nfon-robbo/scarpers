import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { format, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Label } from "recharts";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  raceDistance?: string;
  goalSeconds?: number | null;
  refreshKey?: number;
}

function normaliseDist(rd?: string): string {
  const d = String(rd || "").toLowerCase();
  if (d.includes("marathon") && !d.includes("half")) return "Marathon";
  if (d.includes("half")) return "Half Marathon";
  if (d.includes("10")) return "10K";
  return "5K";
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type Row = {
  calculated_at: string;
  predicted_seconds: number;
  vo2_max: number | null;
  triggered_by: string;
};

type Trend = "improving" | "regressing" | "stable";

export default function RacePredictionGraph({ raceDistance, goalSeconds, refreshKey }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const dist = normaliseDist(raceDistance);
        const { data } = await supabase
          .from("race_prediction_history")
          .select("calculated_at, predicted_seconds, vo2_max, triggered_by")
          .eq("user_id", user.id)
          .eq("distance", dist)
          .order("calculated_at", { ascending: true })
          .limit(200);
        if (!cancelled) setRows((data as Row[]) || []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [raceDistance, refreshKey]);

  if (loading) return null;

  // Keep only the latest prediction per calendar day so intra-day recalcs
  // don't create a confusing wave pattern.
  const latestPerDay = new Map<string, Row>();
  for (const r of rows) {
    const day = r.calculated_at.slice(0, 10);
    const prev = latestPerDay.get(day);
    if (!prev || r.calculated_at > prev.calculated_at) latestPerDay.set(day, r);
  }
  const data = Array.from(latestPerDay.values())
    .sort((a, b) => a.calculated_at.localeCompare(b.calculated_at))
    .map((r) => ({
      ts: new Date(r.calculated_at).getTime(),
      dateLabel: format(parseISO(r.calculated_at), "dd/MM"),
      seconds: r.predicted_seconds,
      vo2: r.vo2_max,
      trigger: r.triggered_by,
    }));

  // Determine trend from first vs last (>2% threshold for stable)
  let trend: Trend = "stable";
  let deltaSec = 0;
  if (data.length >= 2) {
    const first = data[0].seconds;
    const last = data[data.length - 1].seconds;
    deltaSec = last - first;
    const pct = Math.abs(deltaSec) / first;
    if (pct < 0.01) trend = "stable";
    else if (deltaSec < 0) trend = "improving";
    else trend = "regressing";
  }

  const trendColor =
    trend === "improving" ? "hsl(142 71% 45%)" : trend === "regressing" ? "hsl(38 92% 50%)" : "hsl(var(--muted-foreground))";

  const TrendIcon = trend === "improving" ? TrendingDown : trend === "regressing" ? TrendingUp : Minus;
  const trendLabel =
    trend === "improving"
      ? `Improving (${fmtTime(Math.abs(deltaSec))} faster)`
      : trend === "regressing"
      ? `Regressing (${fmtTime(Math.abs(deltaSec))} slower)`
      : "Stable";

  const statusBadge =
    trend === "improving"
      ? "✅ On track — keep training"
      : trend === "regressing"
      ? "⚠️ Regressing — more training needed"
      : "→ Stable";

  return (
    <Card className="glass border-border/30">
      <CardContent className="p-5">
        <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-2">
            <TrendIcon className="w-4 h-4" style={{ color: trendColor }} />
            <h3 className="text-sm font-semibold">Race Estimate Progress</h3>
          </div>
          {data.length >= 2 && (
            <span className="text-xs font-medium" style={{ color: trendColor }}>
              {trendLabel}
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mb-3">Lower line = faster predicted time</p>

        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            Your race estimate will appear here once your first workout is recorded.
          </p>
        ) : (
          <>
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" />
                  <XAxis
                    dataKey="dateLabel"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                  />
                  <YAxis
                    tickFormatter={(v) => fmtTime(v)}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    domain={["auto", "auto"]}
                    width={56}
                  >
                    <Label
                      value="Slower ↑"
                      position="insideTopLeft"
                      offset={8}
                      style={{ fill: "hsl(var(--muted-foreground))", fontSize: 9 }}
                    />
                    <Label
                      value="Faster ↓"
                      position="insideBottomLeft"
                      offset={8}
                      style={{ fill: "hsl(142 71% 45%)", fontSize: 9 }}
                    />
                  </YAxis>
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "seconds") return [fmtTime(value), "Predicted"];
                      return [value, name];
                    }}
                    labelFormatter={(_l, payload) => {
                      const p = payload?.[0]?.payload;
                      if (!p) return "";
                      const trigger = String(p.trigger || "").replace("_", " ");
                      return `${format(p.ts, "dd/MM/yyyy")} · ${trigger}${p.vo2 ? ` · VO2 ${Math.round(p.vo2)}` : ""}`;
                    }}
                  />
                  {goalSeconds && (
                    <ReferenceLine
                      y={goalSeconds}
                      stroke="hsl(var(--primary))"
                      strokeDasharray="4 4"
                      label={{
                        value: `🎯 Goal ${fmtTime(goalSeconds)}`,
                        fill: "hsl(var(--primary))",
                        fontSize: 10,
                        position: "insideBottomRight",
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="seconds"
                    stroke={trendColor}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: trendColor }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {data.length >= 2 && (
              <div
                className="mt-3 text-xs font-medium px-3 py-2 rounded-md border"
                style={{
                  color: trendColor,
                  borderColor: `${trendColor}33`,
                  background: `${trendColor}14`,
                }}
              >
                {statusBadge}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
