import { describe, expect, it } from "vitest";
// Test imports the internal pure resolver directly. Production code cannot
// reach `resolveZones` — it is not exported from `./hr-zones.ts`. If a real
// call site ever needs `resolveZones`, add a named exception in `hr-zones.ts`
// instead of importing from this internal path.
import { resolveZones } from "./hr-zones-internal.ts";

describe("resolveZones (internal)", () => {
  it("prefers a measured LTHR over everything else", () => {
    const z = resolveZones({ measuredLthr: 170, ageYears: 45, activities: [] });
    expect(z.lthr).toBe(170);
    expect(z.lthrSource).toBe("measured");
  });

  it("uses corroborated observed max when present", () => {
    const z = resolveZones({
      ageYears: 45,
      activities: [
        { id: "a", max_heart_rate: 186, start_time: "2026-02-09", activity_type: "run" },
        { id: "b", max_heart_rate: 184, start_time: "2026-01-20", activity_type: "run" },
      ],
    });
    expect(z.maxHr).toBe(186);
    expect(z.maxHrSource).toBe("observed_corroborated");
    expect(z.lthr).toBe(166); // round(186 * 0.89)
    expect(z.z2Max).toBe(149);
    expect(z.z4Max).toBe(169);
  });

  it("falls back to 220 - age when no corroborated observation exists", () => {
    const z = resolveZones({ ageYears: 45, activities: [{ max_heart_rate: 186, start_time: "2026-02-09" }] });
    expect(z.maxHr).toBe(175);
    expect(z.maxHrSource).toBe("age");
  });

  it("ignores walk/hike activities when computing observed max", () => {
    const z = resolveZones({
      ageYears: 45,
      activities: [
        { max_heart_rate: 195, start_time: "2026-02-01", activity_type: "walk" },
        { max_heart_rate: 194, start_time: "2026-01-25", activity_type: "hike" },
        { max_heart_rate: 180, start_time: "2026-02-05", activity_type: "run" },
        { max_heart_rate: 178, start_time: "2026-01-30", activity_type: "run" },
      ],
    });
    expect(z.maxHr).toBe(180);
  });

  it("rejects singleton readings above IMPLAUSIBLE_MAX_HR", () => {
    const z = resolveZones({
      ageYears: 45,
      activities: [
        { max_heart_rate: 215, start_time: "2026-02-01", activity_type: "run" },
        { max_heart_rate: 175, start_time: "2026-01-30", activity_type: "run" },
      ],
    });
    expect(z.maxHrSource).toBe("age");
  });
});
