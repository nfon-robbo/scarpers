import { useEffect, useState, useMemo, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Moon, Loader2 } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { calculateSleepScore, scoreLabel, type SleepStageData } from "@/lib/sleep-score";
import MarkdownRenderer from "@/components/MarkdownRenderer";

interface SleepStageRow {
  date: string;
  stage: string;
  duration_seconds: number;
}

interface DailyData {
  date: string;
  stages: SleepStageData;
  score: number;
}

const SleepCalendar = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<SleepStageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);

  const fetchSleepData = useCallback(async () => {
    if (!user) return;
    const since = subDays(new Date(), 365).toISOString().split("T")[0];

    // Fetch both sources in parallel
    const [stagesRes, metricsRes] = await Promise.all([
      supabase
        .from("sleep_stages")
        .select("date, stage, duration_seconds")
        .eq("user_id", user.id)
        .gte("date", since)
        .order("date", { ascending: true }),
      supabase
        .from("daily_metrics")
        .select("date, sleep_duration_seconds, deep_sleep_minutes, rem_sleep_minutes, light_sleep_minutes, awake_during_night_minutes")
        .eq("user_id", user.id)
        .gte("date", since)
        .not("sleep_duration_seconds", "is", null)
        .order("date", { ascending: true }),
    ]);

    const stageRows = (stagesRes.data as SleepStageRow[]) || [];

    // Identify dates where sleep_stages only has generic "sleep" (no real stages)
    const dateStageTypes = new Map<string, Set<string>>();
    for (const r of stageRows) {
      if (!dateStageTypes.has(r.date)) dateStageTypes.set(r.date, new Set());
      dateStageTypes.get(r.date)!.add(r.stage);
    }

    // A date has "real" stages if it has deep, rem, or light
    const hasRealStages = (stages: Set<string>) =>
      stages.has("deep") || stages.has("rem") || stages.has("light");

    // Build replacement/fallback rows from daily_metrics
    const metricsReplacements: SleepStageRow[] = [];
    const replacedDates = new Set<string>();

    for (const m of metricsRes.data || []) {
      const deepMins = Number(m.deep_sleep_minutes || 0);
      const remMins = Number(m.rem_sleep_minutes || 0);
      const lightMins = Number(m.light_sleep_minutes || 0);
      const awakeMins = Number(m.awake_during_night_minutes || 0);
      const totalSleepSecs = Number(m.sleep_duration_seconds || 0);

      const metricsHasStages = deepMins > 0 || remMins > 0 || lightMins > 0;
      const metricsHasAnySleepData = metricsHasStages || totalSleepSecs > 0;
      if (!metricsHasAnySleepData) continue;

      const existingStages = dateStageTypes.get(m.date);
      const existingHasReal = existingStages ? hasRealStages(existingStages) : false;

      // Use daily_metrics if: no sleep_stages data, OR sleep_stages is generic but daily_metrics has real stages
      if (!existingStages || (metricsHasStages && !existingHasReal)) {
        if (existingStages) replacedDates.add(m.date);
        if (metricsHasStages) {
          if (deepMins > 0) metricsReplacements.push({ date: m.date, stage: "deep", duration_seconds: deepMins * 60 });
          if (remMins > 0) metricsReplacements.push({ date: m.date, stage: "rem", duration_seconds: remMins * 60 });
          if (lightMins > 0) metricsReplacements.push({ date: m.date, stage: "light", duration_seconds: lightMins * 60 });
          if (awakeMins > 0) metricsReplacements.push({ date: m.date, stage: "awake", duration_seconds: awakeMins * 60 });
        } else {
          metricsReplacements.push({ date: m.date, stage: "sleep", duration_seconds: totalSleepSecs });
        }
      }
    }

    // Filter out sleep_stages rows for dates being replaced by better daily_metrics data
    const filteredStageRows = stageRows.filter((r) => !replacedDates.has(r.date));

    setRows([...filteredStageRows, ...metricsReplacements]);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchSleepData();
    window.addEventListener("sleep-stages-synced", fetchSleepData);
    return () => window.removeEventListener("sleep-stages-synced", fetchSleepData);
  }, [fetchSleepData]);

  const byDate = useMemo(() => {
    const map: Record<string, DailyData> = {};
    for (const r of rows) {
      if (!map[r.date]) {
        map[r.date] = { date: r.date, stages: { deep: 0, light: 0, rem: 0, awake: 0, sleep: 0 }, score: 0 };
      }
      const key = r.stage as keyof SleepStageData;
      if (key in map[r.date].stages) {
        map[r.date].stages[key] += r.duration_seconds;
      } else if (r.stage === "sleep") {
        map[r.date].stages.sleep += r.duration_seconds;
      }
    }
    for (const d of Object.values(map)) {
      d.score = calculateSleepScore(d.stages);
    }
    return map;
  }, [rows]);

  const sleepDates = useMemo(() => Object.keys(byDate).map(d => parseISO(d)), [byDate]);

  const getScoreColor = (score: number) => {
    if (score >= 85) return "bg-primary text-primary-foreground";
    if (score >= 70) return "bg-primary/60 text-primary-foreground";
    if (score >= 50) return "bg-yellow-500/60 text-white";
    return "bg-destructive/60 text-white";
  };

  const fetchInsight = useCallback(async (dateStr: string) => {
    const data = byDate[dateStr];
    if (!data) return;
    setInsight("");
    setInsightLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sleep-insight`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            sleepData: { ...data.stages, date: dateStr },
            sleepScore: data.score,
          }),
        }
      );

      if (!resp.ok || !resp.body) {
        setInsight("Failed to generate insight.");
        setInsightLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              setInsight(accumulated);
            }
          } catch { /* partial */ }
        }
      }
    } catch (e) {
      setInsight("Error generating insight.");
    } finally {
      setInsightLoading(false);
    }
  }, [byDate]);

  const handleDayClick = (day: Date) => {
    const dateStr = format(day, "yyyy-MM-dd");
    if (byDate[dateStr]) {
      setSelectedDate(dateStr);
      fetchInsight(dateStr);
    }
  };

  const selected = selectedDate ? byDate[selectedDate] : null;

  if (loading) return null;
  if (rows.length === 0) return null;

  // Latest score for KPI
  const dates = Object.keys(byDate).sort();
  const latestDate = dates[dates.length - 1];
  const latestData = latestDate ? byDate[latestDate] : null;
  const latestScore = latestData?.score ?? 0;
  const { label: latestLabel, color: latestColor } = scoreLabel(latestScore);

  // 7d average
  const last7Dates = dates.slice(-7);
  const avg7d = last7Dates.length > 0
    ? Math.round(last7Dates.reduce((s, d) => s + byDate[d].score, 0) / last7Dates.length)
    : null;

  return (
    <>
      {/* Sleep Score KPI */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Moon className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground">Sleep Score</span>
          </div>
          <p className={`text-2xl font-bold ${latestColor}`}>
            {latestScore} <span className="text-sm font-normal">{latestLabel}</span>
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {avg7d != null ? `7d avg: ${avg7d}` : "No data"}
          </p>
        </CardContent>
      </Card>

      {/* Calendar */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Moon className="w-4 h-4 text-primary" />
            Sleep Calendar
          </CardTitle>
          <CardDescription>Tap a date with sleep data to see your score & AI insights</CardDescription>
        </CardHeader>
        <CardContent>
          <Calendar
            mode="single"
            selected={selectedDate ? parseISO(selectedDate) : undefined}
            onSelect={(day) => day && handleDayClick(day)}
            modifiers={{ hasSleep: sleepDates }}
            modifiersClassNames={{
              hasSleep: "ring-2 ring-primary/50 rounded-md",
            }}
            className="mx-auto"
            components={{
              DayContent: ({ date }) => {
                const dateStr = format(date, "yyyy-MM-dd");
                const d = byDate[dateStr];
                return (
                  <div className="relative flex flex-col items-center">
                    <span>{date.getDate()}</span>
                    {d && (
                      <span className={`absolute -bottom-1 text-[8px] font-bold leading-none rounded-full px-1 ${getScoreColor(d.score)}`}>
                        {d.score}
                      </span>
                    )}
                  </div>
                );
              },
            }}
          />
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      {selectedDate && selected && (
        <Dialog open={true} onOpenChange={(open) => !open && setSelectedDate(null)}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Moon className="w-5 h-5 text-primary" />
                {format(parseISO(selectedDate), "EEEE, MMMM d yyyy")}
              </DialogTitle>
              <DialogDescription>Sleep analysis & AI insights</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Score badge */}
              <div className="flex items-center gap-3">
                <div className={`text-3xl font-bold ${scoreLabel(selected.score).color}`}>
                  {selected.score}
                </div>
                <div>
                  <p className={`font-semibold ${scoreLabel(selected.score).color}`}>
                    {scoreLabel(selected.score).label}
                  </p>
                  <p className="text-xs text-muted-foreground">Sleep Score</p>
                </div>
              </div>

              {/* Stage breakdown */}
              {(() => {
                const hasStages = selected.stages.deep > 0 || selected.stages.rem > 0 || selected.stages.light > 0;
                const stageItems = hasStages
                  ? [
                      { key: "deep" as const, label: "Deep", color: "bg-primary" },
                      { key: "rem" as const, label: "REM", color: "bg-blue-500" },
                      { key: "light" as const, label: "Light", color: "bg-muted-foreground/40" },
                      { key: "awake" as const, label: "Awake", color: "bg-destructive/50" },
                    ]
                  : [
                      { key: "sleep" as const, label: "Sleep", color: "bg-primary" },
                      { key: "awake" as const, label: "Awake", color: "bg-destructive/50" },
                    ];
                const total = selected.stages.deep + selected.stages.light + selected.stages.rem + selected.stages.awake + selected.stages.sleep;
                return (
                  <>
                    <div className={`grid gap-2 ${hasStages ? "grid-cols-2" : "grid-cols-2"}`}>
                      {stageItems.map(({ key, label, color }) => {
                        const secs = selected.stages[key];
                        if (secs === 0 && key !== "awake") return null;
                        const h = Math.floor(secs / 3600);
                        const m = Math.round((secs % 3600) / 60);
                        const pct = total > 0 ? Math.round((secs / total) * 100) : 0;
                        return (
                          <div key={key} className="flex items-center gap-2 rounded-md border p-2">
                            <div className={`w-3 h-3 rounded-full ${color}`} />
                            <div>
                              <p className="text-sm font-medium">{label}</p>
                              <p className="text-xs text-muted-foreground">{h}h {m}m ({pct}%)</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {!hasStages && (
                      <p className="text-xs text-muted-foreground italic">No stage breakdown available — showing total sleep time</p>
                    )}
                    <p className="text-sm text-muted-foreground">Total: {Math.floor(total / 3600)}h {Math.round((total % 3600) / 60)}m</p>
                  </>
                );
              })()}

              {/* AI Insight */}
              <div className="border-t pt-3">
                <p className="text-sm font-semibold mb-2 flex items-center gap-1">
                  🧠 AI Sleep Insight
                  {insightLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                </p>
                {insight ? (
                  <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                    <MarkdownRenderer content={insight} />
                  </div>
                ) : insightLoading ? (
                  <p className="text-xs text-muted-foreground">Analyzing your sleep…</p>
                ) : null}
                <p className="text-[10px] text-muted-foreground mt-2 italic">
                  Sources: National Sleep Foundation, Mayo Clinic, Matthew Walker — "Why We Sleep"
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
};

export default SleepCalendar;
