import { useEffect, useMemo, useState } from "react";
import { addDays, differenceInCalendarDays, format } from "date-fns";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CalendarIcon } from "lucide-react";
import pauseHolidayIcon from "@/assets/pause-holiday.png";
import pauseIllnessIcon from "@/assets/pause-illness.png";
import pauseInjuryIcon from "@/assets/pause-injury.png";
import pauseOtherIcon from "@/assets/pause-other.png";

export type ResumeMode = "cancel" | "skip-next-week" | "continue-paused-week";
export type RaceDateMode = "fixed" | "shift";
export type PauseReason = "holiday" | "illness" | "injury" | "other";


interface PlanPauseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "pause" | "resume";

  /** Current race date (for previews). */
  raceDate?: Date | null;

  /** Existing pause state — required for resume mode. */
  pausedAt?: Date | null;
  pausedUntil?: Date | null;
  raceDateMode?: RaceDateMode | null;

  onConfirmPause?: (params: {
    pausedAt: Date;
    pausedUntil: Date;
    reason: PauseReason;
    raceDateMode: RaceDateMode;
  }) => Promise<void> | void;

  onConfirmResume?: (params: {
    resumeMode: ResumeMode;
    deltaDays: number;
  }) => Promise<void> | void;
}

const REASONS: { value: PauseReason; label: string; icon: string }[] = [
  { value: "holiday", label: "Holiday", icon: pauseHolidayIcon },
  { value: "illness", label: "Illness", icon: pauseIllnessIcon },
  { value: "injury", label: "Injury", icon: pauseInjuryIcon },
  { value: "other", label: "Other", icon: pauseOtherIcon },
];


export default function PlanPauseDialog({
  open,
  onOpenChange,
  mode,
  raceDate,
  pausedAt,
  pausedUntil,
  raceDateMode: existingRaceDateMode,
  onConfirmPause,
  onConfirmResume,
}: PlanPauseDialogProps) {
  // ---------- Pause state ----------
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const [startDate, setStartDate] = useState<Date>(today);
  const [endDate, setEndDate] = useState<Date>(addDays(today, 7));
  const [reason, setReason] = useState<PauseReason>("holiday");
  const [raceDateMode, setRaceDateMode] = useState<RaceDateMode>("fixed");
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  // ---------- Resume state ----------
  const [resumeMode, setResumeMode] = useState<ResumeMode>("skip-next-week");
  const [submitting, setSubmitting] = useState(false);

  // Reset state when re-opened
  useEffect(() => {
    if (open && mode === "pause") {
      setStartDate(today);
      setEndDate(addDays(today, 7));
      setReason("holiday");
      setRaceDateMode("fixed");
    }
    if (open && mode === "resume") {
      // Default to "cancel" if we're still inside the pause window — typical case
      // for "holiday cancelled / feeling better" early resume.
      const todayMs = today.getTime();
      const inWindow = pausedAt && pausedUntil &&
        todayMs >= new Date(pausedAt).setHours(0, 0, 0, 0) &&
        todayMs <= new Date(pausedUntil).setHours(23, 59, 59, 999);
      setResumeMode(inWindow ? "cancel" : "skip-next-week");
    }
  }, [open, mode, today]);

  // ----- Previews -----
  const pauseDays = useMemo(() => {
    return Math.max(1, differenceInCalendarDays(endDate, startDate));
  }, [startDate, endDate]);

  const shiftedRaceDate = useMemo(() => {
    if (!raceDate) return null;
    return addDays(raceDate, pauseDays);
  }, [raceDate, pauseDays]);

  // ----- Resume previews -----
  const resumePauseDays = useMemo(() => {
    if (!pausedAt || !pausedUntil) return 0;
    return Math.max(1, differenceInCalendarDays(pausedUntil, pausedAt));
  }, [pausedAt, pausedUntil]);

  const resumeDelta = useMemo(() => {
    // How many days to shift workouts forward.
    if (!pausedAt || !pausedUntil) return 0;
    if (resumeMode === "cancel") return 0; // restore original plan as-is
    const todayMs = today.getTime();
    const untilMs = new Date(pausedUntil).setHours(0, 0, 0, 0);
    const baseShift = Math.max(0, differenceInCalendarDays(new Date(Math.max(todayMs, untilMs)), pausedAt));
    if (resumeMode === "skip-next-week") {
      // Land next session on the Monday after paused_until (or today if later)
      const target = new Date(Math.max(todayMs, untilMs));
      const day = target.getDay(); // 0=Sun..6=Sat
      const daysToMonday = day === 1 ? 0 : (8 - day) % 7 || 7;
      return baseShift + daysToMonday;
    }
    return baseShift; // continue-paused-week
  }, [pausedAt, pausedUntil, today, resumeMode]);

  const newRaceAfterResume = useMemo(() => {
    if (!raceDate) return null;
    if (resumeMode === "cancel") return raceDate;
    if (existingRaceDateMode === "fixed") return raceDate; // unchanged
    return addDays(raceDate, resumeDelta);
  }, [raceDate, resumeDelta, existingRaceDateMode, resumeMode]);

  // ---------- Handlers ----------
  const handlePause = async () => {
    if (!onConfirmPause) return;
    setSubmitting(true);
    try {
      await onConfirmPause({ pausedAt: startDate, pausedUntil: endDate, reason, raceDateMode });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResume = async () => {
    if (!onConfirmResume) return;
    setSubmitting(true);
    try {
      await onConfirmResume({ resumeMode, deltaDays: resumeDelta });
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  // ---------- Render ----------
  if (mode === "pause") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="w-4 h-4" /> Pause training plan
            </DialogTitle>
            <DialogDescription>
              Take a break for a holiday, illness, or injury. No missed-workout markers during this window.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Start</Label>
                <Popover open={startOpen} onOpenChange={setStartOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start font-normal">
                      <CalendarIcon className="w-3.5 h-3.5 mr-2" />
                      {format(startDate, "dd MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={startDate}
                      onSelect={(d) => {
                        if (d) {
                          setStartDate(d);
                          if (endDate <= d) setEndDate(addDays(d, 7));
                          setStartOpen(false);
                        }
                      }}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">End</Label>
                <Popover open={endOpen} onOpenChange={setEndOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full justify-start font-normal">
                      <CalendarIcon className="w-3.5 h-3.5 mr-2" />
                      {format(endDate, "dd MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={endDate}
                      onSelect={(d) => {
                        if (d) {
                          setEndDate(d);
                          setEndOpen(false);
                        }
                      }}
                      disabled={(d) => d <= startDate}
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Reason</Label>
              <div className="flex flex-wrap gap-2">
                {REASONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setReason(r.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full text-xs border transition-colors",
                      reason === r.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted text-muted-foreground hover:bg-muted/80"
                    )}
                  >
                    <img src={r.icon} alt="" loading="lazy" width={20} height={20} className="w-5 h-5" />
                    {r.label}
                  </button>
                ))}

              </div>
            </div>

            {/* Race date mode */}
            {raceDate && (
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Race date</Label>
                <RadioGroup value={raceDateMode} onValueChange={(v) => setRaceDateMode(v as RaceDateMode)}>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value="fixed" id="mode-fixed" className="mt-0.5" />
                    <label htmlFor="mode-fixed" className="text-sm flex-1 cursor-pointer">
                      <p className="font-medium">Keep race date fixed</p>
                      <p className="text-xs text-muted-foreground">
                        Race stays {format(raceDate, "dd MMM yyyy")}. Plan compresses on resume; some workouts may be trimmed.
                      </p>
                    </label>
                  </div>
                  <div className="flex items-start gap-3 rounded-md border p-3">
                    <RadioGroupItem value="shift" id="mode-shift" className="mt-0.5" />
                    <label htmlFor="mode-shift" className="text-sm flex-1 cursor-pointer">
                      <p className="font-medium">Shift race date forward</p>
                      <p className="text-xs text-muted-foreground">
                        Race moves to {shiftedRaceDate ? format(shiftedRaceDate, "dd MMM yyyy") : "—"} (+{pauseDays} days). Full plan preserved.
                      </p>
                    </label>
                  </div>
                </RadioGroup>
              </div>
            )}

            {/* Preview */}
            <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
              <p className="font-medium text-foreground">Preview</p>
              <p className="text-muted-foreground">
                Paused {format(startDate, "dd MMM")} → {format(endDate, "dd MMM yyyy")} · {pauseDays} day{pauseDays === 1 ? "" : "s"}
              </p>
              {raceDate && (
                <p className="text-muted-foreground">
                  {raceDateMode === "fixed"
                    ? `Race day stays ${format(raceDate, "dd MMM yyyy")}.`
                    : `Race day moves ${format(raceDate, "dd MMM")} → ${shiftedRaceDate ? format(shiftedRaceDate, "dd MMM yyyy") : "—"}.`}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handlePause} disabled={submitting || endDate <= startDate}>
              {submitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
              Pause plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  // ---------- Resume ----------
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Play className="w-4 h-4" /> Resume training
          </DialogTitle>
          <DialogDescription>
            {pausedAt && pausedUntil ? (
              <>
                Pause: {format(pausedAt, "dd MMM")} → {format(pausedUntil, "dd MMM yyyy")} ({resumePauseDays} day{resumePauseDays === 1 ? "" : "s"})
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {existingRaceDateMode === "fixed" && (
            <Badge variant="outline" className="border-amber-400/40 text-amber-200">
              Race date locked at {raceDate ? format(raceDate, "dd MMM yyyy") : "—"}
            </Badge>
          )}

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Resume strategy</Label>
            <RadioGroup value={resumeMode} onValueChange={(v) => setResumeMode(v as ResumeMode)}>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="cancel" id="resume-cancel" className="mt-0.5" />
                <label htmlFor="resume-cancel" className="text-sm flex-1 cursor-pointer">
                  <p className="font-medium">Cancel pause — restore original plan</p>
                  <p className="text-xs text-muted-foreground">
                    Original workouts reappear exactly as planned. No dates shift, race day unchanged.
                  </p>
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="skip-next-week" id="resume-skip" className="mt-0.5" />
                <label htmlFor="resume-skip" className="text-sm flex-1 cursor-pointer">
                  <p className="font-medium">Skip to next week</p>
                  <p className="text-xs text-muted-foreground">
                    Future workouts land on the Monday after your pause window.
                  </p>
                </label>
              </div>
              <div className="flex items-start gap-3 rounded-md border p-3">
                <RadioGroupItem value="continue-paused-week" id="resume-continue" className="mt-0.5" />
                <label htmlFor="resume-continue" className="text-sm flex-1 cursor-pointer">
                  <p className="font-medium">Continue from paused week</p>
                  <p className="text-xs text-muted-foreground">
                    Pick up exactly where you left off; workouts shift forward by the pause length.
                  </p>
                </label>
              </div>
            </RadioGroup>
          </div>

          {/* Preview */}
          <div className="rounded-md bg-muted/50 p-3 text-xs space-y-1">
            <p className="font-medium text-foreground">Preview</p>
            {resumeMode === "cancel" ? (
              <p className="text-muted-foreground">
                Pause cancelled. Original plan restored — all workouts resume as scheduled.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">Workouts shift forward by {resumeDelta} day{resumeDelta === 1 ? "" : "s"}.</p>
                {raceDate && existingRaceDateMode === "fixed" && (
                  <p className="text-muted-foreground">
                    Race day stays {format(raceDate, "dd MMM yyyy")}. Workouts that no longer fit will be trimmed.
                  </p>
                )}
                {raceDate && existingRaceDateMode !== "fixed" && newRaceAfterResume && (
                  <p className="text-muted-foreground">
                    Race day moves {format(raceDate, "dd MMM")} → {format(newRaceAfterResume, "dd MMM yyyy")}.
                  </p>
                )}
                <p className="text-muted-foreground/80 text-[11px] pt-1">
                  Tip: re-sync your watch / Intervals.icu after resuming.
                </p>
              </>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleResume} disabled={submitting}>
            {submitting && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
            Resume training
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
