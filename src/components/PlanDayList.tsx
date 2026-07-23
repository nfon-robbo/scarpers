import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { format, addDays, differenceInDays, startOfWeek, isSameDay, isToday } from "date-fns";
import { ChevronRight, Dumbbell, Clock, Activity, CheckCircle2, GripVertical, Footprints, PersonStanding, Pencil, RefreshCw, Loader2, Plus, Trash2, CalendarDays } from "lucide-react";
import BenchmarkConfirmCard from "@/components/BenchmarkConfirmCard";
import { supabase } from "@/integrations/supabase/client";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import { getScheduledBenchmarksInRange } from "@/lib/benchmark-scheduled";
import { findBenchmarkCandidates, type ActivityForDetection, type CandidateActivity } from "@/lib/benchmark-detection";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ParsedWorkout } from "@/lib/plan-export";
import { expandWorkoutSteps, expandedToSegments } from "@/lib/plan-step-expand";
import {
  loadCustomSteps, saveCustomSteps, defaultsFor, customToExpanded,
  type CustomStep, type CustomStepKind, type CustomStepsMap,
} from "@/lib/plan-custom-steps";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import WorkoutReviewDialog from "@/components/WorkoutReviewDialog";
import WorkoutIntervalChart from "@/components/WorkoutIntervalChart";
import RaceStrategyBlock from "@/components/RaceStrategyBlock";
import pauseHolidayIcon from "@/assets/pause-holiday.png";
import pauseIllnessIcon from "@/assets/pause-illness.png";
import pauseInjuryIcon from "@/assets/pause-injury.png";
import pauseOtherIcon from "@/assets/pause-other.png";
import pauseBgHoliday from "@/assets/pause-bg-holiday.jpg";
import pauseBgIllness from "@/assets/pause-bg-illness.jpg";
import pauseBgInjury from "@/assets/pause-bg-injury.jpg";
import pauseBgOther from "@/assets/pause-bg-other.jpg";

interface PlanDayListProps {
  workouts: ParsedWorkout[];
  planStartDate?: Date;
  planEndDate?: Date;
  completedDates?: Set<string>;
  linkedActivities?: Record<string, any>;
  onMoveWorkout?: (fromDate: string, toDate: string) => void;
  onSyncWorkout?: (singleDate?: string) => void | Promise<void>;
  syncing?: boolean;
  goalTime?: string;
  raceDistance?: string;
  onEditWorkout?: (workout: ParsedWorkout) => void;
  isPaused?: boolean;
  pauseWindow?: { start: Date; end: Date } | null;
  pauseReason?: string | null;
  /** Full plan markdown — used to detect scheduled benchmarks per day. */
  planContent?: string | null;
  /** Owning plan id, persisted onto benchmark_results.training_plan_id. */
  planId?: string | null;
  /** Current user id — required for benchmark confirm/reject writes. */
  userId?: string | null;
}

function pauseReasonMeta(reason?: string | null): { icon: string; label: string; bg: string } {
  const r = (reason || "").toLowerCase();
  if (/holiday|vacation|travel/.test(r)) return { icon: pauseHolidayIcon, label: "Holiday", bg: pauseBgHoliday };
  if (/ill|sick|flu|cold/.test(r)) return { icon: pauseIllnessIcon, label: "Illness", bg: pauseBgIllness };
  if (/injur/.test(r)) return { icon: pauseInjuryIcon, label: "Injury", bg: pauseBgInjury };
  return { icon: pauseOtherIcon, label: reason && reason.trim() ? reason : "Paused", bg: pauseBgOther };
}


import { describeWorkoutLabel } from "@/lib/workout-title";

function shortLabel(w: ParsedWorkout | string): string {
  if (typeof w === "string") {
    const cleaned = w
      .replace(/\s*\(Total:.*?\)/i, "")
      .replace(/\*\*/g, "")
      .replace(/^\s*[—–\-]+\s*/, "")
      .trim();
    if (!cleaned || /^rest\b/i.test(cleaned)) return cleaned;
    if (/^scarpers(?:\s+dash)?\s*[-–]/i.test(cleaned)) return cleaned;
    return `Scarpers Dash - ${cleaned}`;
  }
  return describeWorkoutLabel(w.title, w.segments);
}

function extractDistance(w: ParsedWorkout): string | null {
  const txt = `${w.title} ${w.rawText}`;
  const m = txt.match(/~?(\d+(?:\.\d+)?)\s*km/i);
  return m ? `${m[1]}km` : null;
}

// Sum total seconds across all segments of a workout (handles "5 min", "30 sec", "1:30", "MM:SS", "Nx M min")
function sumSegmentSeconds(w: ParsedWorkout): number {
  let total = 0;
  for (const seg of w.segments || []) {
    const d = (seg.duration || "").trim();
    if (!d) continue;
    // "N x M min/sec" pattern
    // "N x M min/sec [ / R min walk ]" pattern — include inline rest in the per-rep time
    const reps = d.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(min|sec|s|m)\b(?:\s*\/\s*(\d+(?:\.\d+)?)\s*(min|sec|s|m)\b[^|]*)?/i);
    if (reps) {
      const n = parseInt(reps[1], 10);
      const v = parseFloat(reps[2]);
      const unit = reps[3].toLowerCase();
      const workSecs = unit.startsWith("s") ? v : v * 60;
      let restSecs = 0;
      if (reps[4]) {
        const rv = parseFloat(reps[4]);
        const ru = reps[5].toLowerCase();
        restSecs = ru.startsWith("s") ? rv : rv * 60;
      }
      total += n * (workSecs + restSecs);
      continue;
    }
    // "MM:SS" or "M:SS" — anywhere in the field (e.g. "5K (~30:00)")
    const colon = d.match(/(\d{1,3}):(\d{2})/);
    if (colon) { total += parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10); continue; }
    // "5 min" / "5.5 min"
    const min = d.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (min) { total += parseFloat(min[1]) * 60; continue; }
    // "30 sec" / "30s"
    const sec = d.match(/(\d+(?:\.\d+)?)\s*(?:sec|s)\b/i);
    if (sec) { total += parseFloat(sec[1]); continue; }
  }
  return Math.round(total);
}

function extractDuration(w: ParsedWorkout, customExtraSecs = 0): string | null {
  const txt = `${w.title} ${w.rawText}`;

  // Race day: detail view shows ONLY the race effort (warm-up/cool-down stripped).
  // Match it: extract just the race leg's time.
  const isRaceDay = /race\s*day|🏁/i.test(txt);
  if (isRaceDay) {
    const raceSeg = (w.segments || []).find(
      (s) => !/warm|cool|rest|recover|stride/i.test(s.segment || "")
    );
    const raceTxt = `${raceSeg?.duration || ""} ${raceSeg?.notes || ""} ${raceSeg?.segment || ""}`;
    const colon = raceTxt.match(/(\d{1,3}):(\d{2})/);
    if (colon) {
      const mins = Math.round((parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10)) / 60);
      return `~${mins}min`;
    }
    const minMatch = raceTxt.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (minMatch) return `~${Math.round(parseFloat(minMatch[1]))}min`;
  }

  // If any segment is distance-based (km/mi/"5K") with no embedded time, the segment-sum
  // will undercount. Prefer the workout's stated total in that case.
  const hasDistanceSeg = (w.segments || []).some((s) =>
    /\d+(?:\.\d+)?\s*(km|mi|k)\b/i.test(s.duration || "") && !/\d{1,3}:\d{2}/.test(s.duration || "")
  );
  const totalMatch =
    txt.match(/Total:\s*~?\s*(\d+)\s*min/i) ||
    txt.match(/~?\s*(\d+)\s*min\s*total/i);

  let mins: number | null = null;
  if (hasDistanceSeg && totalMatch) {
    mins = parseInt(totalMatch[1], 10);
  } else {
    const segSecs = sumSegmentSeconds(w);
    if (segSecs > 0) {
      mins = Math.round(segSecs / 60);
    } else {
      const m = totalMatch || txt.match(/(\d+)\s*min/i);
      if (m) mins = parseInt(m[1], 10);
    }
  }
  if (mins == null && customExtraSecs > 0) mins = 0;
  if (mins == null) return null;
  mins += Math.round(customExtraSecs / 60);
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return r ? `${h}h ${r}min` : `${h}h`;
  }
  return `~${mins}min`;
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
  // Benchmark / test efforts: pace is athlete-determined, don't prescribe one.
  if (/benchmark|hardest\s*effort|all[-\s]?out|time\s*trial|max\s*effort/.test(txt)) return "";
  if (/walk/.test(txt)) return "9:25";
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
        pace: "9:25",
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
        duration: "05:00",
        pace: "9:25",
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
        duration: "05:00",
        pace: "9:25",
      });
    } else if (isWalk) {
      walkIdx++;
      steps.push({
        kind: "walk",
        label: `Walk ${walkIdx}`,
        duration: "05:00",
        pace: "9:25",
      });
    } else {
      runIdx++;
      steps.push({
        kind: "run",
        label: runIdx === 1 && !/main/i.test(seg.segment) ? seg.segment : `Run ${runIdx}`,
        duration: formatTime(seg.duration),
        pace: paceForZone(seg.hrZone, seg.segment + " " + (seg.target || "") + " " + (seg.notes || "")),
      });
      mainEmitted = true;
    }
  }

  // Final safety net: nothing matched but title says "10 × 1min" — emit warm-up + reps + cool-down
  if (fallbackSpec && !mainEmitted && steps.length === 0) {
    steps.push({ kind: "walk", label: "Warm Up - Walk", duration: "05:00", pace: "9:25" });
    emitIntervalBlock(fallbackSpec, "Z2", "Run", undefined);
    steps.push({ kind: "walk", label: "Cool Down - Walk", duration: "05:00", pace: "9:25" });
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

function AddStepForm({ onAdd }: { onAdd: (s: CustomStep) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<CustomStepKind>("warmup");
  const [label, setLabel] = useState("Warm-up");
  const [duration, setDuration] = useState("10:00");
  const [pace, setPace] = useState("");

  const applyKind = (k: CustomStepKind) => {
    setKind(k);
    const d = defaultsFor(k);
    setLabel(d.label);
    setDuration(d.duration);
    setPace(d.pace ?? "");
  };

  const submit = () => {
    if (!duration.trim()) return;
    onAdd({
      id: crypto.randomUUID(),
      kind,
      label: label.trim() || defaultsFor(kind).label,
      duration: duration.trim(),
      pace: kind === "warmup" || kind === "cooldown" ? undefined : (pace.trim() || undefined),
    });
    setOpen(false);
    applyKind("warmup");
  };

  if (!open) {
    return (
      <Button variant="outline" size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 mr-1" /> Add step
      </Button>
    );
  }

  const showPace = kind !== "warmup" && kind !== "cooldown";
  const kinds: { v: CustomStepKind; l: string }[] = [
    { v: "warmup", l: "Warm-up" },
    { v: "rep", l: "Rep" },
    { v: "cooldown", l: "Cool-down" },
    { v: "custom", l: "Custom" },
  ];

  return (
    <div className="rounded-xl border bg-card p-3 space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {kinds.map((k) => (
          <button
            key={k.v}
            type="button"
            onClick={() => applyKind(k.v)}
            className={cn(
              "text-xs py-1.5 rounded-md border transition-colors",
              kind === k.v ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"
            )}
          >
            {k.l}
          </button>
        ))}
      </div>
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="h-8 text-sm" />
      <div className="flex gap-2">
        <Input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="mm:ss" className="h-8 text-sm" />
        {showPace && (
          <Input value={pace} onChange={(e) => setPace(e.target.value)} placeholder="Pace m:ss/km (optional)" className="h-8 text-sm" />
        )}
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(false)}>Cancel</Button>
        <Button size="sm" className="h-7 px-2 text-xs" onClick={submit}>Add</Button>
      </div>
    </div>
  );
}

export default function PlanDayList({
  workouts,
  planStartDate,
  planEndDate,
  completedDates = new Set(),
  linkedActivities = {},
  onMoveWorkout,
  onSyncWorkout,
  syncing = false,
  goalTime,
  raceDistance,
  onEditWorkout,
  isPaused = false,
  pauseWindow = null,
  pauseReason = null,
  planContent = null,
  planId = null,
  userId = null,
}: PlanDayListProps) {
  const [selectedWorkout, setSelectedWorkout] = useState<ParsedWorkout | null>(null);
  const [reviewWorkout, setReviewWorkout] = useState<ParsedWorkout | null>(null);
  const [dragSourceDate, setDragSourceDate] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [syncingDate, setSyncingDate] = useState<string | null>(null);
  const touchSourceRef = useRef<string | null>(null);
  // Per-workout overrides: { [workoutKey]: { [stepIdx]: { duration?, pace? } } }
  const [overrides, setOverrides] = useState<Record<string, Record<number, { duration?: string; pace?: string }>>>({});

  const workoutKey = (w: ParsedWorkout) =>
    w.dateObj ? format(w.dateObj, "yyyy-MM-dd") : w.date;

  const workoutContentKey = (w: ParsedWorkout) => {
    const base = workoutKey(w);
    let hash = 0;
    const text = `${w.title}\n${w.rawText || ""}`;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return `${base}:${Math.abs(hash).toString(36)}`;
  };

  const setStepOverride = (w: ParsedWorkout, idx: number, field: "duration" | "pace", value: string) => {
    const key = workoutContentKey(w);
    setOverrides((prev) => ({
      ...prev,
      [key]: {
        ...(prev[key] || {}),
        [idx]: { ...((prev[key] || {})[idx] || {}), [field]: value },
      },
    }));
  };

  const resetStepOverride = (w: ParsedWorkout, idx: number) => {
    const key = workoutContentKey(w);
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
  useEffect(() => {
    const onCleared = (e: Event) => {
      const date = (e as CustomEvent<{ date?: string }>).detail?.date;
      if (!date) return;
      setOverrides((prev) => {
        if (!Object.keys(prev).some((key) => key === date || key.startsWith(`${date}:`))) return prev;
        const next = { ...prev };
        delete next[date];
        for (const key of Object.keys(next)) {
          if (key.startsWith(`${date}:`)) delete next[key];
        }
        return next;
      });
    };
    window.addEventListener("plan-step-overrides-cleared", onCleared as EventListener);
    return () => window.removeEventListener("plan-step-overrides-cleared", onCleared as EventListener);
  }, []);

  // Custom user-added steps (warm-up / rep / cool-down / custom).
  // Stored locally; appended after AI steps both in UI and on Intervals.icu sync.
  const [customSteps, setCustomSteps] = useState<CustomStepsMap>({});
  useEffect(() => { setCustomSteps(loadCustomSteps()); }, []);
  useEffect(() => { saveCustomSteps(customSteps); }, [customSteps]);

  // ─── Benchmarks ────────────────────────────────────────────────────────────
  // Scheduled benchmarks live in benchmark_results (status='scheduled',
  // training_plan_id=null). We fetch any that fall within the plan's date
  // range and, for each, resolve nearest-first candidate activities within
  // ±48h so the row renderer can offer confirm/reject.
  const [benchmarkSchedule, setBenchmarkSchedule] = useState<Map<string, BenchmarkProtocol>>(new Map());
  const [confirmedDates, setConfirmedDates] = useState<Set<string>>(new Set());
  const [benchmarkCandidates, setBenchmarkCandidates] = useState<Map<string, CandidateActivity[]>>(new Map());
  const [benchmarkRefreshKey, setBenchmarkRefreshKey] = useState(0);

  useEffect(() => {
    if (!userId || !planStartDate || !planEndDate) {
      setBenchmarkSchedule(new Map());
      setConfirmedDates(new Set());
      setBenchmarkCandidates(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const toIsoLocal = (d: Date) => {
        const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const dd = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      };
      const fromIso = toIsoLocal(planStartDate);
      const toIso = toIsoLocal(planEndDate);
      const scheduled = await getScheduledBenchmarksInRange(userId, fromIso, toIso).catch(() => []);
      if (cancelled) return;
      const map = new Map<string, BenchmarkProtocol>();
      for (const s of scheduled) map.set(s.benchmark_date, s.benchmark_protocol);
      setBenchmarkSchedule(map);
      if (map.size === 0) { setConfirmedDates(new Set()); setBenchmarkCandidates(new Map()); return; }

      const dates = Array.from(map.keys());
      const minDate = dates.reduce((m, d) => (d < m ? d : m), dates[0]);
      const maxDate = dates.reduce((m, d) => (d > m ? d : m), dates[0]);
      const from = new Date(`${minDate}T12:00:00Z`); from.setUTCDate(from.getUTCDate() - 3);
      const to = new Date(`${maxDate}T12:00:00Z`); to.setUTCDate(to.getUTCDate() + 3);

      const [{ data: acts }, { data: rej }, { data: existing }] = await Promise.all([
        supabase.from("activities")
          .select("id, start_time, duration_seconds, distance_meters, avg_heart_rate, activity_type")
          .eq("user_id", userId)
          .gte("start_time", from.toISOString())
          .lte("start_time", to.toISOString()),
        supabase.from("benchmark_rejections" as any)
          .select("activity_id").eq("user_id", userId),
        supabase.from("benchmark_results" as any)
          .select("benchmark_date").eq("user_id", userId).eq("status", "confirmed").in("benchmark_date", dates),
      ]);
      if (cancelled) return;

      const rejectedIds = new Set<string>((rej ?? []).map((r: any) => r.activity_id));
      const confirmed = new Set<string>((existing ?? []).map((r: any) => r.benchmark_date));
      const perDate = new Map<string, CandidateActivity[]>();
      benchmarkSchedule.forEach((protocol, isoDate) => {
        if (confirmed.has(isoDate)) return;
        const list = findBenchmarkCandidates({
          activities: (acts ?? []) as ActivityForDetection[],
          scheduledDateIso: isoDate,
          protocol,
          rejectedIds,
        });
        perDate.set(isoDate, list);
      });
      setConfirmedDates(confirmed);
      setBenchmarkCandidates(perDate);
    })();
    return () => { cancelled = true; };
  }, [userId, benchmarkSchedule, benchmarkRefreshKey]);

  const refreshBenchmarks = useCallback(() => setBenchmarkRefreshKey((n) => n + 1), []);

  // Auto-open the review dialog when an activity has just been auto-linked
  // to a planned session (fired by the Strava import auto-linker).
  useEffect(() => {
    const onAutoLinked = (e: Event) => {
      const detail = (e as CustomEvent).detail as { date?: string } | undefined;
      if (!detail?.date) return;
      // Wait one tick so that fresh linkedActivities/completedDates props arrive
      setTimeout(() => {
        const w = workoutMap.get(detail.date!);
        if (w) setReviewWorkout(w);
      }, 50);
    };
    window.addEventListener("workout-auto-linked", onAutoLinked as EventListener);
    return () => window.removeEventListener("workout-auto-linked", onAutoLinked as EventListener);
    // workoutMap recreated each render; the listener captures the latest one via closure on next render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workouts]);

  const addCustomStep = (w: ParsedWorkout, step: CustomStep) => {
    const key = workoutKey(w);
    setCustomSteps((prev) => ({ ...prev, [key]: [...(prev[key] || []), step] }));
  };
  const removeCustomStep = (w: ParsedWorkout, id: string) => {
    const key = workoutKey(w);
    setCustomSteps((prev) => {
      const list = (prev[key] || []).filter((s) => s.id !== id);
      const next = { ...prev };
      if (list.length) next[key] = list; else delete next[key];
      return next;
    });
  };

  /** Clear ALL local edits (per-step overrides + user-added custom steps) for a workout. */
  const resetAllEditsForWorkout = (w: ParsedWorkout) => {
    const dateKey = workoutKey(w);
    const contentKey = workoutContentKey(w);
    setOverrides((prev) => {
      if (!prev[dateKey] && !prev[contentKey]) return prev;
      const next = { ...prev };
      delete next[dateKey];
      delete next[contentKey];
      return next;
    });
    setCustomSteps((prev) => {
      if (!prev[dateKey]) return prev;
      const next = { ...prev };
      delete next[dateKey];
      return next;
    });
  };

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

  const scrollToToday = () => {
    const key = format(new Date(), "yyyy-MM-dd");
    const el = document.querySelector(`[data-plan-date="${key}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      // Today might be outside plan window — scroll to nearest available date.
      const all = Array.from(document.querySelectorAll<HTMLElement>("[data-plan-date]"));
      const todayMs = new Date(key).getTime();
      let nearest: HTMLElement | null = null;
      let bestDiff = Infinity;
      for (const node of all) {
        const d = node.getAttribute("data-plan-date");
        if (!d) continue;
        const diff = Math.abs(new Date(d).getTime() - todayMs);
        if (diff < bestDiff) { bestDiff = diff; nearest = node; }
      }
      nearest?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="sticky top-0 z-10 flex justify-end px-3 py-2 bg-background/95 backdrop-blur border-b">
        <Button size="sm" variant="outline" className="h-8 gap-1" onClick={scrollToToday}>
          <CalendarDays className="w-4 h-4" />
          Today
        </Button>
      </div>
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
                const inPauseWindow = !!(pauseWindow &&
                  day.getTime() >= new Date(pauseWindow.start).setHours(0, 0, 0, 0) &&
                  day.getTime() < new Date(pauseWindow.end).setHours(0, 0, 0, 0));
                const pauseMeta = pauseReasonMeta(pauseReason);
                const benchmarkProtocol = benchmarkSchedule.get(key);
                const showBenchmark =
                  !!userId && !!benchmarkProtocol && !confirmedDates.has(key);
                const benchmarkList = benchmarkCandidates.get(key) ?? [];

                return (
                  <div key={key}>
                    {showBenchmark && (
                      <div className="px-3 pt-2.5 pb-1">
                        <BenchmarkConfirmCard
                          userId={userId!}
                          planId={planId}
                          scheduledDateIso={key}
                          protocol={benchmarkProtocol!}
                          candidates={benchmarkList}
                          onDone={refreshBenchmarks}
                        />
                      </div>
                    )}
                  <div
                    data-plan-date={key}
                    onDragOver={(e) => handleDragOver(e, key)}
                    onDragLeave={() => setDragOverDate((d) => (d === key ? null : d))}
                    onDrop={(e) => handleDrop(e, key)}
                    className={cn(
                      "flex items-stretch gap-3 px-3 py-2.5 transition-colors",
                      today && "bg-primary/5",
                      isDragOver && "bg-primary/10 ring-2 ring-primary/40 ring-inset",
                      isDragSource && "opacity-40",
                      dragSourceDate && dragSourceDate !== key && "cursor-pointer hover:bg-primary/10"
                    )}
                    onClick={() => {
                      if (dragSourceDate && dragSourceDate !== key && onMoveWorkout) {
                        const src = dragSourceDate;
                        setDragSourceDate(null);
                        setDragOverDate(null);
                        onMoveWorkout(src, key);
                      }
                    }}
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
                    {inPauseWindow ? (
                      <div
                        style={{ backgroundImage: `url(${pauseMeta.bg})` }}
                        className="relative flex-1 overflow-hidden rounded-lg border border-primary/30 bg-cover bg-center px-3 py-2.5"
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/60 to-background/20" />
                        <div className="relative flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-background/40 backdrop-blur-sm flex items-center justify-center shrink-0">
                            <img src={pauseMeta.icon} alt="" loading="lazy" width={28} height={28} className="w-7 h-7 drop-shadow" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground truncate drop-shadow">
                              {pauseMeta.label}
                            </p>
                            <p className="text-xs text-foreground/80 drop-shadow">Plan paused</p>
                          </div>
                        </div>
                      </div>

                    ) : workout ? (
                      isCompleted ? (
                        // PlanOverview-style "completed" card
                        <button
                          type="button"
                          onClick={(e) => {
                            if (dragSourceDate && dragSourceDate !== key && onMoveWorkout) {
                              e.stopPropagation();
                              const src = dragSourceDate;
                              setDragSourceDate(null);
                              setDragOverDate(null);
                              onMoveWorkout(src, key);
                              return;
                            }
                            setReviewWorkout(workout);
                          }}
                          className={cn(
                            "flex-1 flex items-center gap-3 text-left rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors px-3 py-2.5 group",
                            isDragSource && "ring-2 ring-primary"
                          )}
                        >
                          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-5 h-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-semibold truncate">{shortLabel(workout)}</p>
                              <span className="text-[10px] font-semibold text-primary bg-primary/15 px-1.5 py-0.5 rounded-full shrink-0">
                                Completed ✓
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">
                              {(() => {
                                const a = linkedActivities[key];
                                const parts: string[] = [];
                                if (a?.distance_meters) parts.push(`${(a.distance_meters / 1000).toFixed(1)} km`);
                                if (a?.duration_seconds) parts.push(`${Math.round(a.duration_seconds / 60)} min`);
                                parts.push("Tap for review");
                                return parts.join(" · ");
                              })()}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        </button>
                      ) : (
                      <button
                        type="button"
                        draggable={draggable}
                        onDragStart={(e) => handleDragStart(e, key)}
                        onDragEnd={() => { setDragOverDate(null); }}
                        onClick={(e) => {
                          if (dragSourceDate && dragSourceDate !== key && onMoveWorkout) {
                            e.stopPropagation();
                            const src = dragSourceDate;
                            setDragSourceDate(null);
                            setDragOverDate(null);
                            onMoveWorkout(src, key);
                            return;
                          }
                          setSelectedWorkout(workout);
                        }}
                        className={cn(
                          "flex-1 flex items-center gap-2 text-left rounded-lg border bg-card hover:bg-accent/40 transition-colors px-3 py-2 group",
                          isDragSource && "ring-2 ring-primary"
                        )}
                      >
                        {/* Coloured accent bar */}
                        <span className={cn("w-1 self-stretch rounded-full", workoutAccent(workout.title))} />
                        {draggable && (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label={isDragSource ? "Cancel move" : "Move workout — then tap a target day"}
                            title={isDragSource ? "Tap target day to move, or tap again to cancel" : "Move workout — then tap a target day"}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (dragSourceDate === key) {
                                setDragSourceDate(null);
                              } else {
                                setDragSourceDate(key);
                              }
                              setDragOverDate(null);
                            }}
                            className={cn(
                              "shrink-0 p-1 -m-1 rounded touch-manipulation",
                              isDragSource ? "text-primary" : "text-muted-foreground/50 hover:text-muted-foreground"
                            )}
                          >
                            <GripVertical className="w-3.5 h-3.5 cursor-grab active:cursor-grabbing" />
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold break-words">{shortLabel(workout)}</p>
                          {(() => {
                            const customs = customSteps[workoutKey(workout)] || [];
                            const isRace = /race\s*day|🏁/i.test(`${workout.title} ${workout.rawText}`);
                            const extraSecs = isRace ? 0 : customs.reduce((acc, s) => {
                              const m = s.duration.match(/^(\d{1,3}):(\d{2})$/);
                              if (m) return acc + parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
                              const min = s.duration.match(/(\d+(?:\.\d+)?)\s*min/i);
                              if (min) return acc + Math.round(parseFloat(min[1]) * 60);
                              return acc;
                            }, 0);
                            const dur = extractDuration(workout, extraSecs);
                            const dist = extractDistance(workout);
                            if (!dur && !dist) return null;
                            return (
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {[dur, dist].filter(Boolean).join(" • ")}
                              </p>
                            );
                          })()}
                        </div>
                        {onEditWorkout && (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Edit or replace this workout"
                            title="Edit / replace workout"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditWorkout(workout);
                            }}
                            className="shrink-0 w-7 h-7 rounded-full bg-muted hover:bg-accent flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </span>
                        )}
                        {onSyncWorkout && (
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Sync this workout to intervals.icu"
                            title="Sync this workout to intervals.icu"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (syncingDate) return;
                              setSyncingDate(key);
                              try { await onSyncWorkout(key); } finally { setSyncingDate(null); }
                            }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}
                            className="shrink-0 w-7 h-7 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary cursor-pointer transition-colors"
                          >
                            {syncingDate === key
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <RefreshCw className="w-3.5 h-3.5" />}
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </button>
                      )
                    ) : (
                      <div className={cn(
                        "flex-1 flex items-center rounded-lg border border-dashed bg-muted/20 px-3 py-2",
                        dragSourceDate && "border-primary/50 bg-primary/5"
                      )}>
                        <span className="text-sm text-muted-foreground/70">
                          {dragSourceDate && dragSourceDate !== key ? "Tap to move here" : "Rest"}
                        </span>
                      </div>
                    )}
                  </div>
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
                  <span className="flex-1 min-w-0">{shortLabel(selectedWorkout)}</span>
                  {onEditWorkout && (
                    <Button
                      size="sm" variant="outline" className="h-7 px-2 text-xs"
                      onClick={() => {
                        const w = selectedWorkout;
                        setSelectedWorkout(null);
                        onEditWorkout(w!);
                      }}
                    >
                      <Pencil className="w-3 h-3 mr-1" /> Edit / Replace
                    </Button>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {selectedWorkout.dateObj ? format(selectedWorkout.dateObj, "EEEE, d MMMM yyyy") : selectedWorkout.date}
                </DialogDescription>
              </DialogHeader>

              {selectedWorkout.segments.length > 0 ? (
                <>
                {(() => {
                  const fmtTime = (secs: number) => `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
                  const fmtPace = (p: string) => p.replace(/\/(km|mi)$/i, "");
                  const aiExpanded = expandWorkoutSteps(selectedWorkout.segments, selectedWorkout.title, selectedWorkout.rawText ?? "", { goalTime, raceDistance });
                  const myCustom = customSteps[workoutKey(selectedWorkout)] || [];
                  const customExpanded = customToExpanded(myCustom);
                  const combined = [...aiExpanded, ...customExpanded];
                  return (
                    <>
                    <div className="mt-2"><WorkoutIntervalChart segments={expandedToSegments(combined)} /></div></>
                  );
                })()}
                {(() => {
                  const fmtTime = (secs: number) => `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
                  const fmtPace = (p: string) => p.replace(/\/(km|mi)$/i, "");
                  const aiExpanded = expandWorkoutSteps(selectedWorkout.segments, selectedWorkout.title, selectedWorkout.rawText ?? "", { goalTime, raceDistance });
                  const myCustom = customSteps[workoutKey(selectedWorkout)] || [];
                  const customExpanded = customToExpanded(myCustom);
                  const combined = [...aiExpanded, ...customExpanded];
                  const dateKey = workoutKey(selectedWorkout);
                  const contentKey = workoutContentKey(selectedWorkout);
                  const hasOverrides = !!(overrides[contentKey] && Object.keys(overrides[contentKey]).length) || !!(overrides[dateKey] && Object.keys(overrides[dateKey]).length);
                  const hasCustom = !!(customSteps[dateKey] && customSteps[dateKey].length);
                  const hasAnyEdits = hasOverrides || hasCustom;
                  return (
                    <div className="relative mt-2 pl-2">
                      {hasAnyEdits && (
                        <div className="mb-3 -ml-2 flex items-center justify-between gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
                          <p className="text-xs text-foreground/80">
                            You've edited this workout locally. Intervals.icu will use these edits on next sync.
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs gap-1 shrink-0"
                            onClick={() => resetAllEditsForWorkout(selectedWorkout)}
                          >
                            <RefreshCw className="w-3 h-3" /> Reset all
                          </Button>
                        </div>
                      )}
                      {/* Vertical dotted spine */}
                      <div className="absolute left-[18px] top-3 bottom-3 border-l-2 border-dotted border-muted-foreground/30" />
                      <div className="space-y-3">

                        {combined.map((step, i) => {
                          const isWalk = step.intensity === "Recovery" || step.intensity === "Rest" || step.intensity === "Cooldown" || step.intensity === "Warmup";
                          const isWarmCool = isWalk;
                          const Icon = isWalk ? PersonStanding : Footprints;
                          const durStr = fmtTime(step.duration);
                          const paceStr = fmtPace(step.pace);
                          const customIdx = i - aiExpanded.length;
                          const isCustom = customIdx >= 0;
                          const customRef = isCustom ? myCustom[customIdx] : null;
                          return (
                            <div key={i} className="relative flex items-start gap-3">
                              <div className="relative z-10 shrink-0 w-9 h-9 rounded-full bg-background border-2 border-muted-foreground/30 flex items-center justify-center text-xs font-semibold text-muted-foreground">
                                {i + 1}
                              </div>
                              <div className="flex-1 min-w-0 space-y-1.5 pt-1">
                                <p className="text-sm font-semibold leading-none flex items-center gap-2">
                                  {step.label}
                                  {isCustom && (
                                    <span className="text-[10px] uppercase tracking-wide bg-primary/15 text-primary px-1.5 py-0.5 rounded">Custom</span>
                                  )}
                                </p>
                                <div className="flex items-stretch rounded-xl border bg-card overflow-hidden">
                                  <div className="flex items-center justify-center w-12 bg-primary/10 shrink-0">
                                    <Icon className="w-5 h-5 text-primary" />
                                  </div>
                                  <div className="flex-1 grid grid-cols-2 divide-x">
                                      <EditableStat
                                        value={isCustom ? durStr : (overrides[workoutContentKey(selectedWorkout)]?.[i]?.duration ?? durStr)}
                                      label="Time (mm:ss)"
                                      placeholder="mm:ss"
                                      onSave={(v) => isCustom && customRef
                                        ? setCustomSteps((prev) => {
                                            const key = workoutKey(selectedWorkout);
                                            const list = (prev[key] || []).map((s) => s.id === customRef.id ? { ...s, duration: v } : s);
                                            return { ...prev, [key]: list };
                                          })
                                        : setStepOverride(selectedWorkout, i, "duration", v)}
                                      isOverridden={isCustom ? false : !!overrides[workoutContentKey(selectedWorkout)]?.[i]?.duration}
                                    />
                                    {isWarmCool ? (
                                      <div className="px-3 py-2 text-center w-full flex flex-col items-center justify-center">
                                        <p className="text-base font-bold leading-tight text-muted-foreground">—</p>
                                        <p className="text-[10px] text-muted-foreground mt-0.5">No pace</p>
                                      </div>
                                    ) : (
                                      <EditableStat
                                        value={isCustom ? paceStr : (overrides[workoutContentKey(selectedWorkout)]?.[i]?.pace ?? paceStr)}
                                        label="Pace (min/km)"
                                        placeholder="m:ss"
                                        onSave={(v) => isCustom && customRef
                                          ? setCustomSteps((prev) => {
                                              const key = workoutKey(selectedWorkout);
                                              const list = (prev[key] || []).map((s) => s.id === customRef.id ? { ...s, pace: v } : s);
                                              return { ...prev, [key]: list };
                                            })
                                          : setStepOverride(selectedWorkout, i, "pace", v)}
                                        isOverridden={isCustom ? false : !!overrides[workoutContentKey(selectedWorkout)]?.[i]?.pace}
                                      />
                                    )}
                                  </div>
                                  {isCustom && customRef ? (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); removeCustomStep(selectedWorkout, customRef.id); }}
                                      title="Remove this custom step"
                                      className="flex items-center justify-center px-3 bg-destructive/10 hover:bg-destructive/20 transition-colors border-l text-destructive"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  ) : (() => {
                                    const ov = overrides[workoutContentKey(selectedWorkout)]?.[i];
                                    const isModified = !!(ov?.duration || ov?.pace);
                                    if (!isModified) return null;
                                    return (
                                      <button
                                        type="button"
                                        onClick={(e) => { e.stopPropagation(); resetStepOverride(selectedWorkout, i); }}
                                        title="Reset this step to the original value"
                                        className="flex items-center justify-center px-3 bg-primary/10 hover:bg-primary/20 transition-colors border-l text-primary"
                                      >
                                        <RefreshCw className="w-4 h-4" />
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className="mt-4 pl-12">
                        <AddStepForm onAdd={(s) => addCustomStep(selectedWorkout, s)} />
                      </div>
                    </div>
                  );
                })()}
                </>
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">
                  {selectedWorkout.rawText}
                </p>
              )}

              {/race\s*day|🏁/i.test(`${selectedWorkout.title} ${selectedWorkout.rawText}`) && (
                <RaceStrategyBlock raceDistance={raceDistance} workouts={workouts} />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Workout Review (for completed workouts) */}
      <WorkoutReviewDialog
        open={!!reviewWorkout}
        onOpenChange={(o) => { if (!o) setReviewWorkout(null); }}
        workout={reviewWorkout}
        activity={reviewWorkout ? linkedActivities[workoutKey(reviewWorkout)] || null : null}
        workoutDate={reviewWorkout?.dateObj || null}
        workoutTitle={reviewWorkout ? shortLabel(reviewWorkout) : "Workout"}
        canRequestCoach={
          !!reviewWorkout &&
          workoutKey(reviewWorkout) === (
            Array.from(completedDates || new Set<string>()).sort().slice(-1)[0] || ""
          )
        }
      />
    </Card>
  );
}
