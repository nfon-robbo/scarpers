/**
 * Post-benchmark interview option sets and the single derivation of
 * `likely_submaximal`. Both the confidence-score deduction and the
 * "Likely Submaximal" flag on benchmark history read the same boolean.
 *
 * Every option list below is mirrored by a CHECK constraint on
 * `benchmark_results` (or `profiles.hr_sensor_type`) — do NOT change wording
 * without a matching migration or inserts will fail.
 *
 * Rule:
 *   likely_submaximal = true IF
 *     rpe_response IN ('Easy', 'Moderate')
 *     OR could_continue_response = 'Easily'
 */

export type RpeResponse = "Easy" | "Moderate" | "Hard" | "Very Hard" | "Maximal";
export type CouldContinueResponse =
  | "Easily"
  | "Another 15 minutes"
  | "Another 10 minutes"
  | "Another 5 minutes"
  | "No";

export type HeldBackReason =
  | "Legs" | "Breathing" | "Motivation" | "Misjudged the pace" | "Cut it short" | "Old injury";

export type SlowdownReason =
  | "Went out too hard" | "Hills or terrain" | "Ran out of legs"
  | "Deliberate, felt strong early" | "Something interrupted me" | "Old injury";

export type BreaksReason =
  | "Traffic or crossings" | "Planned walk breaks" | "Needed to recover" | "Old injury" | "Something else";

export type StoppageBand =
  | "Under 30 seconds" | "30 seconds to 1 minute" | "1 to 2 minutes" | "Over 2 minutes";

export type Condition = "Nothing notable" | "Windy" | "Hot" | "Cold" | "Treadmill";

export type HrSensorType = "Chest strap" | "Watch wrist sensor" | "Armband" | "I don't";

export const RPE_OPTIONS: RpeResponse[] = ["Easy", "Moderate", "Hard", "Very Hard", "Maximal"];
export const COULD_CONTINUE_OPTIONS: CouldContinueResponse[] = [
  "Easily", "Another 15 minutes", "Another 10 minutes", "Another 5 minutes", "No",
];
export const HELD_BACK_OPTIONS: HeldBackReason[] = [
  "Legs", "Breathing", "Motivation", "Misjudged the pace", "Cut it short", "Old injury",
];
export const SLOWDOWN_OPTIONS: SlowdownReason[] = [
  "Went out too hard", "Hills or terrain", "Ran out of legs",
  "Deliberate, felt strong early", "Something interrupted me", "Old injury",
];
export const BREAKS_OPTIONS: BreaksReason[] = [
  "Traffic or crossings", "Planned walk breaks", "Needed to recover", "Old injury", "Something else",
];
export const STOPPAGE_OPTIONS: StoppageBand[] = [
  "Under 30 seconds", "30 seconds to 1 minute", "1 to 2 minutes", "Over 2 minutes",
];
export const CONDITION_OPTIONS: Condition[] = [
  "Nothing notable", "Windy", "Hot", "Cold", "Treadmill",
];
export const HR_SENSOR_OPTIONS: HrSensorType[] = [
  "Chest strap", "Watch wrist sensor", "Armband", "I don't",
];

/** Any of the three multi-select questions can carry the "Old injury" tag. */
export const INJURY_TAG = "Old injury" as const;

/**
 * Reasons on Q5 that EXPLAIN a second-half fade without it being a pacing
 * failure — used to suppress the SECOND_HALF_SLOWDOWN confidence deduction.
 */
export const SLOWDOWN_SUPPRESSES_DEDUCTION: SlowdownReason[] = [
  "Deliberate, felt strong early",
  "Hills or terrain",
];

export function deriveLikelySubmaximal(
  rpe: RpeResponse | null | undefined,
  couldContinue: CouldContinueResponse | null | undefined,
): boolean {
  if (rpe === "Easy" || rpe === "Moderate") return true;
  if (couldContinue === "Easily") return true;
  return false;
}
