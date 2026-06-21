import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Moon, Loader2, CalendarDays, Search, Upload } from "lucide-react";
import { format, parseISO, subDays, isValid } from "date-fns";
import { calculateSleepScore, scoreLabel, type SleepStageData } from "@/lib/sleep-score";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { toast } from "sonner";
import { AUTO_SYNC_DONE } from "@/lib/auto-sync";

import { dedupeSleepRowsByPrecedence } from "@/lib/sleep-source-precedence";

type GarminVitals = {
  breathing_variations?: string | null;
  restless_moments?: number | null;
  avg_overnight_hr?: number | null;
  resting_heart_rate?: number | null;
  body_battery_change?: number | null;
  avg_spo2?: number | null;
  lowest_spo2?: number | null;
  avg_respiration?: number | null;
  lowest_respiration?: number | null;
  avg_overnight_hrv?: number | null;
  hrv_7d_avg?: number | null;
  hrv_7d_status?: string | null;
  skin_temp_change_c?: number | null;
};

const normaliseBreathingPattern = (value?: string | null) => {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("balanced")) return "Balanced";
  if (v.includes("few")) return "Few";
  if (v.includes("some")) return "Some";
  if (v.includes("many")) return "Many";
  return value!.trim();
};
const normaliseHrvStatus = (value?: string | null) => {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return null;
  if (v.includes("unbalanced")) return "Unbalanced";
  if (v.includes("balanced")) return "Balanced";
  if (v.includes("low")) return "Low";
  if (v.includes("high")) return "High";
  return value!.trim();
};

interface SleepStageRow {
  date: string;
  stage: string;
  duration_seconds: number;
  source: string;
}

interface DailyData {
  date: string;
  stages: SleepStageData;
  score: number;
}

interface DailyMetricSleepRow {
  date: string;
  sleep_duration_seconds: number | null;
}

const SleepCalendar = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<SleepStageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [insight, setInsight] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [displayMonth, setDisplayMonth] = useState<Date>(new Date());
  const [searchValue, setSearchValue] = useState("");
  const [uploading, setUploading] = useState(false);
  const topFileRef = useRef<HTMLInputElement>(null);
  const dialogFileRef = useRef<HTMLInputElement>(null);

  const fetchSleepData = useCallback(async () => {
    if (!user) return;
    // Pull the user's full sleep history so every night with data shows a score on the calendar.
    const since = "2015-01-01";

    // Pull staged sleep plus legacy duration-only sleep. Manual/staged data wins;
    // daily_metrics is only used where no sleep_stages row exists for that date.
    const [{ data: stageData }, { data: metricData }] = await Promise.all([
      supabase
        .from("sleep_stages")
        .select("date, stage, duration_seconds, source")
        .eq("user_id", user.id)
        .gte("date", since)
        .order("date", { ascending: false })
        .limit(10000),
      supabase
        .from("daily_metrics")
        .select("date, sleep_duration_seconds")
        .eq("user_id", user.id)
        .gte("date", since)
        .not("sleep_duration_seconds", "is", null)
        .order("date", { ascending: false })
        .limit(10000),
    ]);

    const deduped = dedupeSleepRowsByPrecedence((stageData as SleepStageRow[]) || []);
    const stageDates = new Set(deduped.map((r) => r.date));
    const fallbackRows = ((metricData as DailyMetricSleepRow[]) || [])
      .filter((r) => !stageDates.has(r.date) && Number(r.sleep_duration_seconds) > 0)
      .map((r) => ({
        date: r.date,
        stage: "sleep",
        duration_seconds: Number(r.sleep_duration_seconds),
        source: "daily_metrics",
      }));

    setRows([...deduped, ...fallbackRows].map(r => ({
      date: r.date,
      stage: r.stage,
      duration_seconds: r.duration_seconds,
      source: r.source,
    })));
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

  // One-shot backfill: every night with sleep_stages data should have a
  // corresponding daily_metrics.sleep_score, so historical Garmin/Health
  // Connect nights show a score everywhere (KPI, sources panel, etc.).
  useEffect(() => {
    if (!user) return;
    if (loading) return;
    const dates = Object.keys(byDate);
    if (dates.length === 0) return;
    const flagKey = `sleep-score-backfill:${user.id}`;
    if (sessionStorage.getItem(flagKey)) return;

    (async () => {
      try {
        const { data: existing } = await supabase
          .from("daily_metrics")
          .select("id, date, sleep_score")
          .eq("user_id", user.id)
          .in("date", dates);

        // Pick the first row per date that already has a score; otherwise
        // remember any row id we can update in place.
        const scoredDates = new Set<string>();
        const updatableIdByDate = new Map<string, string>();
        for (const r of existing ?? []) {
          if (r.sleep_score != null) scoredDates.add(r.date);
          if (!updatableIdByDate.has(r.date)) updatableIdByDate.set(r.date, r.id as string);
        }

        const missing = dates.filter((d) => !scoredDates.has(d));
        if (missing.length === 0) {
          sessionStorage.setItem(flagKey, "1");
          return;
        }

        const updates: Promise<unknown>[] = [];
        const inserts: Record<string, unknown>[] = [];
        for (const d of missing) {
          const data = byDate[d];
          if (!data) continue;
          const total =
            data.stages.deep + data.stages.light + data.stages.rem + data.stages.sleep;
          const id = updatableIdByDate.get(d);
          if (id) {
            updates.push(
              Promise.resolve(
                supabase
                  .from("daily_metrics")
                  .update({ sleep_score: data.score, sleep_duration_seconds: total })
                  .eq("id", id)
              )
            );
          } else {
            inserts.push({
              user_id: user.id,
              date: d,
              sleep_score: data.score,
              sleep_duration_seconds: total,
            });
          }
        }

        if (inserts.length > 0) {
          for (let i = 0; i < inserts.length; i += 200) {
            updates.push(
              Promise.resolve(
                supabase.from("daily_metrics").insert(inserts.slice(i, i + 200) as never)
              )
            );
          }
        }
        await Promise.allSettled(updates);
        sessionStorage.setItem(flagKey, "1");
      } catch {
        // Silent — backfill will retry next session.
      }
    })();
  }, [user, loading, byDate]);


  const sleepDates = useMemo(() => Object.keys(byDate).map(d => parseISO(d)), [byDate]);

  const getScoreColor = (score: number) => {
    if (score >= 85) return "bg-primary text-primary-foreground";
    if (score >= 70) return "bg-primary/60 text-primary-foreground";
    if (score >= 50) return "bg-yellow-500/60 text-white";
    return "bg-destructive/60 text-white";
  };

  const cacheKey = (dateStr: string, score: number) =>
    `sleep-insight:${user?.id ?? "anon"}:${dateStr}:${score}`;

  const fetchInsight = useCallback(async (dateStr: string) => {
    const data = byDate[dateStr];
    if (!data) return;
    setInsight("");

    // Try cache first (keyed by date + score so a re-scored night re-analyses).
    try {
      const cached = localStorage.getItem(cacheKey(dateStr, data.score));
      if (cached) {
        setInsight(cached);
        setInsightLoading(false);
        return;
      }
    } catch { /* ignore */ }

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

      // Persist completed analysis so future clicks are instant.
      if (accumulated.trim().length > 0) {
        try {
          localStorage.setItem(cacheKey(dateStr, data.score), accumulated);
        } catch { /* quota — ignore */ }
      }
    } catch (e) {
      setInsight("Error generating insight.");
    } finally {
      setInsightLoading(false);
    }
  }, [byDate, user]);

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
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDisplayMonth(new Date())}
              className="gap-1"
            >
              <CalendarDays className="w-4 h-4" />
              Today
            </Button>
            <form
              className="flex gap-2 flex-1"
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = parseISO(searchValue);
                if (!isValid(parsed)) return;
                setDisplayMonth(parsed);
                const dateStr = format(parsed, "yyyy-MM-dd");
                if (byDate[dateStr]) {
                  setSelectedDate(dateStr);
                  fetchInsight(dateStr);
                }
              }}
            >
              <Input
                type="date"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="h-9"
              />
              <Button type="submit" variant="outline" size="sm" className="gap-1">
                <Search className="w-4 h-4" />
                Go
              </Button>
            </form>
          </div>
          <Calendar
            mode="single"
            month={displayMonth}
            onMonthChange={setDisplayMonth}
            selected={selectedDate ? parseISO(selectedDate) : undefined}
            onSelect={(day) => day && handleDayClick(day)}
            modifiers={{ hasSleep: sleepDates }}
            modifiersClassNames={{
              hasSleep: "ring-2 ring-primary/50 rounded-md",
            }}
            className="mx-auto pointer-events-auto"
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
                        const totalMin = Math.round(secs / 60);
                        const h = Math.floor(totalMin / 60);
                        const m = totalMin % 60;
                        const pct = total > 0 ? Math.round((secs / total) * 100) : 0;
                        return (
                          <div key={key} className="flex items-center gap-2 rounded-md border p-2">
                            <div className={`w-3 h-3 rounded-full ${color}`} />
                            <div>
                              <p className="text-sm font-medium">{label}</p>
                              <p className="text-xs text-muted-foreground">{h}:{String(m).padStart(2, "0")} ({pct}%)</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {!hasStages && (
                      <p className="text-xs text-muted-foreground italic">No stage breakdown available — showing total sleep time</p>
                    )}
                    <p className="text-sm text-muted-foreground">Total: {Math.floor(total / 3600)}:{String(Math.round((total % 3600) / 60)).padStart(2, "0")}</p>
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
