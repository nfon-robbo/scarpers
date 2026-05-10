import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";

type Row = {
  date: string;
  intervals?: { hours: number; score: number | null };
  garminZip?: { hours: number; score: number | null };
  googleFit?: { minutes: number };
  healthConnect?: { minutes: number };
};

const fmtH = (h: number) => `${Math.floor(h)}:${String(Math.round((h - Math.floor(h)) * 60)).padStart(2, "0")}`;

const Cell = ({ data }: { data?: { hours?: number; minutes?: number; score?: number | null } }) => {
  if (!data) return <span className="text-muted-foreground/40">—</span>;
  const hours = data.hours ?? (data.minutes != null ? data.minutes / 60 : undefined);
  if (hours == null) return <span className="text-muted-foreground/40">—</span>;
  return (
    <span className="text-xs">
      <span className="font-semibold">{fmtH(hours)}</span>
      {data.score != null && <span className="text-muted-foreground"> · {data.score}</span>}
    </span>
  );
};

const SleepSourcesPanel = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
      const [{ data: dm }, { data: stages }] = await Promise.all([
        supabase
          .from("daily_metrics")
          .select("date, sleep_duration_seconds, sleep_score, source_file")
          .eq("user_id", user.id)
          .gte("date", since)
          .not("sleep_duration_seconds", "is", null),
        supabase
          .from("sleep_stages")
          .select("date, source, duration_seconds")
          .eq("user_id", user.id)
          .gte("date", since),
      ]);

      const map = new Map<string, Row>();
      const ensure = (date: string) => {
        if (!map.has(date)) map.set(date, { date });
        return map.get(date)!;
      };

      (dm ?? []).forEach((m: any) => {
        const r = ensure(m.date);
        const hours = (m.sleep_duration_seconds ?? 0) / 3600;
        const src = (m.source_file ?? "").toString().toLowerCase();
        if (src.includes("intervals")) r.intervals = { hours, score: m.sleep_score };
        else r.garminZip = { hours, score: m.sleep_score };
      });

      (stages ?? []).forEach((s: any) => {
        const r = ensure(s.date);
        const minutes = (s.duration_seconds ?? 0) / 60;
        if (s.source === "google_fit") {
          r.googleFit = { minutes: (r.googleFit?.minutes ?? 0) + minutes };
        } else if (s.source === "health_connect") {
          r.healthConnect = { minutes: (r.healthConnect?.minutes ?? 0) + minutes };
        }
      });

      const sorted = Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
      setRows(sorted);
      setLoading(false);
    })();
  }, [user]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sleep sources</CardTitle>
        <CardDescription>Last 7 nights — which integration delivered data</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sleep data in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Intervals.icu</th>
                  <th className="px-2 py-2">Google Fit</th>
                  <th className="px-2 py-2">Health Connect</th>
                  <th className="px-2 py-2">Garmin ZIP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} className="border-t border-border/40">
                    <td className="px-2 py-2 font-mono">{format(parseISO(r.date), "dd/MM/yyyy")}</td>
                    <td className="px-2 py-2"><Cell data={r.intervals} /></td>
                    <td className="px-2 py-2"><Cell data={r.googleFit} /></td>
                    <td className="px-2 py-2"><Cell data={r.healthConnect} /></td>
                    <td className="px-2 py-2"><Cell data={r.garminZip} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-muted-foreground mt-2">Format: hours:mins · score (where available)</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SleepSourcesPanel;
