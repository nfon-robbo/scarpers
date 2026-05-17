import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";

type StageTotals = { deep: number; rem: number; light: number; awake: number; sleep: number };
type SourceRow = { source: "google_fit" | "health_connect"; totals: StageTotals };
type Row = { date: string; sources: SourceRow[] };

const fmtH = (secs: number) => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
};

const fmtMin = fmtH; // HH:MM for Deep/REM/Light/Awake

const sourceLabel = (s: string) => (s === "google_fit" ? "Google Fit" : "Health Connect");

const SleepSourcesPanel = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
      const { data } = await supabase
        .from("sleep_stages")
        .select("date, stage, duration_seconds, source")
        .eq("user_id", user.id)
        .gte("date", since)
        .in("source", ["google_fit", "health_connect"]);

      // group by date -> source -> stage totals
      const map = new Map<string, Map<string, StageTotals>>();
      for (const r of data ?? []) {
        const src = (r.source ?? "google_fit") as string;
        if (src !== "google_fit" && src !== "health_connect") continue;
        if (!map.has(r.date)) map.set(r.date, new Map());
        const sm = map.get(r.date)!;
        if (!sm.has(src)) sm.set(src, { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 });
        const t = sm.get(src)!;
        const key = r.stage as keyof StageTotals;
        if (key in t) t[key] += r.duration_seconds || 0;
      }

      const built: Row[] = Array.from(map.entries())
        .map(([date, sm]) => ({
          date,
          sources: Array.from(sm.entries()).map(([source, totals]) => ({
            source: source as "google_fit" | "health_connect",
            totals,
          })),
        }))
        .sort((a, b) => b.date.localeCompare(a.date));

      setRows(built);
      setLoading(false);
    })();
  }, [user]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sleep — Google Fit & Health Connect</CardTitle>
        <CardDescription>Last 7 nights · per-source duration & stage breakdown</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No sleep data from Google Fit or Health Connect in the last 7 days.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Total</th>
                  <th className="px-2 py-2">Deep</th>
                  <th className="px-2 py-2">REM</th>
                  <th className="px-2 py-2">Light</th>
                  <th className="px-2 py-2">Awake</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) =>
                  r.sources.map((s, i) => {
                    const t = s.totals;
                    const total = t.deep + t.rem + t.light + t.sleep;
                    return (
                      <tr key={`${r.date}-${s.source}`} className="border-t border-border/40">
                        <td className="px-2 py-2 font-mono">
                          {i === 0 ? format(parseISO(r.date), "dd/MM/yyyy") : ""}
                        </td>
                        <td className="px-2 py-2">{sourceLabel(s.source)}</td>
                        <td className="px-2 py-2 font-semibold">{fmtH(total)}</td>
                        <td className="px-2 py-2">{fmtMin(t.deep)}</td>
                        <td className="px-2 py-2">{fmtMin(t.rem)}</td>
                        <td className="px-2 py-2">{fmtMin(t.light || t.sleep)}</td>
                        <td className="px-2 py-2">{fmtMin(t.awake)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SleepSourcesPanel;
