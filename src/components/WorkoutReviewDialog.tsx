import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Activity, Clock, Heart, Zap, Loader2, ExternalLink, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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

type Difficulty = "Too easy" | "Just right" | "Hard" | "Too hard";
type Pace = "Too slow" | "Just right" | "Too fast";
type Feel = "Fresh" | "OK" | "Tired" | "Exhausted";
type Injury = "No injuries" | "Minor niggle" | "Sore" | "Painful";

const ChoiceRow = ({ label, options, value, onChange }: { label: string; options: string[]; value: string | null; onChange: (v: any) => void }) => (
  <div>
    <p className="text-xs font-semibold text-muted-foreground mb-1.5">{label}</p>
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${
            value === opt
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/40 border-border hover:bg-muted"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  </div>
);

export default function WorkoutReviewDialog({ open, onOpenChange, workout, activity, workoutDate, workoutTitle }: Props) {
  const navigate = useNavigate();
  const [reviewContent, setReviewContent] = useState("");
  const [reviewLoading, setReviewLoading] = useState(false);

  // Feedback state
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  const [pace, setPace] = useState<Pace | null>(null);
  const [feel, setFeel] = useState<Feel | null>(null);
  const [injury, setInjury] = useState<Injury | null>(null);

  // Elite coach recommendation
  const [coachContent, setCoachContent] = useState("");
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachDone, setCoachDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReviewContent("");
    setReviewLoading(true);
    setDifficulty(null); setPace(null); setFeel(null); setInjury(null);
    setCoachContent(""); setCoachLoading(false); setCoachDone(false);

    if (!workout || !activity) { setReviewLoading(false); return; }

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

  const feedbackComplete = !!(difficulty && pace && feel && injury);

  const submitFeedback = async () => {
    if (!workout || !activity || !feedbackComplete) return;
    setCoachLoading(true);
    setCoachContent("");
    setCoachDone(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setCoachLoading(false); return; }

    const distKm = activity.distance_meters ? (activity.distance_meters / 1000).toFixed(2) : "N/A";
    const durMin = activity.duration_seconds ? Math.round(activity.duration_seconds / 60) : "N/A";
    const avgHr = activity.avg_heart_rate || "N/A";
    const activitySummary = `Distance: ${distKm} km | Duration: ${durMin} min | Avg HR: ${avgHr} bpm`;

    let plannedWorkout = `Just completed: ${workout.title}\n`;
    for (const s of workout.segments || []) {
      plannedWorkout += `${s.segment}: ${s.duration} | Target: ${s.target} | ${s.hrZone}\n`;
    }
    plannedWorkout += `\n## Athlete Feedback\n- Difficulty: ${difficulty}\n- Pace felt: ${pace}\n- Energy/feel: ${feel}\n- Injuries: ${injury}\n\nAs an elite running coach, based on this completed workout and the athlete's feedback, give a concise recommendation (max 120 words) for what their NEXT workout should look like. Include: intended intensity, approximate distance/duration, key target (pace zone or HR zone description, no specific BPM zones), and one cue to focus on. If injuries are flagged as Sore or Painful, prioritise recovery. End with one short sentence inviting them to adjust their next planned workout if they'd like.`;

    let accumulated = "";
    streamAICoach({
      type: "workout-review",
      token: session.access_token,
      activitySummary,
      plannedWorkout,
      onDelta: (text) => { accumulated += text; setCoachContent(accumulated); },
      onDone: () => { setCoachLoading(false); setCoachDone(true); },
      onError: () => { setCoachLoading(false); setCoachContent("Unable to generate recommendation. Please try again."); },
    });
  };

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

        {/* Athlete feedback questionnaire */}
        {!reviewLoading && reviewContent && !coachContent && (
          <div className="mt-4 p-3 rounded-lg border border-border bg-muted/20 space-y-3">
            <p className="text-sm font-semibold">Quick check-in</p>
            <ChoiceRow label="How difficult was it?" options={["Too easy","Just right","Hard","Too hard"]} value={difficulty} onChange={setDifficulty} />
            <ChoiceRow label="Were the run paces…" options={["Too slow","Just right","Too fast"]} value={pace} onChange={setPace} />
            <ChoiceRow label="How do you feel?" options={["Fresh","OK","Tired","Exhausted"]} value={feel} onChange={setFeel} />
            <ChoiceRow label="Any injuries?" options={["No injuries","Minor niggle","Sore","Painful"]} value={injury} onChange={setInjury} />
            <Button
              onClick={submitFeedback}
              disabled={!feedbackComplete || coachLoading}
              className="w-full"
              size="sm"
            >
              {coachLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Asking the coach…</> : <><Sparkles className="w-4 h-4 mr-2" />Get elite coach recommendation</>}
            </Button>
          </div>
        )}

        {/* Elite coach recommendation */}
        {coachContent && (
          <div className="mt-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
            <p className="text-sm font-semibold flex items-center gap-1.5 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Elite coach — next workout
            </p>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={coachContent} />
            </div>
            {coachLoading && (
              <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Still writing...</span>
              </div>
            )}
            {coachDone && (
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => { onOpenChange(false); navigate("/plan"); }}
                >
                  Yes, adjust my plan
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => onOpenChange(false)}
                >
                  Keep as planned
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
