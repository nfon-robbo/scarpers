import { useMemo } from "react";
import { Activity, Target, Calendar as CalendarIcon, Flag, Flame, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { computePlanStats } from "@/lib/plan-stats";

interface PlanStatsBarProps {
  planContent: string;
  linkedActivities: Record<string, any>;
  raceDateIso?: string | null;
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

function StatTile({ icon, label, value, sub }: StatTileProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-base sm:text-lg font-semibold tabular-nums leading-tight text-foreground">
        {value}
      </div>
      {sub && (
        <div className="text-[10px] text-muted-foreground tabular-nums truncate max-w-full">
          {sub}
        </div>
      )}
    </div>
  );
}

export function PlanStatsBar({ planContent, linkedActivities, raceDateIso }: PlanStatsBarProps) {
  const stats = useMemo(
    () => computePlanStats(planContent, linkedActivities, raceDateIso ?? null),
    [planContent, linkedActivities, raceDateIso],
  );

  // Empty state per spec: if no sessions completed yet, show prompt only.
  if (stats.completedToDate === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-3 text-center text-sm text-muted-foreground">
        Complete your first session to see your stats
      </div>
    );
  }

  const volumeValue = stats.hasKmTargets
    ? `${stats.actualKm} km`
    : stats.hasMinuteTargets
      ? `${stats.actualMinutes} min`
      : "—";
  const volumeSub = stats.hasKmTargets
    ? `of ${stats.plannedKm} planned`
    : stats.hasMinuteTargets
      ? `of ${stats.plannedMinutes} planned`
      : undefined;

  const daysToRaceLabel =
    stats.daysToRace == null
      ? "—"
      : stats.daysToRace < 0
        ? "Past"
        : `${stats.daysToRace}`;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <StatTile
          icon={<Target className="w-3 h-3" />}
          label="Adherence"
          value={`${stats.adherencePct}%`}
          sub={`${stats.completedToDate} of ${stats.scheduledToDate}`}
        />
        <StatTile
          icon={<Activity className="w-3 h-3" />}
          label="Volume"
          value={volumeValue}
          sub={volumeSub}
        />
        <StatTile
          icon={<CheckCircle2 className="w-3 h-3" />}
          label="Completed"
          value={`${stats.completedToDate}`}
          sub={`of ${stats.totalSessions} sessions`}
        />
        <StatTile
          icon={<CalendarIcon className="w-3 h-3" />}
          label="Remaining"
          value={`${stats.sessionsRemaining}`}
          sub="sessions left"
        />
        <StatTile
          icon={<Flag className="w-3 h-3" />}
          label="Days to race"
          value={daysToRaceLabel}
          sub={stats.daysToRace == null ? "no race set" : "days"}
        />
        <StatTile
          icon={<Flame className="w-3 h-3 text-orange-400" />}
          label="Streak"
          value={`${stats.currentStreak}`}
          sub={stats.currentStreak === 1 ? "session" : "sessions"}
        />
      </div>
      <Progress value={stats.adherencePct} className="h-1.5" />
    </div>
  );
}
