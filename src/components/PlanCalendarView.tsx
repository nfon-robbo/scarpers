import { useMemo, useState } from "react";
import { format, startOfWeek, addDays, addWeeks, subWeeks, isSameDay, isToday } from "date-fns";
import { ChevronLeft, ChevronRight, Dumbbell, Clock, Activity, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ParsedWorkout } from "@/lib/plan-export";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import WorkoutIntervalChart from "@/components/WorkoutIntervalChart";
import { expandWorkoutSteps, expandedToSegments } from "@/lib/plan-step-expand";

interface PlanCalendarViewProps {
  workouts: ParsedWorkout[];
  planStartDate?: Date;
  completedDates?: Set<string>;
}

export default function PlanCalendarView({ workouts, planStartDate, completedDates = new Set() }: PlanCalendarViewProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => {
    return startOfWeek(new Date(), { weekStartsOn: 1 });
  });
  const [selectedWorkout, setSelectedWorkout] = useState<ParsedWorkout | null>(null);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  // Map workouts by date string for quick lookup
  const workoutMap = useMemo(() => {
    const map = new Map<string, ParsedWorkout>();
    for (const w of workouts) {
      if (w.dateObj) {
        map.set(format(w.dateObj, "yyyy-MM-dd"), w);
      }
    }
    return map;
  }, [workouts]);

  // Compute plan date range for week labels
  const planWeeks = useMemo(() => {
    if (!planStartDate || workouts.length === 0) return null;
    const dates = workouts.filter(w => w.dateObj).map(w => w.dateObj!.getTime());
    if (dates.length === 0) return null;
    const earliest = new Date(Math.min(...dates));
    const latest = new Date(Math.max(...dates));
    return { start: earliest, end: latest };
  }, [workouts, planStartDate]);

  // Get current week number within the plan
  const currentWeekLabel = useMemo(() => {
    if (!planWeeks) return null;
    const planStart = startOfWeek(planWeeks.start, { weekStartsOn: 1 });
    const diff = Math.floor((weekStart.getTime() - planStart.getTime()) / (7 * 24 * 60 * 60 * 1000));
    if (diff < 0) return null;
    return `Week ${diff + 1}`;
  }, [weekStart, planWeeks]);

  // Extract short workout label from title
  function shortLabel(title: string): string {
    if (/rest/i.test(title)) return "Rest Day";
    if (/interval/i.test(title)) return "Intervals";
    if (/tempo/i.test(title)) return "Tempo";
    if (/long\s*run/i.test(title)) return "Long Run";
    if (/easy/i.test(title)) return "Easy Run";
    if (/recovery/i.test(title)) return "Recovery";
    if (/fartlek/i.test(title)) return "Fartlek";
    if (/hill/i.test(title)) return "Hills";
    if (/race/i.test(title)) return "Race";
    if (/threshold/i.test(title)) return "Threshold";
    if (/cadence/i.test(title)) return "Cadence";
    if (/steady/i.test(title)) return "Steady";
    if (/aerobic/i.test(title)) return "Aerobic";
    return title.split(/[(\-–]/)[0].trim().slice(0, 18);
  }

  // Extract music BPM from workout segments notes, with fallback based on HR zone
  function musicBpm(w: ParsedWorkout): string | null {
    // First check for explicit BPM in notes
    for (const seg of w.segments) {
      if (seg.notes) {
        const match = seg.notes.match(/(\d{3})\s*BPM/i);
        if (match) return `🎵 ${match[1]}`;
      }
    }
    // Fallback: derive from the main segment's HR zone
    const mainSeg = w.segments.find(s => /main|interval/i.test(s.segment));
    if (mainSeg?.hrZone) {
      const m = mainSeg.hrZone.match(/Z(\d)/i);
      if (m) {
        const z = parseInt(m[1], 10);
        const bpmMap: Record<number, number> = { 1: 150, 2: 155, 3: 165, 4: 170, 5: 175 };
        if (bpmMap[z]) return `🎵 ${bpmMap[z]}`;
      }
    }
    return null;
  }

  // Color based on workout intensity
  function workoutColor(title: string): string {
    if (/rest/i.test(title)) return "bg-muted text-muted-foreground";
    if (/easy|recovery/i.test(title)) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30";
    if (/long\s*run/i.test(title)) return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    if (/tempo|threshold/i.test(title)) return "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30";
    if (/interval|fartlek|hill|race/i.test(title)) return "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30";
    return "bg-primary/10 text-primary border-primary/20";
  }

  // Duration: sum from segments so calendar matches workout detail
  function totalDuration(w: ParsedWorkout): string | null {
    let total = 0;
    for (const seg of w.segments || []) {
      const d = (seg.duration || "").trim();
      if (!d) continue;
      const reps = d.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(min|sec|s|m)\b/i);
      if (reps) {
        const n = parseInt(reps[1], 10);
        const v = parseFloat(reps[2]);
        total += n * (reps[3].toLowerCase().startsWith("s") ? v : v * 60);
        continue;
      }
      const colon = d.match(/^(\d{1,3}):(\d{2})$/);
      if (colon) { total += parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10); continue; }
      const min = d.match(/(\d+(?:\.\d+)?)\s*min/i);
      if (min) { total += parseFloat(min[1]) * 60; continue; }
      const sec = d.match(/(\d+(?:\.\d+)?)\s*(?:sec|s)\b/i);
      if (sec) { total += parseFloat(sec[1]); continue; }
    }
    if (total > 0) return `${Math.round(total / 60)}m`;
    const match = w.title.match(/(\d+)\s*min/i);
    if (match) return `${match[1]}m`;
    const totalMatch = w.title.match(/Total:\s*(\d+)\s*min/i);
    if (totalMatch) return `${totalMatch[1]}m`;
    return null;
  }

  // HR zone to BPM range
  function hrZoneBpm(zone: string): string | null {
    const m = zone.match(/Z(\d)/i);
    if (!m) return null;
    const z = parseInt(m[1], 10);
    switch (z) {
      case 1: return "100–120 bpm";
      case 2: return "120–140 bpm";
      case 3: return "140–160 bpm";
      case 4: return "160–175 bpm";
      case 5: return "175–200 bpm";
      default: return null;
    }
  }

  const weekLabel = `${format(weekDays[0], "dd MMM")} – ${format(weekDays[6], "dd MMM ''yy")}`;

  return (
    <Card className="overflow-hidden">
      {/* Week Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekStart(s => subWeeks(s, 1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">{weekLabel}</p>
          {currentWeekLabel && (
            <p className="text-xs text-muted-foreground">{currentWeekLabel}</p>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setWeekStart(s => addWeeks(s, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Day Grid */}
      <div className="grid grid-cols-7 min-h-[140px]">
        {weekDays.map((day) => {
          const key = format(day, "yyyy-MM-dd");
          const workout = workoutMap.get(key);
          const today = isToday(day);
          const isCompleted = completedDates.has(key);

          return (
            <div
              key={key}
              className={cn(
                "flex flex-col items-center border-r last:border-r-0 py-2 px-0.5 gap-1.5",
                today && "bg-primary/5"
              )}
            >
              {/* Day name */}
              <span className={cn(
                "text-[10px] sm:text-xs font-medium uppercase tracking-wide",
                today ? "text-primary" : "text-muted-foreground"
              )}>
                {format(day, "EEE")}
              </span>

              {/* Date circle */}
              <span className={cn(
                "flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-full text-xs sm:text-sm font-semibold",
                today
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground"
              )}>
                {format(day, "d")}
              </span>

              {/* Workout card */}
              {workout ? (
                <div
                  className={cn(
                    "w-full rounded-md border px-1 py-1.5 text-center cursor-pointer transition-colors hover:ring-2 hover:ring-primary/40 relative",
                    isCompleted
                      ? "bg-primary/15 text-primary border-primary/30"
                      : workoutColor(workout.title)
                  )}
                  onClick={() => setSelectedWorkout(workout)}
                >
                  {isCompleted && (
                    <CheckCircle2 className="w-3 h-3 text-primary absolute top-0.5 right-0.5" />
                  )}
                  <p className="text-[9px] sm:text-[10px] font-semibold leading-tight truncate">
                    {shortLabel(workout.title)}
                  </p>
                  {(totalDuration(workout) || musicBpm(workout)) && (
                    <p className="text-[8px] sm:text-[9px] opacity-75 mt-0.5 truncate">
                      {[totalDuration(workout), musicBpm(workout)].filter(Boolean).join(" ")}
                    </p>
                  )}
                </div>
              ) : (
                <div className="w-full flex items-center justify-center flex-1">
                  <span className="text-[10px] text-muted-foreground/40">—</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Workout Detail Dialog */}
      <Dialog open={!!selectedWorkout} onOpenChange={(open) => !open && setSelectedWorkout(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          {selectedWorkout && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Dumbbell className="w-5 h-5 text-primary" />
                  {selectedWorkout.title}
                </DialogTitle>
                <DialogDescription>
                  {selectedWorkout.dateObj ? format(selectedWorkout.dateObj, "EEEE, d MMMM yyyy") : selectedWorkout.date}
                </DialogDescription>
              </DialogHeader>

              {selectedWorkout.segments.length > 0 ? (
                <div className="space-y-2 mt-2">
                  <WorkoutIntervalChart segments={expandedToSegments(expandWorkoutSteps(selectedWorkout.segments, selectedWorkout.title, selectedWorkout.rawText ?? ""))} />
                  {selectedWorkout.segments.map((seg, i) => (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{seg.segment}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {seg.duration}
                        </span>
                      </div>
                      {seg.target && !/warm\s*-?\s*up|cool\s*-?\s*down|rest|recovery|walk/i.test(seg.segment) && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Target:</span> {seg.target}
                        </p>
                      )}
                      {seg.hrZone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Activity className="w-3 h-3" /> {seg.hrZone}{hrZoneBpm(seg.hrZone) && ` (${hrZoneBpm(seg.hrZone)})`}
                        </p>
                      )}
                      {seg.notes && (
                        <p className="text-xs text-muted-foreground italic">{seg.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">
                  {selectedWorkout.rawText}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
