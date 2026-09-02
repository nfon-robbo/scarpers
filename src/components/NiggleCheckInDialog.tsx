import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { HeartPulse, Loader2, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { streamAICoach } from "@/lib/ai-stream";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { parseWorkoutsFromPlan, ParsedWorkout } from "@/lib/plan-export";
import { getActiveNiggles, hasCheckinOn, recordNiggleCheckin, resolveNiggle, NiggleRow, NiggleTrend } from "@/lib/niggles";

const SKIP_KEY = "scarpers_niggle_checkin_skipped";

/**
 * On the morning of a training day, ask how an active niggle feels
 * (Better / Same / Worse) and judge whether today's session needs changing.
 */
export default function NiggleCheckInDialog({ userId }: { userId: string | undefined }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [niggle, setNiggle] = useState<NiggleRow | null>(null);
  const [todayWorkout, setTodayWorkout] = useState<ParsedWorkout | null>(null);
  const [trend, setTrend] = useState<NiggleTrend | null>(null);
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const checkedRef = useRef(false);

  const todayIso = format(new Date(), "yyyy-MM-dd");

  useEffect(() => {
    if (!userId || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      try {
        if (localStorage.getItem(SKIP_KEY) === todayIso) return;
        const active = await getActiveNiggles(userId);
        if (!active.length) return;

        const { data: plan } = await supabase
          .from("training_plans")
          .select("content")
          .eq("user_id", userId)
          .eq("archived", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!plan?.content) return;

        const workouts = parseWorkoutsFromPlan(plan.content);
        const today = workouts.find((w) => w.dateObj && format(w.dateObj, "yyyy-MM-dd") === todayIso);
        const isRest = !today || (today.segments?.length ?? 0) === 0 || /\brest\b/i.test(today.title);
        if (isRest) return;

        // Only ask once per day, and only if today's run isn't already logged.
        const start = `${todayIso}T00:00:00`;
        const end = `${todayIso}T23:59:59`;
        const { data: acts } = await supabase
          .from("activities")
          .select("id")
          .eq("user_id", userId)
          .gte("start_time", start)
          .lte("start_time", end)
          .limit(1);
        if (acts && acts.length) return;

        for (const n of active) {
          if (await hasCheckinOn(n.id, todayIso)) continue;
          setNiggle(n);
          setTodayWorkout(today!);
          setOpen(true);
          return;
        }
      } catch (e) {
        console.error("[niggle] check-in lookup failed", e);
      }
    })();
  }, [userId, todayIso]);

  const answer = useCallback(async (value: NiggleTrend) => {
    if (!niggle || !todayWorkout || !userId) return;
    setTrend(value);
    setLoading(true);
    setAdvice("");
    setDone(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    let workoutText = `${todayWorkout.title}\n`;
    for (const s of todayWorkout.segments || []) {
      workoutText += `${s.segment}: ${s.duration} | Target: ${s.target} | ${s.hrZone}\n`;
    }

    const prompt = `## Niggle check-in (${format(new Date(), "dd/MM/yyyy")})
- Niggle location: ${niggle.location}
- Reported on: ${niggle.reported_on}${niggle.severity ? `\n- Severity when reported: ${niggle.severity}` : ""}${niggle.notes ? `\n- Athlete note: ${niggle.notes}` : ""}
- How it feels today vs last run: **${value}**

## Today's planned session
${workoutText}

You are an elite running coach. Judge ONLY today's session against the niggle report above and return EXACTLY ONE verdict:

**GO AHEAD** — the niggle is Better or is a mild Same with a low-stress session. Confirm today's session unchanged.
**MODIFY** — the niggle is Same on a hard session, or Worse but mild. Give specific, concrete changes (drop intervals to steady running, cut duration by X%, ease pace by X sec/km, cap effort at easy).
**REST / CROSS-TRAIN** — the niggle is Worse and sharp, or pain is limiting. Recommend replacing today's session with rest or non-impact cross-training.

Format as markdown:
- Heading: "### Verdict: Go ahead" / "### Verdict: Modify" / "### Verdict: Rest"
- One short paragraph (max 60 words) referencing the niggle location and trend
- If Modify or Rest, a bullet list "**Today instead:**" with intensity, duration/distance and one cue
- Total 120 words max. No specific BPM numbers.`;

    let acc = "";
    streamAICoach({
      type: "workout-review",
      token: session.access_token,
      featureName: "niggle-checkin",
      activitySummary: `Niggle: ${niggle.location} — feels ${value} today`,
      plannedWorkout: prompt,
      onDelta: (t) => { acc += t; setAdvice(acc); },
      onDone: async () => {
        setLoading(false);
        setDone(true);
        try {
          await recordNiggleCheckin({
            userId, niggleId: niggle.id, dateIso: todayIso, response: value,
            workoutTitle: todayWorkout.title, advice: acc,
          });
        } catch (e) { console.error("[niggle] failed to save check-in", e); }
      },
      onError: async (err) => {
        setLoading(false);
        setDone(true);
        setAdvice(`Couldn't reach the coach right now (${err}). Your answer has been saved.`);
        try {
          await recordNiggleCheckin({
            userId, niggleId: niggle.id, dateIso: todayIso, response: value,
            workoutTitle: todayWorkout.title,
          });
        } catch { /* ignore */ }
      },
    });
  }, [niggle, todayWorkout, userId, todayIso]);

  const close = () => {
    localStorage.setItem(SKIP_KEY, todayIso);
    setOpen(false);
  };

  if (!niggle) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HeartPulse className="w-5 h-5 text-primary" />
            How's the niggle today?
          </DialogTitle>
          <DialogDescription>
            You reported a niggle in your <span className="font-semibold">{niggle.location}</span>. You've got{" "}
            {todayWorkout?.title} planned today.
          </DialogDescription>
        </DialogHeader>

        {!trend && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {(["Better", "Same", "Worse"] as NiggleTrend[]).map((v) => (
              <Button key={v} variant="outline" onClick={() => answer(v)} className="h-16 flex-col gap-1">
                <span className="text-sm font-semibold">{v}</span>
              </Button>
            ))}
          </div>
        )}

        {trend && (
          <div className="mt-2 space-y-3">
            <p className="text-xs text-muted-foreground">
              {niggle.location} feels <span className="font-semibold text-foreground">{trend.toLowerCase()}</span> today.
            </p>

            {(advice || loading) && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
                <p className="text-sm font-semibold flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-4 h-4 text-primary" />
                  Coach verdict on today's session
                </p>
                {advice ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <MarkdownRenderer content={advice} />
                  </div>
                ) : null}
                {loading && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Checking your session…</span>
                  </div>
                )}
              </div>
            )}

            {done && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      close();
                      navigate("/training-plan", { state: { applyRecommendation: advice } });
                    }}
                  >
                    Adjust today's workout
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={close}>
                    Keep as planned
                  </Button>
                </div>
                {trend === "Better" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full text-xs"
                    onClick={async () => { await resolveNiggle(niggle.id); close(); }}
                  >
                    The niggle has gone — stop asking
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
