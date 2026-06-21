import { format } from "date-fns";
import { Pause, Play, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PlanPausedBannerProps {
  pausedUntil: Date;
  reason?: string | null;
  raceDateMode?: "fixed" | "shift" | null;
  raceDate?: Date | null;
  onResume?: () => void;
  compact?: boolean;
}

export default function PlanPausedBanner({
  pausedUntil,
  reason,
  raceDateMode,
  raceDate,
  onResume,
  compact,
}: PlanPausedBannerProps) {
  return (
    <div className="rounded-lg border border-amber-400/50 bg-amber-500/10 p-4 flex items-start gap-3 text-amber-950 dark:text-amber-100">
      <div className="shrink-0 mt-0.5">
        <Pause className="w-5 h-5 text-amber-600 dark:text-amber-300" />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-amber-950 dark:text-amber-50">
            Plan paused until {format(pausedUntil, "dd MMM yyyy")}
          </p>
          {reason && (
            <Badge variant="outline" className="border-amber-500/50 text-amber-900 dark:border-amber-300/40 dark:text-amber-100 capitalize">
              {reason}
            </Badge>
          )}
        </div>
        {!compact && raceDate && (
          <p className="text-xs text-amber-900/90 dark:text-amber-100/80 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Race date:{" "}
            {raceDateMode === "fixed"
              ? `fixed at ${format(raceDate, "dd MMM yyyy")} — plan will compress on resume`
              : `will shift to keep your full plan intact`}
          </p>
        )}
        {!compact && (
          <p className="text-xs text-amber-900/80 dark:text-amber-100/70">
            Workouts during this window aren&apos;t counted as missed. You can still log activities.
          </p>
        )}
      </div>
      {onResume && (
        <Button size="sm" onClick={onResume} className="shrink-0 bg-amber-400 text-amber-950 hover:bg-amber-300">
          <Play className="w-3.5 h-3.5 mr-1" />
          Resume
        </Button>
      )}
    </div>
  );
}
