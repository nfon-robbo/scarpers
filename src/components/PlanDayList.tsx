import { useMemo, useState, useRef } from "react";
import { format, addDays, differenceInDays, startOfWeek, isSameDay, isToday } from "date-fns";
import { ChevronRight, Dumbbell, Clock, Activity, CheckCircle2, GripVertical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ParsedWorkout } from "@/lib/plan-export";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

interface PlanDayListProps {
  workouts: ParsedWorkout[];
  planStartDate?: Date;
  planEndDate?: Date;
  completedDates?: Set<string>;
  onMoveWorkout?: (fromDate: string, toDate: string) => void;
}

function shortLabel(title: string): string {
  return title.replace(/\s*\(Total:.*?\)/i, "").replace(/\*\*/g, "").trim();
}

function extractDistance(w: ParsedWorkout): string | null {
  const txt = `${w.title} ${w.rawText}`;
  const m = txt.match(/~?(\d+(?:\.\d+)?)\s*km/i);
  return m ? `${m[1]}km` : null;
}

function extractDuration(w: ParsedWorkout): string | null {
  const txt = `${w.title} ${w.rawText}`;
  const m = txt.match(/(\d+)\s*min/i) || txt.match(/Total:\s*(\d+)/i);
  if (m) {
    const mins = parseInt(m[1], 10);
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const r = mins % 60;
      return r ? `${h}h ${r}min` : `${h}h`;
    }
    return `~${mins}min`;
  }
  return null;
}

function workoutAccent(title: string): string {
  if (/rest/i.test(title)) return "bg-muted-foreground/30";
  if (/easy|recovery/i.test(title)) return "bg-emerald-500";
  if (/long\s*run/i.test(title)) return "bg-amber-500";
  if (/tempo|threshold/i.test(title)) return "bg-orange-500";
  if (/interval|fartlek|hill|race/i.test(title)) return "bg-red-500";
  return "bg-primary";
}

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

export default function PlanDayList({
  workouts,
  planStartDate,
  planEndDate,
  completedDates = new Set(),
  onMoveWorkout,
}: PlanDayListProps) {
  const [selectedWorkout, setSelectedWorkout] = useState<ParsedWorkout | null>(null);
  const [dragSourceDate, setDragSourceDate] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const touchSourceRef = useRef<string | null>(null);

  const workoutMap = useMemo(() => {
    const map = new Map<string, ParsedWorkout>();
    for (const w of workouts) {
      if (w.dateObj) map.set(format(w.dateObj, "yyyy-MM-dd"), w);
    }
    return map;
  }, [workouts]);

  const days = useMemo(() => {
    if (!planStartDate) return [];
    const dates = workouts.filter(w => w.dateObj).map(w => w.dateObj!.getTime());
    const earliest = dates.length ? new Date(Math.min(...dates, planStartDate.getTime())) : planStartDate;
    const latest = planEndDate
      ? planEndDate
      : (dates.length ? new Date(Math.max(...dates)) : addDays(planStartDate, 27));
    const total = Math.max(1, differenceInDays(latest, earliest) + 1);
    return Array.from({ length: total }, (_, i) => addDays(earliest, i));
  }, [workouts, planStartDate, planEndDate]);

  const weekGroups = useMemo(() => {
    if (!days.length) return [] as { weekNumber: number; days: Date[] }[];
    const planStart = startOfWeek(days[0], { weekStartsOn: 1 });
    const groups: Record<number, Date[]> = {};
    for (const d of days) {
      const wkStart = startOfWeek(d, { weekStartsOn: 1 });
      const wkNum = Math.floor(differenceInDays(wkStart, planStart) / 7) + 1;
      if (!groups[wkNum]) groups[wkNum] = [];
      groups[wkNum].push(d);
    }
    return Object.entries(groups)
      .map(([n, ds]) => ({ weekNumber: Number(n), days: ds }))
      .sort((a, b) => a.weekNumber - b.weekNumber);
  }, [days]);

  const handleDragStart = (e: React.DragEvent, dateKey: string) => {
    setDragSourceDate(dateKey);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dateKey);
  };

  const handleDragOver = (e: React.DragEvent, dateKey: string) => {
    if (!dragSourceDate || dragSourceDate === dateKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverDate !== dateKey) setDragOverDate(dateKey);
  };

  const handleDrop = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const sourceKey = e.dataTransfer.getData("text/plain") || dragSourceDate;
    setDragSourceDate(null);
    setDragOverDate(null);
    if (sourceKey && sourceKey !== targetKey && onMoveWorkout) {
      onMoveWorkout(sourceKey, targetKey);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="divide-y">
        {weekGroups.map((group) => (
          <div key={group.weekNumber}>
            <div className="px-4 py-2 bg-muted/40 border-b">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Week {group.weekNumber}
              </p>
            </div>
            <div className="divide-y">
              {group.days.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const workout = workoutMap.get(key);
                const today = isToday(day);
                const isCompleted = completedDates.has(key);
                const isDragOver = dragOverDate === key;
                const isDragSource = dragSourceDate === key;
                const draggable = !!workout && !!onMoveWorkout;

                return (
                  <div
                    key={key}
                    onDragOver={(e) => handleDragOver(e, key)}
                    onDragLeave={() => setDragOverDate((d) => (d === key ? null : d))}
                    onDrop={(e) => handleDrop(e, key)}
                    className={cn(
                      "flex items-stretch gap-3 px-3 py-2.5 transition-colors",
                      today && "bg-primary/5",
                      isDragOver && "bg-primary/10 ring-2 ring-primary/40 ring-inset",
                      isDragSource && "opacity-40"
                    )}
                  >
                    {/* Date column */}
                    <div className="flex flex-col items-center justify-center w-14 shrink-0 text-center">
                      <span className={cn(
                        "text-[10px] font-semibold uppercase tracking-wider",
                        today ? "text-primary" : "text-muted-foreground"
                      )}>
                        {format(day, "EEE")}
                      </span>
                      <span className={cn(
                        "text-[11px] font-medium",
                        today ? "text-primary" : "text-muted-foreground"
                      )}>
                        {format(day, "d MMM")}
                      </span>
                    </div>

                    {/* Workout card / rest */}
                    {workout ? (
                      <button
                        type="button"
                        draggable={draggable}
                        onDragStart={(e) => handleDragStart(e, key)}
                        onDragEnd={() => { setDragSourceDate(null); setDragOverDate(null); }}
                        onClick={() => setSelectedWorkout(workout)}
                        className={cn(
                          "flex-1 flex items-center gap-2 text-left rounded-lg border bg-card hover:bg-accent/40 transition-colors px-3 py-2 group",
                          isCompleted && "border-primary/40"
                        )}
                      >
                        {/* Coloured accent bar */}
                        <span className={cn("w-1 self-stretch rounded-full", workoutAccent(workout.title))} />
                        {draggable && (
                          <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground shrink-0 cursor-grab active:cursor-grabbing" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{shortLabel(workout.title)}</p>
                          {(extractDuration(workout) || extractDistance(workout)) && (
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {[extractDuration(workout), extractDistance(workout)].filter(Boolean).join(" • ")}
                            </p>
                          )}
                        </div>
                        {isCompleted && (
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                    ) : (
                      <div className="flex-1 flex items-center rounded-lg border border-dashed bg-muted/20 px-3 py-2">
                        <span className="text-sm text-muted-foreground/70">Rest</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Workout Detail Dialog */}
      <Dialog open={!!selectedWorkout} onOpenChange={(open) => !open && setSelectedWorkout(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          {selectedWorkout && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Dumbbell className="w-5 h-5 text-primary" />
                  {shortLabel(selectedWorkout.title)}
                </DialogTitle>
                <DialogDescription>
                  {selectedWorkout.dateObj ? format(selectedWorkout.dateObj, "EEEE, d MMMM yyyy") : selectedWorkout.date}
                </DialogDescription>
              </DialogHeader>

              {selectedWorkout.segments.length > 0 ? (
                <div className="space-y-2 mt-2">
                  {selectedWorkout.segments.map((seg, i) => (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{seg.segment}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {seg.duration}
                        </span>
                      </div>
                      {seg.target && (
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
