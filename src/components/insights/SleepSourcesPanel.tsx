import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";

type Row = {
  date: string;
  hours: number;
  score: number | null;
  deep: number | null;
  rem: number | null;
  light: number | null;
  awake: number | null;
};

const fmtH = (h: number) => `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, "0")}`;
const fmtMin = (m: number | null) => (m == null ? <span className="text-muted-foreground/40">—</span> : `${Math.round(m)}m`);

const SleepSourcesPanel = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
      const { data: dm } = await supabase
        .from("daily_metrics")
        .select("date, sleep_duration_seconds, sleep_score, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, awake_during_night_minutes, source_file")
        .eq("user_id", user.id)
        .gte("date", since)
        .not("sleep_duration_seconds", "is", null);

      const sorted: Row[] = (dm ?? [])
        .filter((m: any) => (m.source_file ?? "").toString().toLowerCase().includes("intervals"))
        .map((m: any) => ({
          date: m.date,
          hours: (m.sleep_duration_seconds ?? 0) / 3600,
          score: m.sleep_score,
          deep: m.deep_sleep_minutes,
          rem: m.rem_sleep_minutes,
          light: m.light_sleep_minutes,
          awake: m.awake_during_night_minutes,
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      setRows(sorted);
      setLoading(false);
    })();
  }, [user]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sleep — Intervals.icu</CardTitle>
        <CardDescription>Last 7 nights · duration, score and stage breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Intervals.icu sleep data in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Duration</th>
                  <th className="px-2 py-2">Score</th>
                  <th className="px-2 py-2">Deep</th>
                  <th className="px-2 py-2">REM</th>
                  <th className="px-2 py-2">Light</th>
                  <th className="px-2 py-2">Awake</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-t border-border/40">
                    <td className="px-2 py-2 font-mono">{format(parseISO(r.date), "dd/MM/yyyy")}</td>
                    <td className="px-2 py-2 font-semibold">{fmtH(r.hours)}</td>
                    <td className="px-2 py-2">{r.score ?? <span className="text-muted-foreground/40">—</span>}</td>
                    <td className="px-2 py-2">{fmtMin(r.deep)}</td>
                    <td className="px-2 py-2">{fmtMin(r.rem)}</td>
                    <td className="px-2 py-2">{fmtMin(r.light)}</td>
                    <td className="px-2 py-2">{fmtMin(r.awake)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SleepSourcesPanel;
