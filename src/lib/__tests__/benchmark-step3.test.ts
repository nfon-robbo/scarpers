import { describe, it, expect } from "vitest";
import {
  matchBenchmarkEffortWindow,
  type BenchmarkLap,
} from "@/lib/benchmark-lap-matcher";
import {
  findFuzzyMatch,
  buildEnrichmentPatch,
  formatEnrichmentDiff,
} from "@/lib/activity-fuzzy-merge";

// ---------- Benchmark matcher fixtures ----------

// Primary: 45 min activity, 5 min WU + 30× ~1 km auto-laps summing to
// ~1800 s + 10 min CD. Auto-lap-by-distance produces ~6 laps of ~300 s
// each inside the effort. Realistic watch behavior.
const MULTI_LAP_45MIN: BenchmarkLap[] = [
  { lap_index: 0, elapsed_time_s: 300 }, // warm-up
  { lap_index: 1, elapsed_time_s: 305 }, // effort km1
  { lap_index: 2, elapsed_time_s: 298 }, // effort km2
  { lap_index: 3, elapsed_time_s: 302 }, // effort km3
  { lap_index: 4, elapsed_time_s: 297 }, // effort km4
  { lap_index: 5, elapsed_time_s: 300 }, // effort km5
  { lap_index: 6, elapsed_time_s: 298 }, // effort km6 (sum 1800)
  { lap_index: 7, elapsed_time_s: 600 }, // cool-down
];

// Secondary: single 30 min effort lap (manual lap on the watch).
const SINGLE_LAP_45MIN: BenchmarkLap[] = [
  { lap_index: 0, elapsed_time_s: 300 },
  { lap_index: 1, elapsed_time_s: 1800 },
  { lap_index: 2, elapsed_time_s: 600 },
];

// Preference tie: two qualifying ranges, one starts near 5 min mark, the
// other near 15 min mark. Matcher must pick the one closer to 300 s.
const TWO_CANDIDATE_RANGES: BenchmarkLap[] = [
  { lap_index: 0, elapsed_time_s: 300 }, // WU
  { lap_index: 1, elapsed_time_s: 1700 }, // candidate A: starts@300, dur=1700
  { lap_index: 2, elapsed_time_s: 100 }, // extends A to 1800
  { lap_index: 3, elapsed_time_s: 100 },
  { lap_index: 4, elapsed_time_s: 1750 }, // candidate B: starts@2200, dur=1750
];

// Nothing qualifies.
const NO_QUALIFYING: BenchmarkLap[] = [
  { lap_index: 0, elapsed_time_s: 600 },
  { lap_index: 1, elapsed_time_s: 900 }, // 15 min — too short even summed with neighbors
  { lap_index: 2, elapsed_time_s: 100 },
];

describe("matchBenchmarkEffortWindow", () => {
  it("multi-lap primary: finds 6-lap 1800s run starting at 300s", () => {
    const m = matchBenchmarkEffortWindow(MULTI_LAP_45MIN);
    expect(m).toEqual({
      startLapIndex: 1,
      endLapIndex: 6,
      lapCount: 6,
      startOffsetS: 300,
      durationS: 1800,
    });
  });

  it("single-lap secondary: finds the one 1800s lap", () => {
    const m = matchBenchmarkEffortWindow(SINGLE_LAP_45MIN);
    expect(m).toEqual({
      startLapIndex: 1,
      endLapIndex: 1,
      lapCount: 1,
      startOffsetS: 300,
      durationS: 1800,
    });
  });

  it("prefers the qualifying range starting closest to 5 min", () => {
    const m = matchBenchmarkEffortWindow(TWO_CANDIDATE_RANGES);
    // Range A (start=300, closest to preferred 300) wins over B (start=2200).
    expect(m?.startOffsetS).toBe(300);
    expect(m?.startLapIndex).toBe(1);
  });

  it("returns null when no contiguous run falls in 28–32 min", () => {
    expect(matchBenchmarkEffortWindow(NO_QUALIFYING)).toBeNull();
    expect(matchBenchmarkEffortWindow([])).toBeNull();
  });
});

// ---------- Fuzzy merge fixtures ----------

const EXISTING = {
  id: "existing-uuid",
  user_id: "u",
  start_time: "2025-06-01T07:00:00.000Z",
  activity_type: "run",
  duration_s: 2700,
  distance_m: 8000,
  avg_heart_rate: null, // Strava didn't record HR
  avg_cadence: null,
  source: "strava",
  source_file: "strava:12345",
  created_at: "2025-06-01T08:00:00.000Z",
};

describe("findFuzzyMatch", () => {
  it("matches when start within 15 min, same type, duration within 2 min", () => {
    const incoming = {
      start_time: "2025-06-01T07:12:00.000Z", // +12 min (inside widened window)
      activity_type: "run",
      duration_s: 2760, // +60 s
    };
    const m = findFuzzyMatch(incoming, [EXISTING]);
    expect(m).not.toBeNull();
    expect(m!.candidate.id).toBe("existing-uuid");
    expect(m!.startDeltaS).toBe(720);
    expect(m!.durationDeltaS).toBe(60);
  });

  it("rejects when start delta > 15 min", () => {
    const incoming = {
      start_time: "2025-06-01T07:16:00.000Z",
      activity_type: "run",
      duration_s: 2700,
    };
    expect(findFuzzyMatch(incoming, [EXISTING])).toBeNull();
  });

  it("rejects when activity_type differs (even inside start window)", () => {
    const incoming = {
      start_time: "2025-06-01T07:00:00.000Z",
      activity_type: "ride",
      duration_s: 2700,
    };
    expect(findFuzzyMatch(incoming, [EXISTING])).toBeNull();
  });

  it("rejects when duration delta > 2 min (guards different sessions in same window)", () => {
    const incoming = {
      start_time: "2025-06-01T07:00:00.000Z",
      activity_type: "run",
      duration_s: 3000, // +5 min
    };
    expect(findFuzzyMatch(incoming, [EXISTING])).toBeNull();
  });

  it("picks the closest candidate by start delta", () => {
    const far = { ...EXISTING, id: "far", start_time: "2025-06-01T07:04:30.000Z" };
    const near = { ...EXISTING, id: "near", start_time: "2025-06-01T07:00:30.000Z" };
    const incoming = {
      start_time: "2025-06-01T07:00:00.000Z",
      activity_type: "run",
      duration_s: 2700,
    };
    const m = findFuzzyMatch(incoming, [far, near]);
    expect(m!.candidate.id).toBe("near");
  });
});

describe("buildEnrichmentPatch", () => {
  it("fills only null fields, never overwrites non-null", () => {
    const incoming = {
      distance_m: 8500, // existing has 8000 — must NOT overwrite
      avg_heart_rate: 152, // existing null → fill
      avg_cadence: 176, // existing null → fill
      activity_type: "trail-run", // existing "run" → must NOT overwrite
    };
    const { patch, filledFields } = buildEnrichmentPatch(EXISTING, incoming);
    expect(patch).toEqual({ avg_heart_rate: 152, avg_cadence: 176 });
    expect(filledFields.sort()).toEqual(["avg_cadence", "avg_heart_rate"]);
  });

  it("skips protected fields (id, user_id, source, timestamps) even if null", () => {
    const bare = {
      id: "x",
      user_id: null,
      source: null,
      source_file: null,
      created_at: null,
      updated_at: null,
      distance_m: null,
    };
    const { patch, filledFields } = buildEnrichmentPatch(bare, {
      user_id: "shouldnotwrite",
      source: "fit",
      distance_m: 5000,
    });
    expect(patch).toEqual({ distance_m: 5000 });
    expect(filledFields).toEqual(["distance_m"]);
  });

  it("ignores incoming null/undefined values", () => {
    const { patch, filledFields } = buildEnrichmentPatch(EXISTING, {
      avg_heart_rate: null,
      avg_cadence: undefined,
    });
    expect(patch).toEqual({});
    expect(filledFields).toEqual([]);
  });
});

describe("formatEnrichmentDiff", () => {
  it("logs filled fields", () => {
    expect(formatEnrichmentDiff("a1", ["avg_heart_rate", "avg_cadence"])).toBe(
      "[fuzzy-merge] activity=a1 filled=avg_heart_rate,avg_cadence",
    );
  });
  it("logs the no-op case", () => {
    expect(formatEnrichmentDiff("a1", [])).toBe(
      "[fuzzy-merge] activity=a1 no null fields to enrich",
    );
  });
});
