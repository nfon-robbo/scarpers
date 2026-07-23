/**
 * Benchmark token parsing.
 *
 * Plan markdown may tag a specific day with `[benchmark:30min]`, `[benchmark:3k]`,
 * or `[benchmark:5k]`. This module extracts the protocol for a given ISO date
 * (YYYY-MM-DD) from the plan content and strips the token for display.
 */

export type BenchmarkProtocol = "30min" | "3k" | "5k";

export const BENCHMARK_TOKEN_RE = /\[benchmark:(30min|3k|5k)\]/i;

const DAY_HEADING_RE =
  /^\s*(?:#{1,6}\s+)?\**\s*([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/;

function dmyToIso(dmy: string): string {
  const [d, m, y] = dmy.split("/");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Extract the benchmark protocol scheduled on `isoDate` (YYYY-MM-DD), if any.
 * Scans the day block from its heading up to the next day heading.
 */
export function extractBenchmarkProtocolForDate(
  planContent: string | null | undefined,
  isoDate: string
): BenchmarkProtocol | null {
  if (!planContent) return null;
  const lines = planContent.split("\n");
  let inTarget = false;
  for (const line of lines) {
    const m = line.match(DAY_HEADING_RE);
    if (m) {
      const iso = dmyToIso(m[2]);
      inTarget = iso === isoDate;
      if (inTarget) {
        const tokenOnHeading = line.match(BENCHMARK_TOKEN_RE);
        if (tokenOnHeading) return tokenOnHeading[1].toLowerCase() as BenchmarkProtocol;
      }
      continue;
    }
    if (!inTarget) continue;
    const tok = line.match(BENCHMARK_TOKEN_RE);
    if (tok) return tok[1].toLowerCase() as BenchmarkProtocol;
  }
  return null;
}

/**
 * Return all `{ isoDate, protocol }` pairs found in the plan.
 */
export function extractAllBenchmarkDates(
  planContent: string | null | undefined
): Array<{ isoDate: string; protocol: BenchmarkProtocol }> {
  if (!planContent) return [];
  const lines = planContent.split("\n");
  const out: Array<{ isoDate: string; protocol: BenchmarkProtocol }> = [];
  let currentIso: string | null = null;
  let recorded = false;
  for (const line of lines) {
    const m = line.match(DAY_HEADING_RE);
    if (m) {
      currentIso = dmyToIso(m[2]);
      recorded = false;
    }
    if (!currentIso || recorded) continue;
    const tok = line.match(BENCHMARK_TOKEN_RE);
    if (tok) {
      out.push({ isoDate: currentIso, protocol: tok[1].toLowerCase() as BenchmarkProtocol });
      recorded = true;
    }
  }
  return out;
}

/**
 * Return the expected total duration window (seconds) for an activity to be
 * considered a candidate for this protocol.
 */
export function protocolDurationWindow(
  protocol: BenchmarkProtocol
): { minSeconds: number; maxSeconds: number } {
  switch (protocol) {
    case "30min":
      // 40–55 min total run wrapping a ~30 min effort with warm-up/cool-down.
      return { minSeconds: 40 * 60, maxSeconds: 55 * 60 };
    case "3k":
      // Fast enough that the whole session sits inside ~20–45 min.
      return { minSeconds: 20 * 60, maxSeconds: 45 * 60 };
    case "5k":
      return { minSeconds: 25 * 60, maxSeconds: 55 * 60 };
  }
}
