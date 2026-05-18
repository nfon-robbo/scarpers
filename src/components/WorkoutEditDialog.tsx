import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Pencil, Plus, Trash2, ChevronLeft } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ParsedWorkout } from "@/lib/plan-export";
import type {
  ReplacementTemplate, TemplateOpts, EditedWorkout, EditedSegment,
} from "@/lib/plan-day-actions";

export type EditWorkoutChange =
  | { kind: "skip" }
  | { kind: "move"; isoTarget: string }
  | { kind: "replace_recovery" }
  | { kind: "replace_template"; template: ReplacementTemplate; opts: TemplateOpts }
  | { kind: "edit"; edited: EditedWorkout };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workout: ParsedWorkout | null;
  onApply: (change: EditWorkoutChange) => Promise<void> | void;
}

type Mode = "menu" | "move" | "alt" | "edit";

const TEMPLATES: { value: ReplacementTemplate; label: string }[] = [
  { value: "easy_run", label: "Easy Run" },
  { value: "tempo", label: "Tempo Run" },
  { value: "race_pace", label: "Race Pace Dress Rehearsal" },
  { value: "intervals", label: "Interval Session" },
  { value: "long_run", label: "Long Run" },
  { value: "recovery_walk", label: "Recovery Walk" },
  { value: "rest", label: "Rest Day" },
];

const DEFAULT_OPTS: Record<ReplacementTemplate, TemplateOpts> = {
  easy_run: { durationMin: 40 },
  tempo: { durationMin: 35, pace: "5:30/km" },
  race_pace: { durationMin: 30, pace: "5:00/km" },
  intervals: { reps: 6, repWorkSec: 60, repRestSec: 90 },
  long_run: { durationMin: 75 },
  recovery_walk: {},
  rest: {},
};

export default function WorkoutEditDialog({ open, onOpenChange, workout, onApply }: Props) {
  const [mode, setMode] = useState<Mode>("menu");
  const [busy, setBusy] = useState(false);

  // Move state
  const [moveDate, setMoveDate] = useState<Date | undefined>();

  // Template state
  const [tmpl, setTmpl] = useState<ReplacementTemplate>("easy_run");
  const [opts, setOpts] = useState<TemplateOpts>(DEFAULT_OPTS.easy_run);

  // Edit state
  const [editTitle, setEditTitle] = useState("");
  const [editSegments, setEditSegments] = useState<EditedSegment[]>([]);
  const [editTotal, setEditTotal] = useState<string>("");
  const [editNotes, setEditNotes] = useState("");
  const [editBpm, setEditBpm] = useState("");

  useEffect(() => {
    if (!open) {
      setMode("menu");
      setBusy(false);
      return;
    }
    if (workout) {
      setEditTitle(workout.title.replace(/\s*\(Total:.*?\)/i, "").trim());
      setEditSegments(
        workout.segments.length
          ? workout.segments.map((s) => ({ ...s }))
          : [{ segment: "Run", duration: "30 min", target: "Easy", hrZone: "Z2", notes: "" }],
      );
      const tm = workout.title.match(/Total:\s*~?(\d+)\s*min/i);
      setEditTotal(tm ? tm[1] : "");
      setEditNotes("");
      setEditBpm("");
      setMoveDate(workout.dateObj ?? undefined);
    }
  }, [open, workout]);

  const dateUk = useMemo(() => {
    if (!workout?.dateObj) return workout?.date ?? "";
    const d = workout.dateObj;
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }, [workout]);

  if (!workout) return null;

  const wrap = async (fn: () => Promise<void> | void) => {
    setBusy(true);
    try {
      await fn();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  const applyTemplateChange = (template: ReplacementTemplate) => {
    setTmpl(template);
    setOpts(DEFAULT_OPTS[template]);
    setMode("alt");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode !== "menu" && (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setMode("menu")}
                aria-label="Back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <Pencil className="w-4 h-4 text-primary" />
            Edit / Replace Workout
          </DialogTitle>
          <DialogDescription>
            {workout.dateObj ? format(workout.dateObj, "EEEE, d MMMM yyyy") : dateUk} — {workout.title}
          </DialogDescription>
        </DialogHeader>

        {mode === "menu" && (
          <div className="space-y-2">
            <Button
              variant="outline" className="w-full justify-start"
              disabled={busy}
              onClick={() => wrap(() => onApply({ kind: "skip" }))}
            >
              Skip this session
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => setMode("move")}>
              Move to…
            </Button>
            <Button
              variant="outline" className="w-full justify-start"
              disabled={busy}
              onClick={() => wrap(() => onApply({ kind: "replace_recovery" }))}
            >
              Replace with recovery walk
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => setMode("alt")}>
              Replace with alternative workout…
            </Button>
            <Button variant="outline" className="w-full justify-start" onClick={() => setMode("edit")}>
              Edit workout details…
            </Button>
          </div>
        )}

        {mode === "move" && (
          <div className="space-y-3">
            <Label>Pick a new date for this session</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                  <CalendarIcon className="w-4 h-4 mr-2" />
                  {moveDate ? format(moveDate, "EEEE d MMMM yyyy") : "Pick a date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={moveDate}
                  onSelect={(d) => d && setMoveDate(d)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setMode("menu")}>Cancel</Button>
              <Button
                disabled={!moveDate || busy}
                onClick={() => {
                  if (!moveDate) return;
                  const iso = `${moveDate.getFullYear()}-${String(moveDate.getMonth() + 1).padStart(2, "0")}-${String(moveDate.getDate()).padStart(2, "0")}`;
                  wrap(() => onApply({ kind: "move", isoTarget: iso }));
                }}
              >
                Move session
              </Button>
            </div>
          </div>
        )}

        {mode === "alt" && (
          <div className="space-y-3">
            <div>
              <Label>Alternative workout</Label>
              <Select
                value={tmpl}
                onValueChange={(v) => {
                  const t = v as ReplacementTemplate;
                  setTmpl(t);
                  setOpts(DEFAULT_OPTS[t]);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(tmpl === "easy_run" || tmpl === "tempo" || tmpl === "race_pace" || tmpl === "long_run") && (
              <div>
                <Label>Duration (minutes)</Label>
                <Input
                  type="number" min={10} max={300}
                  value={opts.durationMin ?? ""}
                  onChange={(e) => setOpts({ ...opts, durationMin: Number(e.target.value) || 0 })}
                />
              </div>
            )}
            {(tmpl === "tempo" || tmpl === "race_pace") && (
              <div>
                <Label>Pace target</Label>
                <Input
                  placeholder="5:30/km"
                  value={opts.pace ?? ""}
                  onChange={(e) => setOpts({ ...opts, pace: e.target.value })}
                />
              </div>
            )}
            {tmpl === "intervals" && (
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label>Reps</Label>
                  <Input
                    type="number" min={1} max={30}
                    value={opts.reps ?? 6}
                    onChange={(e) => setOpts({ ...opts, reps: Number(e.target.value) || 1 })}
                  />
                </div>
                <div>
                  <Label>Work (sec)</Label>
                  <Input
                    type="number" min={10} max={1800}
                    value={opts.repWorkSec ?? 60}
                    onChange={(e) => setOpts({ ...opts, repWorkSec: Number(e.target.value) || 30 })}
                  />
                </div>
                <div>
                  <Label>Rest (sec)</Label>
                  <Input
                    type="number" min={10} max={1800}
                    value={opts.repRestSec ?? 90}
                    onChange={(e) => setOpts({ ...opts, repRestSec: Number(e.target.value) || 30 })}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setMode("menu")}>Cancel</Button>
              <Button
                disabled={busy}
                onClick={() => wrap(() => onApply({ kind: "replace_template", template: tmpl, opts }))}
              >
                Replace session
              </Button>
            </div>
          </div>
        )}

        {mode === "edit" && (
          <div className="space-y-3">
            <div>
              <Label>Workout name</Label>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Total minutes</Label>
                <Input
                  type="number" min={0}
                  value={editTotal}
                  onChange={(e) => setEditTotal(e.target.value)}
                />
              </div>
              <div>
                <Label>Music BPM</Label>
                <Input
                  placeholder="170 BPM"
                  value={editBpm}
                  onChange={(e) => setEditBpm(e.target.value)}
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label>Segments</Label>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => setEditSegments((s) => [...s, { segment: "Run", duration: "10 min", target: "Easy", hrZone: "Z2", notes: "" }])}
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {editSegments.map((seg, i) => (
                  <div key={i} className="rounded-md border p-2 space-y-1">
                    <div className="grid grid-cols-2 gap-1">
                      <Input
                        placeholder="Segment"
                        value={seg.segment}
                        onChange={(e) => setEditSegments((arr) => arr.map((x, j) => j === i ? { ...x, segment: e.target.value } : x))}
                      />
                      <Input
                        placeholder="Duration"
                        value={seg.duration}
                        onChange={(e) => setEditSegments((arr) => arr.map((x, j) => j === i ? { ...x, duration: e.target.value } : x))}
                      />
                      <Input
                        placeholder="Pace target"
                        value={seg.target}
                        onChange={(e) => setEditSegments((arr) => arr.map((x, j) => j === i ? { ...x, target: e.target.value } : x))}
                      />
                      <Input
                        placeholder="HR Zone"
                        value={seg.hrZone}
                        onChange={(e) => setEditSegments((arr) => arr.map((x, j) => j === i ? { ...x, hrZone: e.target.value } : x))}
                      />
                    </div>
                    <div className="flex gap-1">
                      <Input
                        placeholder="Notes / cues"
                        value={seg.notes ?? ""}
                        onChange={(e) => setEditSegments((arr) => arr.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))}
                      />
                      <Button
                        size="icon" variant="ghost"
                        onClick={() => setEditSegments((arr) => arr.filter((_, j) => j !== i))}
                        aria-label="Remove segment"
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label>Coaching notes (optional)</Label>
              <Textarea
                rows={3}
                placeholder="Add cues, reasoning, things to focus on…"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setMode("menu")}>Cancel</Button>
              <Button
                disabled={busy || !editTitle.trim()}
                onClick={() => wrap(() => onApply({
                  kind: "edit",
                  edited: {
                    title: editTitle.trim(),
                    segments: editSegments.filter((s) => s.segment.trim() && s.duration.trim()),
                    totalMin: editTotal ? Number(editTotal) : undefined,
                    coachingNotes: editNotes.trim() || undefined,
                    musicBpm: editBpm.trim() || undefined,
                  },
                }))}
              >
                Save changes
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
