import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Activity, Clock, Heart, Zap, Loader2, ExternalLink, Sparkles, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { streamAICoach } from "@/lib/ai-stream";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { ParsedWorkout, parseWorkoutsFromPlan } from "@/lib/plan-export";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workout: ParsedWorkout | null;
  activity: any | null;
  workoutDate: Date | null;
  workoutTitle: string;
  /** Only the latest completed workout can request a fresh elite-coach recommendation. */
  canRequestCoach?: boolean;
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

export default function WorkoutReviewDialog({ open, onOpenChange, workout, activity, workoutDate, workoutTitle, canRequestCoach = true }: Props) {
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
  const [nextSession, setNextSession] = useState<ParsedWorkout | null>(null);
  const [readinessScore, setReadinessScore] = useState<number | null>(null);

  // Track whether we already loaded an existing saved review for this activity
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReviewContent("");
    setReviewLoading(true);
    setDifficulty(null); setPace(null); setFeel(null); setInjury(null);
    setCoachContent(""); setCoachLoading(false); setCoachDone(false);
    setNextSession(null); setReadinessScore(null);
    hydratedRef.current = null;

    if (!workout || !activity) { setReviewLoading(false); return; }

    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setReviewLoading(false); return; }

      // 1. Try to load any saved review (selections + cached AI text)
      const { data: saved } = await supabase
        .from("workout_reviews")
        .select("difficulty, pace, feel, injury, ai_summary, coach_recommendation")
        .eq("activity_id", activity.id)
        .maybeSingle();

      if (cancelled) return;

      if (saved) {
        hydratedRef.current = activity.id;
        if (saved.difficulty) setDifficulty(saved.difficulty as Difficulty);
        if (saved.pace) setPace(saved.pace as Pace);
        if (saved.feel) setFeel(saved.feel as Feel);
        if (saved.injury) setInjury(saved.injury as Injury);
        if (saved.coach_recommendation) {
          setCoachContent(saved.coach_recommendation);
          setCoachDone(true);
        }
        if (saved.ai_summary) {
          setReviewContent(saved.ai_summary);
          setReviewLoading(false);
          return; // don't regenerate the AI summary if we already have it cached
        }
      } else {
        hydratedRef.current = activity.id;
      }

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
        onDone: async () => {
          if (cancelled) return;
          setReviewLoading(false);
          // Cache the AI summary so we don't regenerate next time
          try {
            await supabase.from("workout_reviews").upsert({
              user_id: session.user.id,
              activity_id: activity.id,
              ai_summary: accumulated,
            } as any, { onConflict: "activity_id" });
          } catch (e) { console.error("[review] failed to cache ai_summary", e); }
        },
        onError: () => { if (!cancelled) { setReviewLoading(false); setReviewContent("Unable to generate review. Please try again."); } },
      });
    })();
    return () => { cancelled = true; };
  }, [open, workout, activity]);

  // Persist check-in selections whenever the user changes one
  useEffect(() => {
    if (!open || !activity || hydratedRef.current !== activity.id) return;
    if (!difficulty && !pace && !feel && !injury) return;
    const t = setTimeout(async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      try {
        await supabase.from("workout_reviews").upsert({
          user_id: user.id,
          activity_id: activity.id,
          difficulty,
          pace,
          feel,
          injury,
        } as any, { onConflict: "activity_id" });
      } catch (e) { console.error("[review] failed to save selections", e); }
    }, 400);
    return () => clearTimeout(t);
  }, [open, activity, difficulty, pace, feel, injury]);

  const feedbackComplete = !!(difficulty && pace && feel && injury);

  const submitFeedback = async () => {
    if (!workout || !activity || !feedbackComplete || !canRequestCoach) return;
    setCoachLoading(true);
    setCoachContent("");
    setCoachDone(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setCoachLoading(false); return; }
    const userId = session.user.id;

    // --- 1. Fetch active plan + parse + locate the NEXT planned session after this one ---
    let nextWk: ParsedWorkout | null = null;
    try {
      const { data: plan } = await supabase
        .from("training_plans")
        .select("content")
        .eq("user_id", userId)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (plan?.content) {
        const all = parseWorkoutsFromPlan(plan.content);
        const completedDate = workoutDate ?? (workout.dateObj ?? null);
        const isRest = (w: ParsedWorkout) =>
          (w.segments?.length ?? 0) === 0 || /\brest\b/i.test(w.title);
        nextWk = all.find(w =>
          w.dateObj && completedDate && w.dateObj.getTime() > completedDate.getTime() && !isRest(w)
        ) ?? null;
      }
    } catch (e) { console.error("[review] failed to load next planned session", e); }
    setNextSession(nextWk);

    // --- 2. Latest readiness score ---
    let readiness: number | null = null;
    try {
      const { data: snap } = await supabase
        .from("readiness_snapshots")
        .select("score")
        .eq("user_id", userId)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (snap?.score != null) readiness = snap.score;
    } catch (e) { console.error("[review] failed to load readiness", e); }
    setReadinessScore(readiness);

    // --- 3. Build the prompt ---
    const distKm = activity.distance_meters ? (activity.distance_meters / 1000).toFixed(2) : "N/A";
    const durMin = activity.duration_seconds ? Math.round(activity.duration_seconds / 60) : "N/A";
    const avgHr = activity.avg_heart_rate || "N/A";
    const activitySummary = `Distance: ${distKm} km | Duration: ${durMin} min | Avg HR: ${avgHr} bpm`;

    let plannedWorkout = `Just completed: ${workout.title}\n`;
    for (const s of workout.segments || []) {
      plannedWorkout += `${s.segment}: ${s.duration} | Target: ${s.target} | ${s.hrZone}\n`;
    }
    plannedWorkout += `\n## Athlete Feedback\n- Difficulty: ${difficulty}\n- Pace felt: ${pace}\n- Energy/feel: ${feel}\n- Injuries: ${injury}\n`;
    plannedWorkout += `\n## Current Readiness Score\n${readiness != null ? `${readiness}/100` : "Unknown"}\n`;

    if (nextWk) {
      plannedWorkout += `\n## NEXT Planned Session (${nextWk.date})\nTitle: ${nextWk.title}\n`;
      for (const s of nextWk.segments || []) {
        plannedWorkout += `- ${s.segment}: ${s.duration} | Target: ${s.target} | ${s.hrZone}\n`;
      }
    } else {
      plannedWorkout += `\n## NEXT Planned Session\n(No upcoming planned session found in the active plan.)\n`;
    }

    plannedWorkout += `

You are an elite running coach. The athlete has just completed the session above. You must judge the **next planned session** against their check-in answers and current readiness, then return EXACTLY ONE of three recommendations:

**ENDORSE** — Use when check-in answers and readiness (>=55) indicate they are recovering well. Confirm the next planned session as appropriate and explain in 2 short sentences why it is right for where they are in the plan.

**MODIFY** — Use when check-in answers suggest mild fatigue OR readiness is between 40 and 55. Keep the next session but suggest specific, concrete modifications (e.g. reduce duration by 15%, drop target pace by 15-20 sec/km, convert intervals to easy running). Be precise about the change.

**SWAP** — Use when check-in answers flag significant fatigue, "Sore"/"Painful" injuries, "Exhausted" feel, OR readiness < 40. Recommend swapping the next planned session entirely for an easy recovery run or rest day, and explain the reason clearly.

Format your response as markdown:
- Start with a heading: "### Verdict: Endorse" or "### Verdict: Modify" or "### Verdict: Swap"
- One short paragraph (max 80 words) with the reasoning, referencing the check-in answers and readiness score
- A bullet list titled "**Coach's recommended next session:**" with: intended intensity, approximate distance/duration, key target (pace/HR description, no specific BPM zones), and one cue to focus on
- End with: "Tap 'Yes, adjust my plan' below to apply this change, or 'Keep as planned' to stick with the original."

Total length: 150 words max. Do not include the original next-session table again — it is shown to the user separately.`;

    let accumulated = "";
    streamAICoach({
      type: "workout-review",
      token: session.access_token,
      activitySummary,
      plannedWorkout,
      onDelta: (text) => { accumulated += text; setCoachContent(accumulated); },
      onDone: async () => {
        setCoachLoading(false);
        setCoachDone(true);
        // Embed the snapshot of the next planned session at the top of the saved
        // recommendation so it is always visible when re-opened later.
        const nextBlock = nextWk
          ? `> **Next planned session — ${nextWk.date}: ${nextWk.title}**\n` +
            (nextWk.segments || []).map(s => `> - ${s.segment}: ${s.duration} — ${s.target} (${s.hrZone})`).join("\n") +
            `\n> Readiness at time of recommendation: ${readiness != null ? `${readiness}/100` : "n/a"}\n\n`
          : "";
        const toSave = nextBlock + accumulated;
        try {
          await supabase.from("workout_reviews").upsert({
            user_id: userId,
            activity_id: activity.id,
            difficulty, pace, feel, injury,
            coach_recommendation: toSave,
          } as any, { onConflict: "activity_id" });
        } catch (e) { console.error("[review] failed to save coach recommendation", e); }
      },
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
              disabled={!feedbackComplete || coachLoading || !canRequestCoach}
              className="w-full"
              size="sm"
              title={!canRequestCoach ? "Only your most recent completed workout can request a fresh recommendation" : undefined}
            >
              {coachLoading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Asking the coach…</>
                : !canRequestCoach
                  ? <><Lock className="w-4 h-4 mr-2" />Available on your latest workout only</>
                  : <><Sparkles className="w-4 h-4 mr-2" />Get elite coach recommendation</>}
            </Button>
            {!canRequestCoach && (
              <p className="text-[11px] text-muted-foreground text-center">
                Your check-in answers are saved automatically.
              </p>
            )}
          </div>
        )}

        {/* Next planned session snapshot — shown alongside coach recommendation */}
        {coachContent && nextSession && (
          <div className="mt-3 p-3 rounded-lg border border-border bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Originally planned next ({nextSession.date})</p>
            <p className="text-sm font-semibold mb-1.5">{nextSession.title}</p>
            <ul className="text-xs space-y-0.5 text-muted-foreground">
              {(nextSession.segments || []).map((s, i) => (
                <li key={i}>• {s.segment}: {s.duration} — {s.target} <span className="opacity-70">({s.hrZone})</span></li>
              ))}
            </ul>
            {readinessScore != null && (
              <p className="text-[11px] text-muted-foreground mt-2">Readiness at recommendation: <span className="font-semibold">{readinessScore}/100</span></p>
            )}
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
            {coachDone && canRequestCoach && (
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/training-plan", { state: { applyRecommendation: coachContent } });
                  }}
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
