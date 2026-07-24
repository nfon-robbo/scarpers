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
 *     - Effort window target: 28–32 minutes (1680–1920 s) of elapsed step time.
 *       Timer-stopped time is still subtracted from the returned moving duration.
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
  /** Optional — when present, effort-window duration is summed from this
   *  (excludes timer-stopped time). Falls back to elapsed_time_s. */
  moving_time_s?: number | null;
  distance_m?: number | null;
  avg_heart_rate?: number | null;
};

export type BenchmarkMatch = {
  startLapIndex: number;
  endLapIndex: number;
  lapCount: number;
  startOffsetS: number;
  /** Preferred (moving) duration when moving_time_s was available on the laps. */
  durationS: number;
  /** Elapsed duration for the same window (>= durationS). */
  elapsedS?: number;
  /** Total timer-stopped time inside the window (elapsedS - durationS). */
  stoppedS?: number;
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

  // The benchmark workout step is prescribed as a 30 minute elapsed block.
  // Therefore the 28-32 min matcher must use elapsed lap time to find the
  // workout step. Once found, the returned performance duration remains
  // MOVING time so timer stops do not inflate threshold pace. This prevents
  // stopped efforts from failing the step match and then expanding into
  // warm-up/cool-down laps just to reach 28 minutes of moving time.
  const movingOf = (l: BenchmarkLap): number => {
    const mv = l.moving_time_s;
    if (typeof mv === "number" && mv > 0) return mv;
    return l.elapsed_time_s || 0;
  };

  const offsets: number[] = new Array(ordered.length + 1).fill(0);
  for (let i = 0; i < ordered.length; i++) {
    // Offsets stay in ELAPSED so startOffsetS on the returned window matches
    // wall-clock time from activity start.
    offsets[i + 1] = offsets[i] + (ordered[i].elapsed_time_s || 0);
  }

  const candidates: BenchmarkMatch[] = [];
  for (let i = 0; i < ordered.length; i++) {
    let moving = 0;
    let elapsed = 0;
    let dist = 0;
    for (let j = i; j < ordered.length; j++) {
      moving += movingOf(ordered[j]);
      elapsed += ordered[j].elapsed_time_s || 0;
      dist += ordered[j].distance_m || 0;
      if (elapsed > BENCHMARK_EFFORT_MAX_S) break;
      if (elapsed >= BENCHMARK_EFFORT_MIN_S) {
        const candidate: BenchmarkMatch = {
          startLapIndex: ordered[i].lap_index,
          endLapIndex: ordered[j].lap_index,
          lapCount: j - i + 1,
          startOffsetS: offsets[i],
          durationS: moving,
        };
        if (Math.abs(elapsed - moving) > 0.001) {
          candidate.elapsedS = elapsed;
          candidate.stoppedS = Math.max(0, elapsed - moving);
        }
        if (dist > 0) candidate.distanceM = dist;
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = Math.abs(a.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    const db = Math.abs(b.startOffsetS - BENCHMARK_PREFERRED_START_OFFSET_S);
    if (da !== db) return da - db;
    const elapsedA = a.elapsedS ?? a.durationS;
    const elapsedB = b.elapsedS ?? b.durationS;
    return elapsedB - elapsedA;
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
