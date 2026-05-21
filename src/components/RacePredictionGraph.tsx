import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingDown } from "lucide-react";
import { format, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";
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

  const data = rows.map((r) => ({
    ts: new Date(r.calculated_at).getTime(),
    dateLabel: format(parseISO(r.calculated_at), "dd/MM"),
    seconds: r.predicted_seconds,
    vo2: r.vo2_max,
    trigger: r.triggered_by,
  }));

  return (
    <Card className="glass border-border/30">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <TrendingDown className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Race Estimate Progress</h3>
        </div>

        {data.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">
            Your race estimate will appear here once your first workout is recorded.
          </p>
        ) : (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data} margin={{ top: 10, right: 12, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.3)" />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <YAxis
                  reversed
                  tickFormatter={(v) => fmtTime(v)}
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--background))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, name: string, p: any) => {
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
                    label={{ value: `Goal ${fmtTime(goalSeconds)}`, fill: "hsl(var(--primary))", fontSize: 10, position: "insideTopRight" }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="seconds"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "hsl(var(--primary))" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
