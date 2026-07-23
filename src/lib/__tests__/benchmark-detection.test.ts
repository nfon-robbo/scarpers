import { describe, it, expect } from "vitest";
import {
  extractBenchmarkProtocolForDate,
  extractAllBenchmarkDates,
} from "@/lib/benchmark-token";
import {
  findBenchmarkCandidates,
  identifyEffortWindow,
  buildManualEffortWindow,
  type ActivityForDetection,
} from "@/lib/benchmark-detection";

const plan = `
### **Monday 21/07/2026** — 30-min Threshold Test [benchmark:30min]
| Segment | Duration | Target | Notes |
| Warm-up | 10 min | Z2 | 🎵 155 |
| Effort  | 30 min | Threshold | Steady all-out |
| Cool-down | 10 min | Z2 | |

**Wednesday 23/07/2026** — Easy 45 min Z2

### **Sunday 27/07/2026** — Time trial [benchmark:5k]
5 km all-out.
`;

describe("benchmark-token", () => {
  it("extracts a token declared on the day heading itself", () => {
    expect(extractBenchmarkProtocolForDate(plan, "2026-07-21")).toBe("30min");
  });
  it("returns null for a plain day", () => {
    expect(extractBenchmarkProtocolForDate(plan, "2026-07-23")).toBeNull();
  });
  it("finds a token inside a plain-heading day", () => {
    expect(extractBenchmarkProtocolForDate(plan, "2026-07-27")).toBe("5k");
  });
  it("lists every benchmark date in order", () => {
    expect(extractAllBenchmarkDates(plan)).toEqual([
      { isoDate: "2026-07-21", protocol: "30min" },
      { isoDate: "2026-07-27", protocol: "5k" },
    ]);
  });
});

// ─── Detection fixtures ─────────────────────────────────────────────────────

const scheduled = "2026-07-21";
const iso = (offsetHours: number) =>
  new Date(new Date(`${scheduled}T12:00:00Z`).getTime() + offsetHours * 3_600_000).toISOString();

const acts: ActivityForDetection[] = [
  {
    id: "A_ontime_run",
    start_time: iso(-2),                   // same day, 10:00 UTC
    duration_seconds: 48 * 60,             // 48 min → inside 40–55
    distance_meters: 9500,
    avg_heart_rate: 162,
    activity_type: "run",
    has_hr_stream: true,
  },
  {
    id: "B_next_day_run",
    start_time: iso(28),                   // +28h, still inside 48h
    duration_seconds: 42 * 60,
    distance_meters: 8000,
    avg_heart_rate: null,                  // no HR
    activity_type: "run",
    has_hr_stream: false,
  },
  {
    id: "C_too_short",
    start_time: iso(-4),
    duration_seconds: 25 * 60,             // outside window
    distance_meters: 4000,
    avg_heart_rate: 155,
    activity_type: "run",
  },
  {
    id: "D_bike",
    start_time: iso(1),
    duration_seconds: 50 * 60,
    distance_meters: 20000,
    avg_heart_rate: 140,
    activity_type: "ride",                 // not running
  },
  {
    id: "E_far_away",
    start_time: iso(72),                   // outside ±48h
    duration_seconds: 45 * 60,
    distance_meters: 8500,
    avg_heart_rate: 158,
    activity_type: "run",
  },
];

describe("findBenchmarkCandidates", () => {
  it("returns running activities inside the duration and 48h windows, nearest first", () => {
    const c = findBenchmarkCandidates({
      activities: acts, scheduledDateIso: scheduled, protocol: "30min",
    });
    expect(c.map(x => x.id)).toEqual(["A_ontime_run", "B_next_day_run"]);
    expect(c[0].hoursFromScheduled).toBeLessThan(c[1].hoursFromScheduled);
  });
  it("respects the rejection set", () => {
    const c = findBenchmarkCandidates({
      activities: acts, scheduledDateIso: scheduled, protocol: "30min",
      rejectedIds: new Set(["A_ontime_run"]),
    });
    expect(c.map(x => x.id)).toEqual(["B_next_day_run"]);
  });
});

// ─── Effort window path fixtures ────────────────────────────────────────────

describe("identifyEffortWindow — which path fires", () => {
  const durationS = 48 * 60;
  const distanceM = 9500;

  it("Path 1 fires when contiguous 30-min lap window exists", () => {
    // 5 min warm-up, 6× ~5 min work laps (~30 min), 10 min cool-down.
    const laps = [
      { lap_index: 0, elapsed_time_s: 300 },
      { lap_index: 1, elapsed_time_s: 300 },
      { lap_index: 2, elapsed_time_s: 300 },
      { lap_index: 3, elapsed_time_s: 300 },
      { lap_index: 4, elapsed_time_s: 300 },
      { lap_index: 5, elapsed_time_s: 300 },
      { lap_index: 6, elapsed_time_s: 300 },
      { lap_index: 7, elapsed_time_s: 600 },
    ];
    const w = identifyEffortWindow({
      protocol: "30min", laps, activityDurationS: durationS, activityDistanceM: distanceM,
    });
    expect(w).not.toBeNull();
    expect(w!.source).toBe("laps");
    expect(w!.durationSeconds).toBeGreaterThanOrEqual(1680);
    expect(w!.durationSeconds).toBeLessThanOrEqual(1920);
    expect(w!.note).toBeUndefined();
  });

  it("Path 2 fires when no laps present", () => {
    const w = identifyEffortWindow({
      protocol: "30min", laps: null, activityDurationS: durationS, activityDistanceM: distanceM,
    });
    expect(w!.source).toBe("derived");
    expect(w!.note).toBeUndefined();
    expect(w!.startSeconds).toBe(300);
  });

  it("Path 2 fires with a diagnostic note when laps present but no window matches", () => {
    const laps = [
      { lap_index: 0, elapsed_time_s: 600 },   // 10 min
      { lap_index: 1, elapsed_time_s: 1200 },  // 20 min
      { lap_index: 2, elapsed_time_s: 1080 },  // 18 min — no contiguous 28–32
    ];
    const w = identifyEffortWindow({
      protocol: "30min", laps, activityDurationS: durationS, activityDistanceM: distanceM,
    });
    expect(w!.source).toBe("derived");
    expect(w!.note).toMatch(/laps present.*n=3/);
  });

  it("Path 2 fires for 3k/5k protocols regardless of laps", () => {
    const w = identifyEffortWindow({
      protocol: "5k", laps: [{ lap_index: 0, elapsed_time_s: 1500 }],
      activityDurationS: 30 * 60, activityDistanceM: 5200,
    });
    expect(w!.source).toBe("derived");
    expect(w!.note).toBeUndefined(); // 3k/5k skip Path 1 entirely
  });

  it("Path 3 — manual entry", () => {
    const w = buildManualEffortWindow({
      protocol: "5k", durationSeconds: 22 * 60 + 30, distanceMeters: 5000,
    });
    expect(w.source).toBe("manual");
    expect(w.durationSeconds).toBe(22 * 60 + 30);
    expect(w.distanceMeters).toBe(5000);
  });

  it("derived window uses stream distance when provided", () => {
    // Uniform 3 m/s stream sampled every 30s across 50 min.
    const stream = Array.from({ length: 101 }, (_, i) => ({ tS: i * 30, distM: i * 30 * 3 }));
    const w = identifyEffortWindow({
      protocol: "30min", laps: null,
      activityDurationS: 50 * 60, activityDistanceM: 9000, stream,
    });
    expect(w!.source).toBe("derived");
    // 30 min @ 3 m/s = 5400 m.
    expect(Math.round(w!.distanceMeters)).toBeGreaterThanOrEqual(5300);
    expect(Math.round(w!.distanceMeters)).toBeLessThanOrEqual(5500);
  });
});
