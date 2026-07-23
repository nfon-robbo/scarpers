/**
 * Post-benchmark RPE derivation — the single place `likely_submaximal` is
 * computed. Both the confidence-score deduction (BenchmarkConfig.RPE_SUBMAXIMAL,
 * -15) and the "Likely Submaximal" flag on benchmark history read the same
 * derived boolean, so they can never disagree.
 *
 * Rule (agreed with product):
 *   likely_submaximal = true IF
 *     rpe_response IN ('Easy', 'Moderate')
 *     OR could_continue_response = 'Easily'
 *   Otherwise false.
 *
 * This is an OR, not an AND — either answer alone is sufficient.
 */

export type RpeResponse = "Easy" | "Moderate" | "Hard" | "Maximal";
export type CouldContinueResponse = "Easily" | "A bit" | "Barely" | "Not at all";

export const RPE_OPTIONS: RpeResponse[] = ["Easy", "Moderate", "Hard", "Maximal"];
export const COULD_CONTINUE_OPTIONS: CouldContinueResponse[] = [
  "Easily", "A bit", "Barely", "Not at all",
];

export function deriveLikelySubmaximal(
  rpe: RpeResponse | null | undefined,
  couldContinue: CouldContinueResponse | null | undefined,
): boolean {
  if (rpe === "Easy" || rpe === "Moderate") return true;
  if (couldContinue === "Easily") return true;
  return false;
}
