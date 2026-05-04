import { useMemo, useState } from "react";
import { format, differenceInDays, startOfWeek, isToday, isBefore, differenceInWeeks } from "date-fns";
import { Card } from "@/components/ui/card";
import { ParsedWorkout } from "@/lib/plan-export";
import { cn } from "@/lib/utils";
import { ChevronRight, Calendar, Trophy, CheckCircle2, Loader2, Activity, Clock, Heart, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { streamAICoach } from "@/lib/ai-stream";
import MarkdownRenderer from "@/components/MarkdownRenderer";

interface PlanOverviewProps {
  workouts: ParsedWorkout[];
  planStartDate: Date;
  raceDistance: string;
  raceDate?: Date;
  completedDates?: Set<string>;
  linkedActivities?: Record<string, any>;
  headerAction?: React.ReactNode;
}

/** Circular progress gauge (SVG) */
function CircularGauge({
  value,
  max,
  label,
  sublabel,
  color = "hsl(var(--primary))",
  size = 100,
}: {
  value: number;
  max: number;
  label: string;
  sublabel: string;
  color?: string;
  size?: number;
}) {
  const strokeWidth = 8;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct);

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-lg font-bold" style={{ color }}>{label}</span>
      </div>
      <p className="text-[11px] text-muted-foreground font-medium text-center leading-tight mt-1">{sublabel}</p>
    </div>
  );
}

const DISTANCE_LABELS: Record<string, string> = {
  "5k": "5 KM",
  "10k": "10 KM",
  "half-marathon": "Half Marathon",
  "marathon": "Marathon",
};

export default function PlanOverview({
  workouts,
  planStartDate,
  raceDistance,
  raceDate,
  completedDates = new Set(),
  linkedActivities = {},
}: PlanOverviewProps) {
  const today = new Date();
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [reviewContent, setReviewContent] = useState<string>("");
  const [reviewLoading, setReviewLoading] = useState(false);

  // Plan date boundaries
  const planDates = useMemo(() => {
    const dates = workouts.filter(w => w.dateObj).map(w => w.dateObj!.getTime());
    if (dates.length === 0) return null;
    return {
      start: new Date(Math.min(...dates)),
      end: new Date(Math.max(...dates)),
    };
  }, [workouts]);

  // Total weeks in plan
  const totalWeeks = useMemo(() => {
    if (!planDates) return 0;
    return Math.max(1, differenceInWeeks(planDates.end, planDates.start) + 1);
  }, [planDates]);

  // Current week number (1-based)
  const currentWeek = useMemo(() => {
    if (!planDates) return 1;
    const weekNum = differenceInWeeks(today, planDates.start) + 1;
    return Math.max(1, Math.min(weekNum, totalWeeks));
  }, [planDates, today, totalWeeks]);

  // Days until race/plan end
  const daysRemaining = useMemo(() => {
    const endDate = raceDate || planDates?.end;
    if (!endDate) return null;
    const diff = differenceInDays(endDate, today);
    return Math.max(0, diff);
  }, [raceDate, planDates, today]);

  // Workout-level stats
  const stats = useMemo(() => {
    const total = workouts.filter(w => w.dateObj && !/rest/i.test(w.title)).length;
    const pastWorkouts = workouts.filter(w => w.dateObj && (isBefore(w.dateObj, today) || isToday(w.dateObj)) && !/rest/i.test(w.title));
    const completed = pastWorkouts.filter(w => completedDates.has(format(w.dateObj!, "yyyy-MM-dd"))).length;
    const skipped = pastWorkouts.length - completed;
    const remaining = total - pastWorkouts.length;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, skipped, remaining, completionRate };
  }, [workouts, completedDates, today]);

  // Current week's workouts for the mini-calendar
  const currentWeekWorkouts = useMemo(() => {
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
    return days.map(d => {
      const key = format(d, "yyyy-MM-dd");
      const workout = workouts.find(w => w.dateObj && format(w.dateObj, "yyyy-MM-dd") === key);
      const hasWorkout = workout && !/rest/i.test(workout.title);
      const isComplete = completedDates.has(key);
      return { date: d, workout, hasWorkout, isComplete, key };
    });
  }, [workouts, completedDates, today]);

  // Today's workout
  const todayWorkout = useMemo(() => {
    const todayKey = format(today, "yyyy-MM-dd");
    return workouts.find(w => w.dateObj && format(w.dateObj, "yyyy-MM-dd") === todayKey);
  }, [workouts, today]);

  // Week phase label
  const weekPhaseLabel = useMemo(() => {
    if (currentWeek <= 1) return "Getting Started";
    if (totalWeeks > 0 && currentWeek === totalWeeks) return "Race Week";
    if (totalWeeks > 0 && currentWeek >= totalWeeks - 1) return "Tapering";
    if (currentWeek % 4 === 0) return "Recovery";
    return "Building";
  }, [currentWeek, totalWeeks]);

  const weekProgressPct = totalWeeks > 0 ? (currentWeek / totalWeeks) * 100 : 0;

  const todayKey = format(today, "yyyy-MM-dd");
  const todayIsCompleted = completedDates.has(todayKey);
  const todayActivity = linkedActivities[todayKey];

  const openWorkoutReview = async () => {
    if (!todayWorkout || !todayActivity) return;
    setReviewDialogOpen(true);
    setReviewContent("");
    setReviewLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setReviewLoading(false); return; }

    // Build activity summary
    const distKm = todayActivity.distance_meters ? (todayActivity.distance_meters / 1000).toFixed(2) : "N/A";
    const durMin = todayActivity.duration_seconds ? Math.round(todayActivity.duration_seconds / 60) : "N/A";
    const avgHr = todayActivity.avg_heart_rate || "N/A";
    const maxHr = todayActivity.max_heart_rate || "N/A";
    const avgCad = todayActivity.avg_cadence || "N/A";
    const cals = todayActivity.calories || "N/A";
    const activitySummary = `Distance: ${distKm} km\nDuration: ${durMin} min\nAvg HR: ${avgHr} bpm\nMax HR: ${maxHr} bpm\nAvg Cadence: ${avgCad} spm\nCalories: ${cals}`;

    // Build planned workout summary
    let plannedWorkout = todayWorkout.title + "\n";
    if (todayWorkout.segments.length > 0) {
      for (const s of todayWorkout.segments) {
        plannedWorkout += `${s.segment}: ${s.duration} | Target: ${s.target} | ${s.hrZone} | ${s.notes || ""}\n`;
      }
    }

    let accumulated = "";
    streamAICoach({
      type: "workout-review",
      token: session.access_token,
      activitySummary,
      plannedWorkout,
      onDelta: (text) => { accumulated += text; setReviewContent(accumulated); },
      onDone: () => { setReviewLoading(false); },
      onError: () => { setReviewLoading(false); setReviewContent("Unable to generate review. Please try again."); },
    });
  };

  if (!planDates) return null;

  return (
    <div className="space-y-4">
      {/* Plan Header */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-br from-primary to-accent p-5 text-primary-foreground">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight">
                {DISTANCE_LABELS[raceDistance] || raceDistance}
              </h2>
              <div className="flex items-center gap-2 text-sm opacity-90">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  {format(planDates.start, "d MMM")} – {format(planDates.end, "d MMM yyyy")}
                </span>
              </div>
              {daysRemaining !== null && (
                <p className="text-sm font-medium mt-1">
                  <Trophy className="w-3.5 h-3.5 inline mr-1" />
                  {daysRemaining === 0
                    ? "Race Day! 🎉"
                    : `${Math.floor(daysRemaining / 7)} week(s) and ${daysRemaining % 7} day(s) to go`}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Gauges */}
        <div className="grid grid-cols-2 gap-4 p-5">
          <div className="flex justify-center relative">
            <CircularGauge
              value={stats.completionRate}
              max={100}
              label={`${stats.completionRate}%`}
              sublabel="Plan Completion Rate"
              color="hsl(var(--primary))"
              size={96}
            />
          </div>
          <div className="flex justify-center relative">
            <CircularGauge
              value={currentWeek}
              max={totalWeeks}
              label={`${currentWeek}/${totalWeeks}`}
              sublabel="Week Progress"
              color="hsl(var(--accent))"
              size={96}
            />
          </div>
        </div>
      </Card>

      {/* Week Progress Card */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Week {currentWeek}/{totalWeeks}</p>
            <p className="text-xs text-muted-foreground">{weekPhaseLabel}</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="relative h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${weekProgressPct}%` }}
          />
          {/* Triangle marker */}
          <div
            className="absolute -top-1.5 w-0 h-0 transition-all duration-500"
            style={{
              left: `calc(${weekProgressPct}% - 5px)`,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "6px solid hsl(var(--primary))",
            }}
          />
        </div>

        {/* Mini week calendar */}
        <div className="grid grid-cols-7 gap-1 text-center pt-1">
          {currentWeekWorkouts.map(({ date, hasWorkout, isComplete, key }) => {
            const dayIsToday = isToday(date);
            return (
              <div key={key} className="flex flex-col items-center gap-1">
                <span className="text-[10px] text-muted-foreground uppercase">
                  {format(date, "EEE")}
                </span>
                <span
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                    dayIsToday
                      ? "bg-primary text-primary-foreground"
                      : isComplete
                        ? "bg-primary/20 text-primary"
                        : "text-foreground"
                  )}
                >
                  {format(date, "d")}
                </span>
                {/* Activity dot */}
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  hasWorkout
                    ? isComplete
                      ? "bg-primary"
                      : "bg-primary/40"
                    : "bg-transparent"
                )} />
              </div>
            );
          })}
        </div>

        {/* Today's workout preview */}
        {todayWorkout && !/rest/i.test(todayWorkout.title) && (
          <div
            className={cn(
              "flex items-center gap-3 p-3 rounded-lg mt-1 cursor-pointer transition-colors",
              todayIsCompleted
                ? "bg-primary/10 hover:bg-primary/15"
                : "bg-muted/50 hover:bg-muted/70"
            )}
            onClick={todayIsCompleted ? openWorkoutReview : undefined}
          >
            <div className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
              todayIsCompleted ? "bg-primary/20" : "bg-primary/10"
            )}>
              {todayIsCompleted
                ? <CheckCircle2 className="w-5 h-5 text-primary" />
                : <Calendar className="w-5 h-5 text-primary" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold truncate">
                  {todayWorkout.title.replace(/\s*\(Total:.*?\)/, "")}
                </p>
                {todayIsCompleted && (
                  <span className="text-[10px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0">
                    Completed ✓
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {todayIsCompleted && todayActivity
                  ? `${todayActivity.distance_meters ? (todayActivity.distance_meters / 1000).toFixed(1) + " km" : ""} · ${todayActivity.duration_seconds ? Math.round(todayActivity.duration_seconds / 60) + " min" : ""} · Tap for review`
                  : todayWorkout.segments.length > 0
                    ? `${todayWorkout.segments.length} segments`
                    : "Today's workout"
                }
              </p>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>
        )}
        {todayWorkout && /rest/i.test(todayWorkout.title) && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 mt-1">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
              <span className="text-lg">😴</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Rest Day</p>
              <p className="text-xs text-muted-foreground">Recovery & regeneration</p>
            </div>
          </div>
        )}
      </Card>

      {/* Training Statistics */}
      <Card className="p-4">
        <p className="text-sm font-semibold mb-3">Training Statistics</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xl font-bold text-primary">{stats.completed}</p>
            <p className="text-[10px] text-muted-foreground">Completed</p>
          </div>
          <div>
            <p className="text-xl font-bold text-muted-foreground">{stats.skipped}</p>
            <p className="text-[10px] text-muted-foreground">Skipped</p>
          </div>
          <div>
            <p className="text-xl font-bold text-foreground">{stats.remaining}</p>
            <p className="text-[10px] text-muted-foreground">Remaining</p>
          </div>
        </div>
      </Card>

      {/* Workout Review Dialog */}
      <Dialog open={reviewDialogOpen} onOpenChange={setReviewDialogOpen}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              Workout Review
            </DialogTitle>
            <DialogDescription>
              {todayWorkout?.title.replace(/\s*\(Total:.*?\)/, "")} — {format(today, "d MMMM yyyy")}
            </DialogDescription>
          </DialogHeader>

          {/* Activity Stats Grid */}
          {todayActivity && (
            <div className="grid grid-cols-2 gap-3 mt-2">
              {todayActivity.distance_meters && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <Activity className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{(todayActivity.distance_meters / 1000).toFixed(2)} km</p>
                    <p className="text-[10px] text-muted-foreground">Distance</p>
                  </div>
                </div>
              )}
              {todayActivity.duration_seconds && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <Clock className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{Math.round(todayActivity.duration_seconds / 60)} min</p>
                    <p className="text-[10px] text-muted-foreground">Duration</p>
                  </div>
                </div>
              )}
              {todayActivity.avg_heart_rate && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <Heart className="w-4 h-4 text-red-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{todayActivity.avg_heart_rate} bpm</p>
                    <p className="text-[10px] text-muted-foreground">Avg HR</p>
                  </div>
                </div>
              )}
              {todayActivity.avg_cadence && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                  <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold">{Math.round(todayActivity.avg_cadence * 2)} spm</p>
                    <p className="text-[10px] text-muted-foreground">Cadence</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* AI Review */}
          <div className="mt-3">
            {reviewLoading && !reviewContent && (
              <div className="flex items-center gap-2 py-6 justify-center text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Analyzing your workout...</span>
              </div>
            )}
            {reviewContent && (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <MarkdownRenderer content={reviewContent} />
              </div>
            )}
            {reviewLoading && reviewContent && (
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Still writing...</span>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
