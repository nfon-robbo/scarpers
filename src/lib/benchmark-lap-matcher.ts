/**
 * Benchmark effort-window matcher (Path 1 — stored laps).
 *
 * Purpose: given the laps for a completed 30-minute threshold benchmark
 * activity, locate the contiguous run of laps that constitutes the
 * 30-minute effort itself (bracketed by a ~5 min warm-up and ~10 min
 * cool-down).
 *
 * Rules — locked by product spec:
 *   - Total activity duration outer gate: 40–55 min. Caller enforces this
 *     before invoking; the matcher does NOT re-check activity duration and
 *     will run against any lap array. This keeps the matcher pure and
 *     testable in isolation.
 *   - Effort window target: 28–32 minutes (1680–1920 s) sum of
 *     elapsed_time_s across a contiguous lap range.
 *   - No `lap_trigger` filter — auto-lap by distance is the primary
 *     expected fixture (~6× 1 km laps for a 30 min effort). Single-lap
 *     effort (one lap in the 28–32 min band) is the secondary case and is
 *     handled by the same algorithm (contiguous range of length 1).
 *   - Preference among qualifying ranges: the one whose start offset from
 *     the beginning of the activity is closest to 300 s (5 min warm-up).
 *   - Ties on offset distance broken by longer duration (closer to 30 min
 *     mid-point wins nothing extra — closer-to-300s wins outright first).
 *
 * Returns null when no contiguous range falls in [1680, 1920] s. Callers
 * fall back to Path 2 (Strava lazy fetch) or Path 3 (derived window).
 */

export type BenchmarkLap = {
  lap_index: number;
  elapsed_time_s: number;
};

export type BenchmarkMatch = {
  startLapIndex: number;
  endLapIndex: number;
  lapCount: number;
  startOffsetS: number;
  durationS: number;
};

export const BENCHMARK_EFFORT_MIN_S = 28 * 60; // 1680
export const BENCHMARK_EFFORT_MAX_S = 32 * 60; // 1920
export const BENCHMARK_PREFERRED_START_OFFSET_S = 5 * 60; // 300

export function matchBenchmarkEffortWindow(
  laps: BenchmarkLap[],
): BenchmarkMatch | null {
  if (!Array.isArray(laps) || laps.length === 0) return null;

  // Laps are assumed already ordered by lap_index. Copy-sort defensively
  // so callers passing an out-of-order array still get a correct answer.
  const ordered = [...laps].sort((a, b) => a.lap_index - b.lap_index);

  // Precompute cumulative start offsets so we can O(1) any range's start.
  // offsets[i] = sum of elapsed_time_s for laps 0..i-1
  const offsets: number[] = new Array(ordered.length + 1).fill(0);
  for (let i = 0; i < ordered.length; i++) {
    offsets[i + 1] = offsets[i] + (ordered[i].elapsed_time_s || 0);
  }

  const candidates: BenchmarkMatch[] = [];
  for (let i = 0; i < ordered.length; i++) {
    let sum = 0;
    for (let j = i; j < ordered.length; j++) {
      sum += ordered[j].elapsed_time_s || 0;
      if (sum > BENCHMARK_EFFORT_MAX_S) break; // extending only grows sum
      if (sum >= BENCHMARK_EFFORT_MIN_S) {
        candidates.push({
          startLapIndex: ordered[i].lap_index,
          endLapIndex: ordered[j].lap_index,
          lapCount: j - i + 1,
          startOffsetS: offsets[i],
          durationS: sum,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    const db = Math.abs(b.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    if (da !== db) return da - db;
    // Tie-break: longer wins (closer to full 30 min effort).
    return b.durationS - a.durationS;
  });

  return candidates[0];
}
