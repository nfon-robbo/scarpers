/**
 * BenchmarkInterviewDialog — the multi-step post-benchmark coach interview.
 *
 * - One question at a time.
 * - Multi-select or single-select per question.
 * - Back / Skip / Next / Save.
 * - Sequence is recomputed after every answer via `resolveQuestionSequence`.
 * - Cap of 5 questions per sitting (enforced inside the resolver).
 *
 * Emits a full `InterviewAnswers` payload on Save; the caller persists it
 * via confirmBenchmark.
 */
import { useCallback, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  QUESTIONS,
  EMPTY_ANSWERS,
  resolveQuestionSequence,
  type InterviewAnswers,
  type InterviewContext,
  type QuestionId,
} from "@/lib/benchmark-interview";

interface Props {
  open: boolean;
  working?: boolean;
  ctx: InterviewContext;
  onCancel: () => void;
  onSubmit: (answers: InterviewAnswers) => void | Promise<void>;
}

function Chip({
  label, selected, onClick,
}: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-full text-xs border transition-colors",
        selected
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background/60 border-border/60 hover:border-primary/50",
      )}
    >
      {label}
    </button>
  );
}

function getAnswerFor(a: InterviewAnswers, q: QuestionId): string | string[] | null {
  switch (q) {
    case "q1_rpe":            return a.rpe;
    case "q2_held_back":      return a.heldBackReasons;
    case "q3_could_continue": return a.couldContinue;
    case "q4_redo":           return a.redoChoice;
    case "q5_slowdown":       return a.slowdownReason;
    case "q6_breaks":         return a.breaksReasons;
    case "q7_stoppage":       return a.stoppageBand;
    case "q8_conditions":     return a.conditions;
    case "q9_hr_sensor":      return a.hrSensorType;
  }
}

function setAnswerFor(
  a: InterviewAnswers, q: QuestionId, v: string | string[] | null,
): InterviewAnswers {
  const next = { ...a };
  switch (q) {
    case "q1_rpe":            next.rpe = v as any; break;
    case "q2_held_back":      next.heldBackReasons = v as any; break;
    case "q3_could_continue": next.couldContinue = v as any; break;
    case "q4_redo":           next.redoChoice = v as any; break;
    case "q5_slowdown":       next.slowdownReason = v as any; break;
    case "q6_breaks":         next.breaksReasons = v as any; break;
    case "q7_stoppage":       next.stoppageBand = v as any; break;
    case "q8_conditions":     next.conditions = v as any; break;
    case "q9_hr_sensor":      next.hrSensorType = v as any; break;
  }
  return next;
}

export default function BenchmarkInterviewDialog({
  open, working, ctx, onCancel, onSubmit,
}: Props) {
  const [answers, setAnswers] = useState<InterviewAnswers>(EMPTY_ANSWERS);
  const [stepIdx, setStepIdx] = useState(0);

  const sequence = useMemo(
    () => resolveQuestionSequence(answers, ctx),
    [answers, ctx],
  );
  const currentId = sequence[Math.min(stepIdx, sequence.length - 1)];
  const currentQ = currentId ? QUESTIONS[currentId] : null;
  const currentValue = currentQ ? getAnswerFor(answers, currentQ.id) : null;
  const isLast = stepIdx >= sequence.length - 1;

  const toggleMulti = useCallback((q: QuestionId, opt: string) => {
    setAnswers((a) => {
      const cur = (getAnswerFor(a, q) as string[] | null) ?? [];
      const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
      return setAnswerFor(a, q, next.length ? next : null);
    });
  }, []);

  const setSingle = useCallback((q: QuestionId, opt: string) => {
    setAnswers((a) => setAnswerFor(a, q, opt));
  }, []);

  const goNext = () => setStepIdx((i) => Math.min(i + 1, sequence.length - 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));

  const skip = () => {
    if (currentQ) setAnswers((a) => setAnswerFor(a, currentQ.id, currentQ.kind === "multi" ? null : null));
    if (isLast) void onSubmit(answers);
    else goNext();
  };

  const advance = () => {
    if (isLast) void onSubmit(answers);
    else goNext();
  };

  const total = sequence.length;
  const stepLabel = `${Math.min(stepIdx + 1, total)} / ${total}`;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Post-benchmark check-in</DialogTitle>
          <DialogDescription>
            A short coach interview so we can trust the numbers and shape what's next.
          </DialogDescription>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-1">
          {sequence.map((qId, i) => (
            <div
              key={qId}
              className={cn(
                "h-1 flex-1 rounded-full transition-colors",
                i < stepIdx ? "bg-primary/70"
                  : i === stepIdx ? "bg-primary"
                  : "bg-border/50",
              )}
            />
          ))}
        </div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
          Question {stepLabel}
        </div>

        {currentQ ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold leading-snug">{currentQ.title}</h3>
            {currentQ.kind === "multi" && (
              <p className="text-[11px] text-muted-foreground -mt-3">Select all that apply.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {currentQ.options.map((opt) => {
                const isSelected = currentQ.kind === "multi"
                  ? Array.isArray(currentValue) && currentValue.includes(opt)
                  : currentValue === opt;
                return (
                  <Chip
                    key={opt}
                    label={opt}
                    selected={isSelected}
                    onClick={() =>
                      currentQ.kind === "multi"
                        ? toggleMulti(currentQ.id, opt)
                        : setSingle(currentQ.id, opt)
                    }
                  />
                );
              })}
            </div>

            {(() => {
              // Show follow-up inputs when the current question's answer
              // includes "Old injury" or "Something else". Notes persist
               // across question changes via `answers.injuryNote` /
               // `answers.somethingElseNote`.
              const selectedValues = Array.isArray(currentValue)
                ? currentValue
                : currentValue
                  ? [currentValue as string]
                  : [];
              const showInjury = selectedValues.includes("Old injury");
              const showSomethingElse = selectedValues.includes("Something else");
              if (!showInjury && !showSomethingElse) return null;
              return (
                <div className="space-y-2">
                  {showInjury && (
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">
                        What injury? (used to shape your plan)
                      </label>
                      <textarea
                        value={answers.injuryNote ?? ""}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, injuryNote: e.target.value || null }))
                        }
                        rows={2}
                        placeholder="e.g. right achilles tendinopathy, flares on hills"
                        className="w-full text-xs rounded-md border border-border/60 bg-background/60 px-2 py-1.5 focus:outline-none focus:border-primary/60"
                      />
                    </div>
                  )}
                  {showSomethingElse && (
                    <div className="space-y-1">
                      <label className="text-[11px] text-muted-foreground">
                        What was it? (used to shape your plan)
                      </label>
                      <textarea
                        value={answers.somethingElseNote ?? ""}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, somethingElseNote: e.target.value || null }))
                        }
                        rows={2}
                        placeholder="Tell your coach what happened"
                        className="w-full text-xs rounded-md border border-border/60 bg-background/60 px-2 py-1.5 focus:outline-none focus:border-primary/60"
                      />
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={goBack}
                disabled={stepIdx === 0 || working}
                className="text-muted-foreground"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-1" /> Back
              </Button>
              <Button size="sm" variant="outline" onClick={skip} disabled={working}>
                Skip
              </Button>
              <div className="flex-1" />
              <Button size="sm" onClick={advance} disabled={working}>
                {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : isLast ? "Save answers"
                  : <>Next <ChevronRight className="w-3.5 h-3.5 ml-1" /></>}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
