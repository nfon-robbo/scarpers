/**
 * Recompute plan workout paces from a new threshold pace.
 *
 * Strategy: line-by-line rewrite. For each line we detect (a) a session-type
 * keyword (easy/steady/marathon/threshold/CV/VO2/rep) and (b) a pace token
 * matching `M:SS[-M:SS]/km`. When BOTH are present we replace the pace token
 * with a fresh range computed from the new threshold via BenchmarkConfig
 * ratios. Everything else — headings, tables of contents, `[benchmark:...]`
 * tokens, warm-up/cool-down HR targets, notes — passes through verbatim.
 *
 * Guaranteed side-effects: none. Return `{ newContent, changes }` and let
 * the caller show a diff dialog + persist on confirm.
 */
import {
  paceRangeFromThreshold,
  type SessionPaceCategory,
} from "@/lib/benchmark-calculations";

const CATEGORY_KEYWORDS: Array<{ re: RegExp; category: SessionPaceCategory }> = [
  // Order matters — longer / more specific first.
  { re: /\b(vo\s*2\s*max|vo2)\b/i, category: "vo2" },
  { re: /\b(rep|reps|repetition|repetitions|r-pace)\b/i, category: "rep" },
  { re: /\b(cv|cruise|critical\s*velocity|10k)\b/i, category: "cv" },
  { re: /\b(threshold|tempo|lt|lactate)\b/i, category: "threshold" },
  { re: /\b(marathon|mp)\b/i, category: "marathon" },
  { re: /\b(steady|moderate)\b/i, category: "steady" },
  { re: /\b(easy|recovery|z2|zone\s*2)\b/i, category: "easy" },
];

const PACE_TOKEN_RE = /(\d{1,2}):(\d{2})(?:\s*[-–]\s*(\d{1,2}):(\d{2}))?\s*\/\s*km/gi;

export interface PaceChange {
  lineNo: number;              // 1-indexed
  category: SessionPaceCategory;
  before: string;
  after: string;
  fullLineBefore: string;
  fullLineAfter: string;
}

export interface RecomputeResult {
  newContent: string;
  changes: PaceChange[];
}

function fmt(sec: number): string {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${(t % 60).toString().padStart(2, "0")}`;
}

function categoryForLine(line: string): SessionPaceCategory | null {
  for (const { re, category } of CATEGORY_KEYWORDS) {
    if (re.test(line)) return category;
  }
  return null;
}

export function recomputePlanPaces(
  planContent: string,
  newThresholdSecPerKm: number,
): RecomputeResult {
  if (!planContent) return { newContent: planContent ?? "", changes: [] };
  const lines = planContent.split("\n");
  const changes: PaceChange[] = [];

  const out = lines.map((line, i) => {
    const category = categoryForLine(line);
    if (!category) return line;
    if (!PACE_TOKEN_RE.test(line)) {
      PACE_TOKEN_RE.lastIndex = 0;
      return line;
    }
    PACE_TOKEN_RE.lastIndex = 0;

    const { minSecPerKm, maxSecPerKm } = paceRangeFromThreshold(
      newThresholdSecPerKm,
      category,
    );
    const replacement = `${fmt(minSecPerKm)}-${fmt(maxSecPerKm)}/km`;

    let newLine = line;
    let firstMatch = "";
    newLine = newLine.replace(PACE_TOKEN_RE, (match) => {
      if (!firstMatch) firstMatch = match;
      return replacement;
    });

    if (newLine !== line) {
      changes.push({
        lineNo: i + 1,
        category,
        before: firstMatch,
        after: replacement,
        fullLineBefore: line,
        fullLineAfter: newLine,
      });
    }
    return newLine;
  });

  return { newContent: out.join("\n"), changes };
}
