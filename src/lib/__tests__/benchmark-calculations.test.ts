import { describe, it, expect } from "vitest";
import {
  BenchmarkConfig,
  thresholdPaceSecPerKm,
  formatPace,
  predict5kSeconds,
  formatDuration,
  thresholdHrFromStream,
  meanHrBeforeCutoff,
  scoreConfidence,
  type HrStreamSample,
} from "@/lib/benchmark-calculations";
import { zonesFromLthr, bpmToZone, type Zones } from "@shared/hr-zones";

describe("BenchmarkConfig", () => {
  it("exposes the tuned constants", () => {
    expect(BenchmarkConfig.PREDICTED_5K_EXPONENT).toBe(1.06);
    expect(BenchmarkConfig.LTHR_ZONE_UPPER_PCT).toEqual({ z1: 0.85, z2: 0.90, z3: 0.95, z4: 1.02 });
    expect(BenchmarkConfig.THRESHOLD_HR_WARMUP_EXCLUDE_S).toBe(600);
    expect(BenchmarkConfig.CONFIDENCE_BASE).toBe(100);
  });
});

describe("threshold pace", () => {
  it("4.2 km in 30 minutes => 7:09/km", () => {
    const secPerKm = thresholdPaceSecPerKm(4200, 30 * 60);
    // 1800 / 4.2 = 428.571…
    expect(secPerKm).toBeCloseTo(428.571, 2);
    expect(formatPace(secPerKm)).toBe("7:09/km");
  });
});

describe("predicted 5K", () => {
  it("4.2 km / 30 min at exponent 1.06 => ~36:05", () => {
    const seconds = predict5kSeconds(4200, 30 * 60);
    // Manual: 1800 * (5000/4200)^1.06 = 1800 * 1.20301… = 2165.4 s = 36:05
    expect(seconds).toBeCloseTo(2165.4, 0);
    expect(formatDuration(seconds)).toBe("36:05");
  });
});

describe("LTHR zone boundaries", () => {
  it("LTHR 165 returns all five zone boundaries in bpm", () => {
    const z = computeHrZonesFromLthr(165);
    // 165 * 0.85 = 140.25 -> 140
    // 165 * 0.90 = 148.5  -> 149 (banker's) — Math.round(148.5) = 149
    // 165 * 0.95 = 156.75 -> 157
    // 165 * 1.02 = 168.3  -> 168
    expect(z.z1).toEqual({ min: 0, max: 140 });
    expect(z.z2).toEqual({ min: 141, max: 149 });
    expect(z.z3).toEqual({ min: 150, max: 157 });
    expect(z.z4).toEqual({ min: 158, max: 168 });
    expect(z.z5).toEqual({ min: 169, max: null });
  });
});

describe("threshold HR from stream — excludes first 10 minutes", () => {
  it("first-10 avg differs sharply from final-20, only final-20 is used", () => {
    const stream: HrStreamSample[] = [];
    // Every second for 30 minutes. 0..599s @ 140bpm, 600..1799s @ 170bpm.
    for (let t = 0; t < 1800; t++) {
      stream.push({ t, hr: t < 600 ? 140 : 170 });
    }
    const firstTen = meanHrBeforeCutoff(stream);
    const threshold = thresholdHrFromStream(stream);
    expect(firstTen).toBe(140);   // proves first 10 min ARE 140
    expect(threshold).toBe(170);  // proves they were excluded
  });
});

describe("confidence score", () => {
  const baseFixture = {
    hrStreamAvailable: false,      // -30
    secondHalfSlowdown: 0.12,      // -20 (>=0.10)
    cadencePresent: true,          //   0
    gpsConfidence: "High" as const,//   0
    rpeSubmaximal: false,          //   0
    effortWindowSource: "lap" as const, // 0
  };

  it("no HR + 12% slowdown + cadence + GPS High + non-sub RPE => 50 Medium", () => {
    const r = scoreConfidence(baseFixture);
    expect(r.score).toBe(50);
    expect(r.band).toBe("Medium");
    expect(r.deductions.map((d) => d.reason).sort()).toEqual(["no_hr_stream", "second_half_slowdown"]);
  });

  it("same fixture with cadence missing => 35 Low", () => {
    const r = scoreConfidence({ ...baseFixture, cadencePresent: false });
    expect(r.score).toBe(35);
    expect(r.band).toBe("Low");
    expect(r.deductions.map((d) => d.reason).sort()).toEqual([
      "cadence_missing",
      "no_hr_stream",
      "second_half_slowdown",
    ]);
  });

  it("derived effort window applies -15", () => {
    const clean = {
      hrStreamAvailable: true,
      secondHalfSlowdown: 0.02,
      cadencePresent: true,
      gpsConfidence: "High" as const,
      rpeSubmaximal: false,
      effortWindowSource: "lap" as const,
    };
    const withLap = scoreConfidence(clean);
    const withDerived = scoreConfidence({ ...clean, effortWindowSource: "derived" });
    expect(withLap.score).toBe(100);
    expect(withDerived.score).toBe(85);
    expect(withLap.score - withDerived.score).toBe(15);
    expect(withDerived.deductions).toContainEqual({ reason: "effort_window_derived", points: 15 });
  });
});
