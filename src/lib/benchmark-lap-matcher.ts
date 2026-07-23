/**
 * Benchmark effort-window matchers (Path 1 — stored laps).
 *
 * Two matcher variants:
 *   • matchBenchmarkEffortWindow — contiguous laps summing to 28–32 min.
 *     Used for the 30-min threshold protocol.
 *   • matchLapByDistance — single lap within ±5 % of a target distance.
 *     Used for 3k / 5k time trials, where a lap boundary often marks the
 *     trial itself (auto-lap-per-km rolled into a bigger lap, or a manual
 *     lap press at start/finish).
 *
 * Rules (locked by product spec):
 *   30-min protocol
 *     - Outer gate: 40–55 min total activity. Caller enforces.
 *     - Effort window target: 28–32 minutes (1680–1920 s).
 *     - Preference among qualifying ranges: start offset closest to 300 s
 *       (5 min warm-up). Tie broken by longer duration.
 *   3k / 5k protocol
 *     - Distance match tolerance: ±5 %.
 *     - Prefer the qualifying lap whose start offset is closest to 300 s
 *       (5 min warm-up). Tie broken by tightest distance match.
 *
 * Returns null when no lap qualifies. Callers fall back to Path 2 (derived
 * from the activity stream) or Path 3 (manual).
 */

export type BenchmarkLap = {
  lap_index: number;
  elapsed_time_s: number;
  distance_m?: number | null;
};

export type BenchmarkMatch = {
  startLapIndex: number;
  endLapIndex: number;
  lapCount: number;
  startOffsetS: number;
  durationS: number;
  distanceM?: number;
};

export const BENCHMARK_EFFORT_MIN_S = 28 * 60; // 1680
export const BENCHMARK_EFFORT_MAX_S = 32 * 60; // 1920
export const BENCHMARK_PREFERRED_START_OFFSET_S = 5 * 60; // 300
export const BENCHMARK_DISTANCE_TOLERANCE = 0.05; // ±5 %

export function matchBenchmarkEffortWindow(
  laps: BenchmarkLap[],
): BenchmarkMatch | null {
  if (!Array.isArray(laps) || laps.length === 0) return null;

  const ordered = [...laps].sort((a, b) => a.lap_index - b.lap_index);

  const offsets: number[] = new Array(ordered.length + 1).fill(0);
  for (let i = 0; i < ordered.length; i++) {
    offsets[i + 1] = offsets[i] + (ordered[i].elapsed_time_s || 0);
  }

  const candidates: BenchmarkMatch[] = [];
  for (let i = 0; i < ordered.length; i++) {
    let sum = 0;
    let dist = 0;
    for (let j = i; j < ordered.length; j++) {
      sum += ordered[j].elapsed_time_s || 0;
      dist += ordered[j].distance_m || 0;
      if (sum > BENCHMARK_EFFORT_MAX_S) break;
      if (sum >= BENCHMARK_EFFORT_MIN_S) {
        candidates.push({
          startLapIndex: ordered[i].lap_index,
          endLapIndex: ordered[j].lap_index,
          lapCount: j - i + 1,
          startOffsetS: offsets[i],
          durationS: sum,
          distanceM: dist > 0 ? dist : undefined,
        });
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    const db = Math.abs(b.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    if (da !== db) return da - db;
    return b.durationS - a.durationS;
  });

  return candidates[0];
}

/**
 * Find a single lap whose distance is within ±5 % of `targetDistanceM`.
 * Used for 3k / 5k time trials. Prefers laps whose start offset is closest
 * to 300 s (5 min warm-up), then tightest distance match.
 */
export function matchLapByDistance(
  laps: BenchmarkLap[],
  targetDistanceM: number,
): BenchmarkMatch | null {
  if (!Array.isArray(laps) || laps.length === 0) return null;

  const ordered = [...laps].sort((a, b) => a.lap_index - b.lap_index);
  const offsets: number[] = new Array(ordered.length + 1).fill(0);
  for (let i = 0; i < ordered.length; i++) {
    offsets[i + 1] = offsets[i] + (ordered[i].elapsed_time_s || 0);
  }

  const min = targetDistanceM * (1 - BENCHMARK_DISTANCE_TOLERANCE);
  const max = targetDistanceM * (1 + BENCHMARK_DISTANCE_TOLERANCE);

  const candidates: Array<BenchmarkMatch & { distErr: number }> = [];
  for (let i = 0; i < ordered.length; i++) {
    const d = ordered[i].distance_m || 0;
    if (d < min || d > max) continue;
    candidates.push({
      startLapIndex: ordered[i].lap_index,
      endLapIndex: ordered[i].lap_index,
      lapCount: 1,
      startOffsetS: offsets[i],
      durationS: ordered[i].elapsed_time_s || 0,
      distanceM: d,
      distErr: Math.abs(d - targetDistanceM),
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    const db = Math.abs(b.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    if (da !== db) return da - db;
    return a.distErr - b.distErr;
  });

  const { distErr, ...rest } = candidates[0];
  return rest;
}
