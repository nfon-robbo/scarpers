import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Link } from "react-router-dom";
import { CheckCircle2, Activity, Clock, Heart, Zap, Loader2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { streamAICoach } from "@/lib/ai-stream";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { ParsedWorkout } from "@/lib/plan-export";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workout: ParsedWorkout | null;
  activity: any | null;
  workoutDate: Date | null;
  workoutTitle: string;
}

export default function WorkoutReviewDialog({ open, onOpenChange, workout, activity, workoutDate, workoutTitle }: Props) {
  const [reviewContent, setReviewContent] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);

  useEffect(() => {
    if (!open || !workout || !activity) return;
    setReviewContent("");
    setReviewLoading(true);

    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setReviewLoading(false); return; }

      const distKm = activity.distance_meters ? (activity.distance_meters / 1000).toFixed(2) : "N/A";
      const durMin = activity.duration_seconds ? Math.round(activity.duration_seconds / 60) : "N/A";
      const avgHr = activity.avg_heart_rate || "N/A";
      const maxHr = activity.max_heart_rate || "N/A";
      const avgCad = activity.avg_cadence || "N/A";
      const cals = activity.calories || "N/A";
      const activitySummary = `Distance: ${distKm} km\nDuration: ${durMin} min\nAvg HR: ${avgHr} bpm\nMax HR: ${maxHr} bpm\nAvg Cadence: ${avgCad} spm\nCalories: ${cals}`;

      let plannedWorkout = workout.title + "\n";
      for (const s of workout.segments || []) {
        plannedWorkout += `${s.segment}: ${s.duration} | Target: ${s.target} | ${s.hrZone} | ${s.notes || ""}\n`;
      }

      let accumulated = "";
      streamAICoach({
        type: "workout-review",
        token: session.access_token,
        activitySummary,
        plannedWorkout,
        onDelta: (text) => { if (cancelled) return; accumulated += text; setReviewContent(accumulated); },
        onDone: () => { if (!cancelled) setReviewLoading(false); },
        onError: () => { if (!cancelled) { setReviewLoading(false); setReviewContent("Unable to generate review. Please try again."); } },
      });
    })();
    return () => { cancelled = true; };
  }, [open, workout, activity]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-primary" />
            Workout Review
          </DialogTitle>
          <DialogDescription>
            {workoutTitle} {workoutDate ? `— ${format(workoutDate, "d MMMM yyyy")}` : ""}
          </DialogDescription>
        </DialogHeader>

        {/* Link to full activity details */}
        {activity?.id && (
          <Link
            to={`/activities?activity=${activity.id}`}
            onClick={() => onOpenChange(false)}
            className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-primary/10 hover:bg-primary/15 transition-colors text-primary"
          >
            <span className="text-sm font-semibold flex items-center gap-2">
              <ExternalLink className="w-4 h-4" />
              View full activity details
            </span>
            <span className="text-xs opacity-75">Open →</span>
          </Link>
        )}

        {/* Activity Stats Grid */}
        {activity && (
          <div className="grid grid-cols-2 gap-3 mt-2">
            {activity.distance_meters && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <Activity className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{(activity.distance_meters / 1000).toFixed(2)} km</p>
                  <p className="text-[10px] text-muted-foreground">Distance</p>
                </div>
              </div>
            )}
            {activity.duration_seconds && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <Clock className="w-4 h-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{Math.round(activity.duration_seconds / 60)} min</p>
                  <p className="text-[10px] text-muted-foreground">Duration</p>
                </div>
              </div>
            )}
            {activity.avg_heart_rate && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <Heart className="w-4 h-4 text-red-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{activity.avg_heart_rate} bpm</p>
                  <p className="text-[10px] text-muted-foreground">Avg HR</p>
                </div>
              </div>
            )}
            {activity.avg_cadence && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <Zap className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">{Math.round(activity.avg_cadence * 2)} spm</p>
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
  );
}
