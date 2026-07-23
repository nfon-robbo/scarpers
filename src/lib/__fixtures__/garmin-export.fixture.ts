// Minimal Garmin Connect data-export activity JSON shape (only fields the
// splits mapper reads). Exercises the base-lap filter deliberately:
//
//   [0] type=18 (run), no lapIndexes            → KEPT (base lap, full)
//   [1] type=18 (run), no lapIndexes            → KEPT (base lap, mostly-null)
//   [2] type=3  (climb), lapIndexes=[0,1]       → DROPPED (rollup, both conditions agree)
//   [3] type=3  (climb), no lapIndexes          → DROPPED + LOGGED (disagreement: non-base type, no lapIndexes)
//
// A hypothetical "base-lap type carrying lapIndexes" disagreement does not
// appear in real data (0 rows across 41 activities) and is left uncovered
// here to keep the fixture faithful to observed shape.
export const GARMIN_EXPORT_ACTIVITY_FIXTURE = {
  source_file: "garmin_export:activity:987654321",
  raw_data: {
    garmin: {
      splits: [
        {
          type: 18,
          messageIndex: 0,
          startTimeGMT: 1717228800000, // 2024-06-01T08:00:00.000Z
          measurements: [
            { fieldEnum: "SUM_DURATION", unitEnum: "MILLISECOND", value: 300000 },
            { fieldEnum: "SUM_MOVINGDURATION", unitEnum: "MILLISECOND", value: 298000 },
            { fieldEnum: "SUM_DISTANCE", unitEnum: "CENTIMETER", value: 100000 }, // 1000m
            { fieldEnum: "WEIGHTED_MEAN_HEARTRATE", unitEnum: "BPM", value: 145 },
            { fieldEnum: "MAX_HEARTRATE", unitEnum: "BPM", value: 160 },
            { fieldEnum: "WEIGHTED_MEAN_SPEED", unitEnum: "CENTIMETERS_PER_MILLISECOND", value: 0.35 }, // 3.5 m/s
            { fieldEnum: "MAX_SPEED", unitEnum: "CENTIMETERS_PER_MILLISECOND", value: 0.42 },
            { fieldEnum: "WEIGHTED_MEAN_POWER", unitEnum: "WATT", value: 220 },
            { fieldEnum: "MAX_POWER", unitEnum: "WATT", value: 280 },
            { fieldEnum: "WEIGHTED_MEAN_DOUBLE_CADENCE", unitEnum: "BPM", value: 172 },
            { fieldEnum: "GAIN_ELEVATION", unitEnum: "CENTIMETER", value: 500 }, // 5m
            { fieldEnum: "LOSS_ELEVATION", unitEnum: "CENTIMETER", value: 300 }, // 3m
          ],
        },
        {
          type: 18,
          messageIndex: 1,
          startTimeGMT: 1717229100000, // 2024-06-01T08:05:00.000Z
          measurements: [
            { fieldEnum: "SUM_DURATION", unitEnum: "MILLISECOND", value: 180000 },
            { fieldEnum: "WEIGHTED_MEAN_HEARTRATE", unitEnum: "BPM", value: 168, valid: false }, // invalid → null
          ],
        },
        {
          // Climb rollup covering both base laps above. Must be dropped so
          // stored lap durations don't double-count against the activity.
          type: 3,
          messageIndex: 2,
          lapIndexes: [0, 1],
          startTimeGMT: 1717228800000,
          measurements: [
            { fieldEnum: "SUM_DURATION", unitEnum: "MILLISECOND", value: 480000 },
            { fieldEnum: "SUM_DISTANCE", unitEnum: "CENTIMETER", value: 180000 },
            { fieldEnum: "GAIN_ELEVATION", unitEnum: "CENTIMETER", value: 800 },
          ],
        },
        {
          // Rare: rollup-flavoured type without lapIndexes. Structural test
          // alone would let this through; enum guard drops it and the logger
          // records the disagreement.
          type: 3,
          messageIndex: 3,
          startTimeGMT: 1717229280000,
          measurements: [
            { fieldEnum: "SUM_DURATION", unitEnum: "MILLISECOND", value: 60000 },
          ],
        },
      ],
    },
  },
};

export const GARMIN_EXPORT_INSERTED = [
  { id: "activity-uuid-987", source_file: "garmin_export:activity:987654321" },
];
