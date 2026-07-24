/**
 * Post-benchmark coach interview — question tree, branching resolver, and
 * types for the final answer payload persisted on benchmark_results.
 *
 * Option wording MUST match `@/lib/benchmark-rpe` (and the DB CHECK
 * constraints). Do not rewrite an option here in isolation.
 */
import type {
  RpeResponse, CouldContinueResponse, HeldBackReason, SlowdownReason,
  BreaksReason, StoppageBand, Condition, HrSensorType,
} from "@/lib/benchmark-rpe";
import {
  RPE_OPTIONS, COULD_CONTINUE_OPTIONS, HELD_BACK_OPTIONS, SLOWDOWN_OPTIONS,
  BREAKS_OPTIONS, STOPPAGE_OPTIONS, CONDITION_OPTIONS, HR_SENSOR_OPTIONS,
} from "@/lib/benchmark-rpe";

export type QuestionId =
  | "q1_rpe" | "q2_held_back" | "q3_could_continue" | "q4_redo"
  | "q5_slowdown" | "q6_breaks" | "q7_stoppage" | "q8_conditions" | "q9_hr_sensor";

export type QuestionKind = "single" | "multi";

export interface QuestionDef {
  id: QuestionId;
  kind: QuestionKind;
  title: string;
  options: readonly string[];
  /** Skippable? All questions are skippable per spec. */
  skippable: true;
}

export const QUESTIONS: Record<QuestionId, QuestionDef> = {
  q1_rpe:            { id: "q1_rpe",            kind: "single", title: "How hard did this feel?",                       options: RPE_OPTIONS,             skippable: true },
  q2_held_back:      { id: "q2_held_back",      kind: "multi",  title: "What held you back?",                            options: HELD_BACK_OPTIONS,       skippable: true },
  q3_could_continue: { id: "q3_could_continue", kind: "single", title: "Could you have kept that pace going?",           options: COULD_CONTINUE_OPTIONS,  skippable: true },
  q4_redo:           { id: "q4_redo",           kind: "single", title: "Want to redo it?",                                options: ["Yes, reschedule", "No, use this result"], skippable: true },
  q5_slowdown:       { id: "q5_slowdown",       kind: "single", title: "Your second half was slower — what happened?",   options: SLOWDOWN_OPTIONS,        skippable: true },
  q6_breaks:         { id: "q6_breaks",         kind: "multi",  title: "We spotted breaks during your effort — what were they?", options: BREAKS_OPTIONS, skippable: true },
  q7_stoppage:       { id: "q7_stoppage",       kind: "single", title: "Roughly how long were you stopped in total?",    options: STOPPAGE_OPTIONS,        skippable: true },
  q8_conditions:     { id: "q8_conditions",     kind: "multi",  title: "Anything unusual about the conditions?",          options: CONDITION_OPTIONS,       skippable: true },
  q9_hr_sensor:      { id: "q9_hr_sensor",      kind: "single", title: "How do you record heart rate?",                  options: HR_SENSOR_OPTIONS,       skippable: true },
} as const;

// DetectionResult is defined in benchmark-detection-signals.ts and re-exported
// here so consumers can import interview types from one place.
export type { DetectionResult } from "@/lib/benchmark-detection-signals";
import type { DetectionResult } from "@/lib/benchmark-detection-signals";

export interface InterviewContext {
  /** True if activity has any HR data — gates Q8 (conditions is HR-contextual). */
  hasHrStream: boolean;
  /** True for auto-detected benchmark; false for manual entry. */
  hasActivity: boolean;
  detection: DetectionResult;
  /** True if profile already has hr_sensor_type; if so, skip Q9. */
  hrSensorAlreadyKnown: boolean;
}

/**
 * Full answer payload. Every field is nullable — skipped questions stay null
 * and apply no scoring effect. Corresponds 1:1 to the DB columns.
 */
export interface InterviewAnswers {
  rpe: RpeResponse | null;
  heldBackReasons: HeldBackReason[] | null;
  couldContinue: CouldContinueResponse | null;
  redoChoice: "Yes, reschedule" | "No, use this result" | null;
  slowdownReason: SlowdownReason | null;
  breaksReasons: BreaksReason[] | null;
  stoppageBand: StoppageBand | null;
  conditions: Condition[] | null;
  hrSensorType: HrSensorType | null;
  /** Free-text follow-up when any question's answer includes "Old injury". */
  injuryNote: string | null;
  /** Free-text follow-up when Q6 (breaks) includes "Something else". */
  somethingElseNote: string | null;
}

export const EMPTY_ANSWERS: InterviewAnswers = {
  rpe: null, heldBackReasons: null, couldContinue: null, redoChoice: null,
  slowdownReason: null, breaksReasons: null, stoppageBand: null,
  conditions: null, hrSensorType: null,
  injuryNote: null, somethingElseNote: null,
};

/** Cap total questions shown in one sitting. Priority-drop from the end. */
export const MAX_QUESTIONS_PER_SITTING = 5;
/** Order in which questions are dropped when over the cap. */
const DROP_PRIORITY: QuestionId[] = ["q8_conditions", "q6_breaks", "q7_stoppage"];

/**
 * Given current answers and detection context, return the ordered list of
 * questions that should appear next. Recomputed after every answer so
 * branching updates as the user progresses.
 *
 * Manual entries (no activity) skip Q5/Q6/Q7 entirely — nothing to detect.
 */
export function resolveQuestionSequence(
  answers: InterviewAnswers,
  ctx: InterviewContext,
): QuestionId[] {
  const seq: QuestionId[] = ["q1_rpe"];

  // Q2 — only if Q1 answered Easy/Moderate.
  if (answers.rpe === "Easy" || answers.rpe === "Moderate") {
    seq.push("q2_held_back");
  }

  seq.push("q3_could_continue");

  if (answers.couldContinue === "Easily") {
    seq.push("q4_redo");
  }

  // Q5–Q7 require an activity AND a positive detection.
  if (ctx.hasActivity) {
    if (ctx.detection.slowdownDetected) seq.push("q5_slowdown");
    if (ctx.detection.breaksDetected) seq.push("q6_breaks");
    if (Array.isArray(answers.breaksReasons) && answers.breaksReasons.includes("Traffic or crossings")) {
      seq.push("q7_stoppage");
    }
  }

  // Q8 — only if HR data exists (conditions contextualise HR, not pace).
  if (ctx.hasHrStream) seq.push("q8_conditions");

  // Q9 — asked once ever.
  if (!ctx.hrSensorAlreadyKnown) seq.push("q9_hr_sensor");

  // Apply the cap: drop from the end using DROP_PRIORITY order.
  while (seq.length > MAX_QUESTIONS_PER_SITTING) {
    const nextDrop = DROP_PRIORITY.find((q) => seq.includes(q));
    if (!nextDrop) break;
    const idx = seq.indexOf(nextDrop);
    seq.splice(idx, 1);
  }

  return seq;
}
