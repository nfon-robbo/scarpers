import { describe, it, expect } from "vitest";
import { buildFitLapRows } from "@/lib/fit-lap-rows";
import { buildGarminLapRows } from "@/lib/garmin-export-import";
import { FIT_LAPS_FIXTURE } from "@/lib/__fixtures__/fit-laps.fixture";
import {
  GARMIN_EXPORT_ACTIVITY_FIXTURE,
  GARMIN_EXPORT_INSERTED,
} from "@/lib/__fixtures__/garmin-export.fixture";

/**
 * Golden-snapshot regression guard for the activity_laps insert payloads
 * produced by the two import paths. If either snapshot changes, either:
 *   a) the change is intentional and the snapshot should be updated
 *      deliberately (vitest -u) with a note in the PR describing why the
 *      column mapping or unit conversion moved, OR
 *   b) the change is a regression in activity import and must be reverted.
 *
 * These fixtures encode current behavior. FIT ascent/descent values come
 * out of fit-parser in kilometres (lengthUnit: "km") and are multiplied by
 * 1000 to store metres — this is the correct unit conversion, not a quirk.
 * All downstream consumers read total_ascent/descent as metres.
 */
describe("activity_laps insert payload — FIT path", () => {
  it("maps ParsedLap[] to insert rows byte-identically", () => {
    const rows = buildFitLapRows("user-uuid-123", "activity-uuid-abc", FIT_LAPS_FIXTURE);
    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "activity_id": "activity-uuid-abc",
          "avg_cadence": 82,
          "avg_heart_rate": 132,
          "avg_power": 210,
          "avg_speed_mps": 2.5,
          "distance_m": 1500,
          "elapsed_time_s": 600,
          "lap_index": 0,
          "lap_trigger": "manual",
          "max_heart_rate": 148,
          "max_power": 260,
          "max_speed_mps": 3.1,
          "moving_time_s": 598,
          "raw": {
            "avg_heart_rate": 132,
            "total_distance": 1.5,
            "total_elapsed_time": 600,
          },
          "source": "fit",
          "start_time": "2025-06-01T07:00:00.000Z",
          "total_ascent_m": 4000,
          "total_descent_m": 3000,
          "user_id": "user-uuid-123",
        },
        {
          "activity_id": "activity-uuid-abc",
          "avg_cadence": 90,
          "avg_heart_rate": 168,
          "avg_power": null,
          "avg_speed_mps": 4,
          "distance_m": 1200,
          "elapsed_time_s": 300,
          "lap_index": 1,
          "lap_trigger": "distance",
          "max_heart_rate": 178,
          "max_power": null,
          "max_speed_mps": 4.3,
          "moving_time_s": 300,
          "raw": {
            "lap_trigger": "distance",
            "total_distance": 1.2,
            "total_elapsed_time": 300,
          },
          "source": "fit",
          "start_time": "2025-06-01T07:10:00.000Z",
          "total_ascent_m": null,
          "total_descent_m": null,
          "user_id": "user-uuid-123",
        },
      ]
    `);
  });
});

describe("activity_laps insert payload — Garmin export path", () => {
  it("maps garmin splits to insert rows with correct unit conversions", () => {
    const rows = buildGarminLapRows(
      "user-uuid-123",
      [GARMIN_EXPORT_ACTIVITY_FIXTURE],
      GARMIN_EXPORT_INSERTED,
    );
    // Verify the interesting mapped values before the full snapshot: proves
    // the intent of each conversion (cm→m, cm/ms→m/s, ms→s).
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      source: "garmin_export",
      lap_index: 0,
      lap_trigger: null,
      elapsed_time_s: 300, // 300000 ms → 300 s
      distance_m: 1000, // 100000 cm → 1000 m
      avg_speed_mps: 3.5, // 0.35 cm/ms × 10 → 3.5 m/s
      total_ascent_m: 5, // 500 cm → 5 m
      total_descent_m: 3,
    });
    // Second split: all optional measurements missing or invalid → null.
    expect(rows[1]).toMatchObject({
      lap_index: 1,
      avg_heart_rate: null, // valid:false must be dropped
      avg_speed_mps: null,
      distance_m: null,
    });

    expect(rows).toMatchInlineSnapshot(`
      [
        {
          "activity_id": "activity-uuid-987",
          "avg_cadence": 172,
          "avg_heart_rate": 145,
          "avg_power": 220,
          "avg_speed_mps": 3.5,
          "distance_m": 1000,
          "elapsed_time_s": 300,
          "lap_index": 0,
          "lap_trigger": null,
          "max_heart_rate": 160,
          "max_power": 280,
          "max_speed_mps": 4.2,
          "moving_time_s": 298,
          "raw": {
            "measurements": [
              {
                "fieldEnum": "SUM_DURATION",
                "unitEnum": "MILLISECOND",
                "value": 300000,
              },
              {
                "fieldEnum": "SUM_MOVINGDURATION",
                "unitEnum": "MILLISECOND",
                "value": 298000,
              },
              {
                "fieldEnum": "SUM_DISTANCE",
                "unitEnum": "CENTIMETER",
                "value": 100000,
              },
              {
                "fieldEnum": "WEIGHTED_MEAN_HEARTRATE",
                "unitEnum": "BPM",
                "value": 145,
              },
              {
                "fieldEnum": "MAX_HEARTRATE",
                "unitEnum": "BPM",
                "value": 160,
              },
              {
                "fieldEnum": "WEIGHTED_MEAN_SPEED",
                "unitEnum": "CENTIMETERS_PER_MILLISECOND",
                "value": 0.35,
              },
              {
                "fieldEnum": "MAX_SPEED",
                "unitEnum": "CENTIMETERS_PER_MILLISECOND",
                "value": 0.42,
              },
              {
                "fieldEnum": "WEIGHTED_MEAN_POWER",
                "unitEnum": "WATT",
                "value": 220,
              },
              {
                "fieldEnum": "MAX_POWER",
                "unitEnum": "WATT",
                "value": 280,
              },
              {
                "fieldEnum": "WEIGHTED_MEAN_DOUBLE_CADENCE",
                "unitEnum": "BPM",
                "value": 172,
              },
              {
                "fieldEnum": "GAIN_ELEVATION",
                "unitEnum": "CENTIMETER",
                "value": 500,
              },
              {
                "fieldEnum": "LOSS_ELEVATION",
                "unitEnum": "CENTIMETER",
                "value": 300,
              },
            ],
            "messageIndex": 0,
            "startTimeGMT": 1717228800000,
            "type": 18,
          },
          "source": "garmin_export",
          "start_time": "2024-06-01T08:00:00.000Z",
          "total_ascent_m": 5,
          "total_descent_m": 3,
          "user_id": "user-uuid-123",
        },
        {
          "activity_id": "activity-uuid-987",
          "avg_cadence": null,
          "avg_heart_rate": null,
          "avg_power": null,
          "avg_speed_mps": null,
          "distance_m": null,
          "elapsed_time_s": 180,
          "lap_index": 1,
          "lap_trigger": null,
          "max_heart_rate": null,
          "max_power": null,
          "max_speed_mps": null,
          "moving_time_s": null,
          "raw": {
            "measurements": [
              {
                "fieldEnum": "SUM_DURATION",
                "unitEnum": "MILLISECOND",
                "value": 180000,
              },
              {
                "fieldEnum": "WEIGHTED_MEAN_HEARTRATE",
                "unitEnum": "BPM",
                "valid": false,
                "value": 168,
              },
            ],
            "messageIndex": 1,
            "startTimeGMT": 1717229100000,
            "type": 18,
          },
          "source": "garmin_export",
          "start_time": "2024-06-01T08:05:00.000Z",
          "total_ascent_m": null,
          "total_descent_m": null,
          "user_id": "user-uuid-123",
        },
      ]
    `);
  });

  it("skips activities with no splits or no inserted id (additive-safe)", () => {
    expect(
      buildGarminLapRows("u", [{ source_file: "x", raw_data: {} }], [{ id: "a", source_file: "x" }]),
    ).toEqual([]);
    expect(
      buildGarminLapRows("u", [GARMIN_EXPORT_ACTIVITY_FIXTURE], []),
    ).toEqual([]);
  });
});
