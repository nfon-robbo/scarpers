import { useMemo, useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PlanRestartDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current plan start date, used as the preview baseline. */
  currentStart?: Date | null;
  currentRaceDate?: Date | null;
  trainingDays?: string[];
  onConfirm: (restartDate: Date) => Promise<void> | void;
}

const PlanRestartDialog = ({
  open,
  onOpenChange,
  currentStart,
  currentRaceDate,
  trainingDays = [],
  onConfirm,
}: PlanRestartDialogProps) => {
  const [restartDate, setRestartDate] = useState<Date | undefined>(undefined);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const preview = useMemo(() => {
    if (!restartDate || !currentStart || !currentRaceDate) return null;
    const delta = Math.round(
      (new Date(restartDate).setHours(0, 0, 0, 0) - new Date(currentStart).setHours(0, 0, 0, 0)) / 86_400_000,
    );
    const newRace = new Date(currentRaceDate);
    newRace.setDate(newRace.getDate() + delta);
    const weeks = Math.max(
      1,
      Math.round(
        (new Date(currentRaceDate).setHours(0, 0, 0, 0) - new Date(currentStart).setHours(0, 0, 0, 0)) /
          (7 * 86_400_000),
      ),
    );
    return { newRace, weeks, delta };
  }, [restartDate, currentStart, currentRaceDate]);

  const handleConfirm = async () => {
    if (!restartDate) return;
    setSaving(true);
    try {
      await onConfirm(restartDate);
      onOpenChange(false);
      setRestartDate(undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4" />
            Restart plan
          </DialogTitle>
          <DialogDescription>
            Every workout you already have is kept — the whole plan simply moves to your new start
            date, with the same number of weeks and the same training days.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Label>Restart the plan on</Label>
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn("w-full justify-start text-left font-normal", !restartDate && "text-muted-foreground")}
              >
                <CalendarIcon className="w-4 h-4 mr-2" />
                {restartDate ? format(restartDate, "EEEE d MMM yyyy") : "Pick a date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <CalendarComponent
                mode="single"
                selected={restartDate}
                onSelect={(d) => {
                  setRestartDate(d ?? undefined);
                  setCalendarOpen(false);
                }}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>

          {trainingDays.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Training days kept:
              {trainingDays.map((d) => (
                <Badge key={d} variant="secondary" className="text-[10px]">
                  {d}
                </Badge>
              ))}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Plan length</span>
                <span className="font-medium">{preview.weeks} weeks (unchanged)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">New race day</span>
                <span className="font-medium">{format(preview.newRace, "EEE d MMM yyyy")}</span>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!restartDate || saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Restart plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlanRestartDialog;
