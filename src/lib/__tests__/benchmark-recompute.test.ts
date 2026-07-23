/**
 * Benchmark Group 3 — synthetic end-to-end assertions.
 *
 * Tests the pure modules the confirm flow depends on. Benchmark tokens are
 * NOT part of plan content anymore — benchmarks live in benchmark_results —
 * so token-survival assertions have been removed with the token machinery.
 */
import { describe, it, expect } from "vitest";
import {
  BenchmarkConfig,
  thresholdPaceSecPerKm,
  paceRangeFromThreshold,
  secPerKmToMPerSec,
  scoreConfidence,
} from "@/lib/benchmark-calculations";
import { recomputePlanPaces } from "@/lib/recompute-plan-paces";

describe("Benchmark E2E — pace + ratios", () => {
  it("computes 4:30/km threshold from a synthetic 30-min effort at 6.667 km", () => {
    const sec = thresholdPaceSecPerKm(6666.67, 30 * 60);
    expect(Math.round(sec)).toBe(270); // 4:30/km
  });

  it("converts 4:30/km → 3.7037 m/s for intervals.icu", () => {
    const m = secPerKmToMPerSec(270);
    expect(Number(m.toFixed(4))).toBe(3.7037);
  });

  it("computes easy/threshold ranges from a 4:30/km LT", () => {
    const easy = paceRangeFromThreshold(270, "easy");
    expect(Math.round(easy.minSecPerKm)).toBe(346);
    expect(Math.round(easy.maxSecPerKm)).toBe(373);
    const thr = paceRangeFromThreshold(270, "threshold");
    expect(Math.round(thr.minSecPerKm)).toBe(265);
    expect(Math.round(thr.maxSecPerKm)).toBe(275);
  });
});

describe("Benchmark E2E — plan rewrite", () => {
  const plan = [
    "# Week 3",
    "",
    "## Monday 6/10/2025",
    "Warm-up: 15 min Z1 HR 110-130",
    "Main: 30 min threshold at 4:20-4:35/km",
    "Cool-down: 10 min Z1",
    "",
    "## Tuesday 7/10/2025",
    "Easy run 60 min at 5:50-6:15/km",
    "",
    "## Wednesday 8/10/2025",
    "5K TT: full effort at 4:10-4:25/km",
    "",
    "## Thursday 9/10/2025",
    "VO2 intervals: 6x800m at 3:55-4:05/km",
  ].join("\n");

  it("rewrites session paces from a new 4:30/km LT", () => {
    const { newContent, changes } = recomputePlanPaces(plan, 270);
    expect(changes.length).toBeGreaterThanOrEqual(3);
    expect(newContent).toContain("5:46-6:13/km");
    expect(newContent).toContain("4:25-4:35/km");
    expect(newContent).toContain("3:58-4:08/km");
  });

  it("leaves HR-only warm-up/cool-down lines untouched", () => {
    const { newContent } = recomputePlanPaces(plan, 270);
    expect(newContent).toContain("Warm-up: 15 min Z1 HR 110-130");
    expect(newContent).toContain("Cool-down: 10 min Z1");
  });
});

describe("Benchmark E2E — confidence deductions", () => {
  it("returns explicit deductions when band drops", () => {
    const conf = scoreConfidence({
      hrStreamAvailable: false,
      secondHalfSlowdown: 0.15,
      cadencePresent: false,
      gpsConfidence: "Low",
      rpeSubmaximal: true,
      effortWindowSource: "derived",
      protocol: "30min",
    });
    expect(conf.band).toBe("Low");
    const reasons = conf.deductions.map((d) => d.reason);
    expect(reasons).toContain("no_hr_stream");
    expect(reasons).toContain("second_half_slowdown");
    expect(reasons).toContain("cadence_missing");
    expect(reasons).toContain("gps_low");
    expect(reasons).toContain("rpe_submaximal");
    expect(reasons).toContain("effort_window_derived");
    const total = conf.deductions.reduce((a, d) => a + d.points, 0);
    expect(conf.score).toBe(Math.max(0, BenchmarkConfig.CONFIDENCE_BASE - total));
  });
});
