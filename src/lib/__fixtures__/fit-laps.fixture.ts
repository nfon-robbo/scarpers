// Synthetic FIT-parsed laps (post-parser). Represents the ParsedLap[] shape
// that fit-parser.ts emits for a 2-lap warm-up + interval workout. Values
// were chosen to exercise every mapped field including nulls.
import type { ParsedLap } from "@/lib/fit-parser";

export const FIT_LAPS_FIXTURE: ParsedLap[] = [
  {
    lap_index: 0,
    start_time: "2025-06-01T07:00:00.000Z",
    elapsed_time_s: 600,
    moving_time_s: 598,
    distance_m: 1500,
    avg_heart_rate: 132,
    max_heart_rate: 148,
    avg_speed_mps: 2.5,
    max_speed_mps: 3.1,
    avg_cadence: 82,
    avg_power: 210,
    max_power: 260,
    total_ascent_m: 4000, // NB: fit-parser currently multiplies FIT ascent by 1000
    total_descent_m: 3000,
    lap_trigger: "manual",
    raw: { total_elapsed_time: 600, total_distance: 1.5, avg_heart_rate: 132 },
  },
  {
    lap_index: 1,
    start_time: "2025-06-01T07:10:00.000Z",
    elapsed_time_s: 300,
    moving_time_s: 300,
    distance_m: 1200,
    avg_heart_rate: 168,
    max_heart_rate: 178,
    avg_speed_mps: 4.0,
    max_speed_mps: 4.3,
    avg_cadence: 90,
    avg_power: null,
    max_power: null,
    total_ascent_m: null,
    total_descent_m: null,
    lap_trigger: "distance",
    raw: { total_elapsed_time: 300, total_distance: 1.2, lap_trigger: "distance" },
  },
];
