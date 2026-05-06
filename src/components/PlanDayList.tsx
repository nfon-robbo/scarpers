import { useMemo, useState, useRef, useEffect } from "react";
import { format, addDays, differenceInDays, startOfWeek, isSameDay, isToday } from "date-fns";
import { ChevronRight, Dumbbell, Clock, Activity, CheckCircle2, GripVertical, Footprints, PersonStanding, Pencil, RefreshCw, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ParsedWorkout } from "@/lib/plan-export";
import { expandWorkoutSteps } from "@/lib/plan-step-expand";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface PlanDayListProps {
  workouts: ParsedWorkout[];
  planStartDate?: Date;
  planEndDate?: Date;
  completedDates?: Set<string>;
  onMoveWorkout?: (fromDate: string, toDate: string) => void;
  onSyncWorkout?: () => void | Promise<void>;
  syncing?: boolean;
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

// Map an HR zone (or text cue) to a target pace (min/km).
// Defaults assume a recreational runner; tweak per-athlete in a future iteration.
function paceForZone(zone: string, segmentText: string): string {
  const txt = `${zone} ${segmentText}`.toLowerCase();
  if (/walk/.test(txt)) return "9:57";
  if (/z5|vo2|sprint/.test(txt)) return "4:30";
  if (/z4|threshold|race\s*pace/.test(txt)) return "5:00";
  if (/z3|tempo|steady/.test(txt)) return "5:30";
  if (/easy|recovery|z1|z2|warm|cool/.test(txt)) return "6:27";
  return "6:27";
}

// Format any "1 min", "30 sec", "5 min", "10km" duration into MM:SS where possible
function formatTime(duration: string): string {
  const minMatch = duration.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (minMatch) {
    const total = Math.round(parseFloat(minMatch[1]) * 60);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const secMatch = duration.match(/(\d+)\s*sec/i);
  if (secMatch) {
    const s = parseInt(secMatch[1], 10);
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  return duration;
}

// Expand a segment row like "10 x 1 min" into individual run/walk/recovery steps
type Step = { kind: "run" | "walk" | "rest"; label: string; duration: string; pace: string };

// Try to detect the interval prescription (reps + run / walk durations) from a free-text source
// e.g. "Walk/Run Intervals: 10 × 1min", "8 x 2min run / 90s walk", "10x1min", "12 × 1 min"
function detectIntervalSpec(text: string): { reps: number; on: string; off: string } | null {
  if (!text) return null;
  const re = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?\s*(?:min|sec|s|m)\b)(?:\s*(?:run|on)?)?(?:\s*[\/,]\s*(\d+(?:\.\d+)?\s*(?:min|sec|s|m)\b)(?:\s*(?:walk|off|recovery)?)?)?/i;
  const m = text.match(re);
  if (!m) return null;
  return { reps: parseInt(m[1], 10), on: m[2], off: m[3] || "1 min" };
}

function expandSegments(
  segments: { segment: string; duration: string; target: string; hrZone: string; notes?: string }[],
  workoutTitle: string,
  rawText: string,
): Step[] {
  const steps: Step[] = [];
  let runIdx = 0;
  let walkIdx = 0;
  let mainEmitted = false;

  // Pre-compute fallback interval spec from the workout title or full raw text.
  // Only use fallback if NO segment row contains its own interval spec — otherwise
  // we'd emit the reps twice (once after warm-up, once from the main row).
  const segHasOwnSpec = segments.some(
    (s) => detectIntervalSpec(s.duration) || (/main|interval|rep|work/i.test(s.segment) && detectIntervalSpec(s.segment + " " + (s.notes || ""))),
  );
  const fallbackSpec = segHasOwnSpec ? null : (detectIntervalSpec(workoutTitle) || detectIntervalSpec(rawText));

  const emitIntervalBlock = (spec: { reps: number; on: string; off: string }, hrZone: string, segText: string, notes?: string) => {
    for (let i = 0; i < spec.reps; i++) {
      runIdx++;
      steps.push({
        kind: "run",
        label: `Run ${runIdx}`,
        duration: formatTime(spec.on),
        pace: paceForZone(hrZone, segText + " " + (notes || "")),
      });
      walkIdx++;
      steps.push({
        kind: "walk",
        label: `Walk ${walkIdx}`,
        duration: formatTime(spec.off),
        pace: "9:57",
      });
    }
    mainEmitted = true;
  };

  for (const seg of segments) {
    const isWarmup = /warm/i.test(seg.segment);
    const isCooldown = /cool/i.test(seg.segment);
    const isMain = /main|interval|rep|work/i.test(seg.segment);
    const isWalk = !isMain && (/walk|recovery|rest/i.test(seg.segment) || /walk|recovery/i.test(seg.duration));

    // Try to expand reps from this segment's own duration first
    const segSpec = detectIntervalSpec(seg.duration) || (isMain ? detectIntervalSpec(seg.segment + " " + (seg.notes || "")) : null);

    if (segSpec) {
      emitIntervalBlock(segSpec, seg.hrZone, seg.segment, seg.notes);
      continue;
    }

    if (isWarmup) {
      const isWalkWarmup = /walk/i.test(seg.duration) || /walk/i.test(seg.segment) || /walk/i.test(seg.notes || "");
      steps.push({
        kind: "walk",
        label: isWalkWarmup ? "Warm Up - Walk" : "Warm Up",
        duration: formatTime(seg.duration),
        pace: isWalkWarmup ? "9:57" : paceForZone(seg.hrZone, seg.segment + " " + seg.duration),
      });
      // If the table has no main interval row, inject the fallback spec straight after warm-up
      if (fallbackSpec && !mainEmitted) {
        const mainSeg = segments.find((s) => /main|interval|rep|work/i.test(s.segment));
        emitIntervalBlock(fallbackSpec, mainSeg?.hrZone || "Z2", mainSeg?.segment || "Run", mainSeg?.notes);
      }
    } else if (isCooldown) {
      // Safety net: if main was never emitted (no warm-up row either) inject before cool-down
      if (fallbackSpec && !mainEmitted) {
        emitIntervalBlock(fallbackSpec, seg.hrZone, "Run", seg.notes);
      }
      const isWalkCooldown = /walk/i.test(seg.duration) || /walk/i.test(seg.segment) || /walk/i.test(seg.notes || "");
      steps.push({
        kind: "walk",
        label: isWalkCooldown ? "Cool Down - Walk" : "Cool Down",
        duration: formatTime(seg.duration),
        pace: isWalkCooldown ? "9:57" : paceForZone(seg.hrZone, seg.segment + " " + seg.duration),
      });
    } else if (isWalk) {
      walkIdx++;
      steps.push({
        kind: "walk",
        label: `Walk ${walkIdx}`,
        duration: formatTime(seg.duration),
        pace: "9:57",
      });
    } else {
      runIdx++;
      steps.push({
        kind: "run",
        label: runIdx === 1 && !/main/i.test(seg.segment) ? seg.segment : `Run ${runIdx}`,
        duration: formatTime(seg.duration),
        pace: paceForZone(seg.hrZone, seg.segment + " " + (seg.notes || "")),
      });
      mainEmitted = true;
    }
  }

  // Final safety net: nothing matched but title says "10 × 1min" — emit warm-up + reps + cool-down
  if (fallbackSpec && !mainEmitted && steps.length === 0) {
    steps.push({ kind: "walk", label: "Warm Up - Walk", duration: "05:00", pace: "9:57" });
    emitIntervalBlock(fallbackSpec, "Z2", "Run", undefined);
    steps.push({ kind: "walk", label: "Cool Down - Walk", duration: "05:00", pace: "9:57" });
  }

  return steps;
}

function EditableStat({
  value,
  label,
  placeholder,
  onSave,
  isOverridden,
}: {
  value: string;
  label: string;
  placeholder?: string;
  onSave: (v: string) => void;
  isOverridden?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (open) setDraft(value); }, [open, value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="px-3 py-2 text-center w-full hover:bg-accent/40 transition-colors group"
        >
          <p className={cn("text-base font-bold leading-tight inline-flex items-center gap-1", isOverridden && "text-primary")}>
            {value}
            <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60" />
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{label}</p>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="center">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <Input
            autoFocus
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setOpen(false);
            }}
            className="h-8 text-sm"
          />
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" className="h-7 px-2 text-xs" onClick={commit}>Save</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PlanDayList({
  workouts,
  planStartDate,
  planEndDate,
  completedDates = new Set(),
  onMoveWorkout,
  onSyncWorkout,
  syncing = false,
}: PlanDayListProps) {
  const [selectedWorkout, setSelectedWorkout] = useState<ParsedWorkout | null>(null);
  const [dragSourceDate, setDragSourceDate] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const touchSourceRef = useRef<string | null>(null);
  // Per-workout overrides: { [workoutKey]: { [stepIdx]: { duration?, pace? } } }
  const [overrides, setOverrides] = useState<Record<string, Record<number, { duration?: string; pace?: string }>>>({});

  const workoutKey = (w: ParsedWorkout) =>
    w.dateObj ? format(w.dateObj, "yyyy-MM-dd") : w.date;

  const setStepOverride = (w: ParsedWorkout, idx: number, field: "duration" | "pace", value: string) => {
    const key = workoutKey(w);
    setOverrides((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [idx]: { ...((prev[key] || {})[idx] || {}), [field]: value },
      },
    }));
  };

  const resetStepOverride = (w: ParsedWorkout, idx: number) => {
    const key = workoutKey(w);
    setOverrides((prev) => {
      const forKey = { ...(prev[key] || {}) };
      delete forKey[idx];
      const next = { ...prev };
      if (Object.keys(forKey).length === 0) delete next[key];
      else next[key] = forKey;
      return next;
    });
  };

  // Load/persist overrides
  useEffect(() => {
    try {
      const raw = localStorage.getItem("plan-step-overrides");
      if (raw) setOverrides(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("plan-step-overrides", JSON.stringify(overrides));
    } catch {}
  }, [overrides]);

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
                (() => {
                  const fmtTime = (secs: number) => `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
                  const fmtPace = (p: string) => p.replace(/\/(km|mi)$/i, "");
                  const expanded = expandWorkoutSteps(selectedWorkout.segments, selectedWorkout.title, selectedWorkout.rawText ?? "");
                  return (
                    <div className="relative mt-2 pl-2">
                      {/* Vertical dotted spine */}
                      <div className="absolute left-[18px] top-3 bottom-3 border-l-2 border-dotted border-muted-foreground/30" />
                      <div className="space-y-3">
                        {expanded.map((step, i) => {
                          const isWalk = step.intensity === "Recovery" || step.intensity === "Rest" || step.intensity === "Cooldown" || step.intensity === "Warmup";
                          const Icon = isWalk ? PersonStanding : Footprints;
                          const durStr = fmtTime(step.duration);
                          const paceStr = fmtPace(step.pace);
                          return (
                            <div key={i} className="relative flex items-start gap-3">
                              <div className="relative z-10 shrink-0 w-9 h-9 rounded-full bg-background border-2 border-muted-foreground/30 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1.5 pt-1">
                                <p className="text-sm font-semibold leading-none">{step.label}</p>
                                <div className="flex items-stretch rounded-xl border bg-card overflow-hidden">
                                  <div className="flex items-center justify-center w-12 bg-primary/10 shrink-0">
                                    <Icon className="w-5 h-5 text-primary" />
                                  </div>
                                  <div className="flex-1 grid grid-cols-2 divide-x">
                                    <EditableStat
                                      value={overrides[workoutKey(selectedWorkout)]?.[i]?.duration ?? durStr}
                                      label="Time (mm:ss)"
                                      placeholder="mm:ss"
                                      onSave={(v) => setStepOverride(selectedWorkout, i, "duration", v)}
                                      isOverridden={!!overrides[workoutKey(selectedWorkout)]?.[i]?.duration}
                                    />
                                    <EditableStat
                                      value={overrides[workoutKey(selectedWorkout)]?.[i]?.pace ?? paceStr}
                                      label="Pace (min/km)"
                                      placeholder="m:ss"
                                      onSave={(v) => setStepOverride(selectedWorkout, i, "pace", v)}
                                      isOverridden={!!overrides[workoutKey(selectedWorkout)]?.[i]?.pace}
                                    />
                                  </div>
                                  {(() => {
                                    const ov = overrides[workoutKey(selectedWorkout)]?.[i];
                                    const isModified = !!(ov?.duration || ov?.pace);
                                    if (!isModified || !onSyncWorkout) return null;
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); onSyncWorkout(); }}
                                        disabled={syncing}
                                        title="Sync this change to intervals.icu"
                                        className="flex items-center justify-center px-3 bg-primary/10 hover:bg-primary/20 transition-colors border-l text-primary disabled:opacity-50"
                                      >
                                        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()
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
