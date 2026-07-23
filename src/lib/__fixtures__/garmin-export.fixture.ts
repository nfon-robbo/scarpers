// Minimal Garmin Connect data-export activity JSON shape (only fields the
// splits mapper reads). Two splits: one "full", one with mostly missing
// measurements so nulls are exercised.
export const GARMIN_EXPORT_ACTIVITY_FIXTURE = {
  source_file: "garmin_export:activity:987654321",
  raw_data: {
    garmin: {
      splits: [
        {
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
          messageIndex: 1,
          startTimeGMT: 1717229100000, // 2024-06-01T08:05:00.000Z
          measurements: [
            { fieldEnum: "SUM_DURATION", unitEnum: "MILLISECOND", value: 180000 },
            { fieldEnum: "WEIGHTED_MEAN_HEARTRATE", unitEnum: "BPM", value: 168, valid: false }, // invalid → null
          ],
        },
      ],
    },
  },
};

export const GARMIN_EXPORT_INSERTED = [
  { id: "activity-uuid-987", source_file: "garmin_export:activity:987654321" },
];
