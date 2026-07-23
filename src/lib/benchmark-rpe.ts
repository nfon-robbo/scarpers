/**
 * Post-benchmark RPE derivation — the single place `likely_submaximal` is
 * computed. Both the confidence-score deduction (BenchmarkConfig.RPE_SUBMAXIMAL,
 * -15) and the "Likely Submaximal" flag on benchmark history read the same
 * derived boolean, so they can never disagree.
 *
 * Agreed option sets (do NOT change without product sign-off):
 *   RPE:            Easy | Moderate | Hard | Very Hard | Maximal
 *   Could continue: Easily | Another 15 minutes | Another 10 minutes
 *                 | Another 5 minutes | No
 *
 * Rule:
 *   likely_submaximal = true IF
 *     rpe_response IN ('Easy', 'Moderate')
 *     OR could_continue_response = 'Easily'
 *   Otherwise false.
 *
 * OR, not AND — either answer alone is sufficient. The graded "Another N
 * minutes" answers deliberately do NOT flip the flag: they refine how much
 * was left in the tank without automatically demoting the effort.
 */

export type RpeResponse = "Easy" | "Moderate" | "Hard" | "Very Hard" | "Maximal";
export type CouldContinueResponse =
  | "Easily"
  | "Another 15 minutes"
  | "Another 10 minutes"
  | "Another 5 minutes"
  | "No";

export const RPE_OPTIONS: RpeResponse[] = [
  "Easy", "Moderate", "Hard", "Very Hard", "Maximal",
];
export const COULD_CONTINUE_OPTIONS: CouldContinueResponse[] = [
  "Easily",
  "Another 15 minutes",
  "Another 10 minutes",
  "Another 5 minutes",
  "No",
];

export function deriveLikelySubmaximal(
  rpe: RpeResponse | null | undefined,
  couldContinue: CouldContinueResponse | null | undefined,
): boolean {
  if (rpe === "Easy" || rpe === "Moderate") return true;
  if (couldContinue === "Easily") return true;
  return false;
}
