/**
 * Benchmark placement.
 *
 * Injects `[benchmark:30min]` on the FINAL training-day heading within the
 * first 7 days of the plan (week 1). Idempotent — if the token is already
 * present anywhere in the plan, the plan is returned unchanged.
 *
 * Never throws — returns the input on any parse failure so plan creation
 * is never blocked.
 */

const DAY_HEADING_RE = /^(###\s+\*\*[^*]*?(\d{2})\/(\d{2})\/(\d{4})[^*]*\*\*.*)$/;

export function placeWeek1Benchmark(
  markdown: string,
  planStartIso: string,
): string {
  if (!markdown) return markdown;
  if (/\[benchmark:(30min|3k|5k)\]/i.test(markdown)) return markdown;

  try {
    const start = new Date(`${planStartIso}T12:00:00Z`);
    const week1End = new Date(start.getTime() + 6 * 86400_000);
    const lines = markdown.split("\n");
    let lastWeek1Idx = -1;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(DAY_HEADING_RE);
      if (!m) continue;
      const iso = `${m[4]}-${m[3]}-${m[2]}`;
      const d = new Date(`${iso}T12:00:00Z`);
      if (d < start) continue;
      if (d > week1End) break;
      // Skip rest / cross-training / mobility-only days if the heading text
      // clearly signals no run. The benchmark must be a running session.
      const restLike = /\b(rest\s*day|cross[-\s]?train|mobility only|off day)\b/i.test(lines[i]);
      if (restLike) continue;
      lastWeek1Idx = i;
    }
    if (lastWeek1Idx < 0) return markdown;
    lines[lastWeek1Idx] = lines[lastWeek1Idx].replace(/\s*$/, "") + " [benchmark:30min]";
    return lines.join("\n");
  } catch (e) {
    console.warn("placeWeek1Benchmark failed; leaving plan unchanged", e);
    return markdown;
  }
}
