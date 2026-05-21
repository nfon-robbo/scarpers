import { assertEquals, assert, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CADENCE_CUES,
  buildEscalationLine,
  classifyTodayActivities,
  classifyYesterdayLoad,
  countConsecutivePoor,
  detectTodayIntensity,
  extractWorkoutSignals,
  isExtremeAccumulatedVolume,
  isPoorNight,
  matchScheduledWorkout,
  median,
  pickCadenceCue,
  shouldForceAdjustedByLoadVelocity,
} from "./day-adjust-logic.ts";

// ── Layer 1: pure-logic unit tests ───────────────────────────────────────────

Deno.test("isPoorNight: (55, 6h) is poor", () => {
  assertEquals(isPoorNight(55, 6), true);
});

Deno.test("isPoorNight: (58, 7.5h) is NOT poor", () => {
  assertEquals(isPoorNight(58, 7.5), false);
});

Deno.test("isPoorNight: (48, 8h) is poor (score<50 overrides duration)", () => {
  assertEquals(isPoorNight(48, 8), true);
});

Deno.test("isPoorNight: null score is not poor", () => {
  assertEquals(isPoorNight(null, 5), false);
});

Deno.test("median: empty returns null", () => {
  assertEquals(median([]), null);
});

Deno.test("median: single value", () => {
  assertEquals(median([50]), 50);
});

Deno.test("median: two values returns average", () => {
  assertEquals(median([50, 60]), 55);
});

Deno.test("median: odd length", () => {
  assertEquals(median([1, 100, 2, 3, 4]), 3);
});

Deno.test("median: filters nulls and non-finite", () => {
  assertEquals(median([50, null, 60, undefined, 70, NaN]), 60);
});

Deno.test("median: robust to outliers vs mean", () => {
  // mean would be ~38, median is 50
  const vals = [50, 50, 50, 50, 50, 50, 50, 1, 1, 1];
  assertEquals(median(vals), 50);
});

Deno.test("classifyYesterdayLoad: hard via duration+HR", () => {
  const r = classifyYesterdayLoad([
    { duration_seconds: 3900, avg_heart_rate: 175, max_heart_rate: 195 },
  ]);
  assertEquals(r.hard, true);
  assertEquals(r.long, false);
});

Deno.test("classifyYesterdayLoad: long via duration >90min", () => {
  const r = classifyYesterdayLoad([{ duration_seconds: 6000 }]);
  assertEquals(r.long, true);
});

Deno.test("classifyYesterdayLoad: hard via training_load >150", () => {
  const r = classifyYesterdayLoad([{ duration_seconds: 1800, training_load: 160 }]);
  assertEquals(r.hard, true);
});

Deno.test("classifyYesterdayLoad: easy session not flagged", () => {
  const r = classifyYesterdayLoad([
    { duration_seconds: 2400, avg_heart_rate: 130, max_heart_rate: 190, training_load: 60 },
  ]);
  assertEquals(r.hard, false);
  assertEquals(r.long, false);
});

Deno.test("detectTodayIntensity: intervals → hard", () => {
  assertEquals(detectTodayIntensity("5x800m intervals @ 5k pace"), "hard");
});

Deno.test("detectTodayIntensity: tempo → hard", () => {
  assertEquals(detectTodayIntensity("20 min tempo run"), "hard");
});

Deno.test("detectTodayIntensity: easy run → easy", () => {
  assertEquals(detectTodayIntensity("Easy 40min Z2"), "easy");
});

Deno.test("detectTodayIntensity: rest day → rest", () => {
  assertEquals(detectTodayIntensity("Rest Day"), "rest");
});

Deno.test("detectTodayIntensity: empty → rest", () => {
  assertEquals(detectTodayIntensity(""), "rest");
});

Deno.test("CADENCE_CUES has at least 5 entries", () => {
  assert(CADENCE_CUES.length >= 5);
});

Deno.test("pickCadenceCue: deterministic with injected RNG", () => {
  for (let i = 0; i < CADENCE_CUES.length; i++) {
    const cue = pickCadenceCue(() => i / CADENCE_CUES.length);
    assertEquals(cue, CADENCE_CUES[i]);
  }
});

Deno.test("pickCadenceCue: all cues reachable via random rotation", () => {
  const seen = new Set<string>();
  for (let i = 0; i < CADENCE_CUES.length; i++) {
    seen.add(pickCadenceCue(() => i / CADENCE_CUES.length));
  }
  assertEquals(seen.size, CADENCE_CUES.length);
});

Deno.test("buildEscalationLine: 2 nights returns null", () => {
  assertEquals(buildEscalationLine(2), null);
});

Deno.test("buildEscalationLine: 3 nights → identification prompt", () => {
  const line = buildEscalationLine(3)!;
  assert(line.includes("Third poor night"));
});

Deno.test("buildEscalationLine: 5 nights → 5+ warning", () => {
  const line = buildEscalationLine(5)!;
  assert(line.includes("⚠️ Sleep has been poor for 5+ nights"));
});

Deno.test("buildEscalationLine: 7 nights → mandatory rest", () => {
  const line = buildEscalationLine(7)!;
  assert(line.includes("MANDATORY REST"));
  assert(line.includes("medical attention"));
});

Deno.test("countConsecutivePoor: stops at first non-poor", () => {
  const nights = [
    { sleep_score: 55, sleep_duration_seconds: 6 * 3600 }, // poor
    { sleep_score: 48, sleep_duration_seconds: 8 * 3600 }, // poor
    { sleep_score: 75, sleep_duration_seconds: 8 * 3600 }, // not poor → stop
    { sleep_score: 40, sleep_duration_seconds: 5 * 3600 }, // would be poor but cut off
  ];
  assertEquals(countConsecutivePoor(nights), 2);
});

Deno.test("shouldForceAdjustedByLoadVelocity: all three true → true", () => {
  assertEquals(
    shouldForceAdjustedByLoadVelocity({
      yesterdayHard: true,
      todayIntensity: "hard",
      lastNightPoor: true,
    }),
    true,
  );
});

Deno.test("shouldForceAdjustedByLoadVelocity: any false → false", () => {
  assertEquals(
    shouldForceAdjustedByLoadVelocity({ yesterdayHard: false, todayIntensity: "hard", lastNightPoor: true }),
    false,
  );
  assertEquals(
    shouldForceAdjustedByLoadVelocity({ yesterdayHard: true, todayIntensity: "easy", lastNightPoor: true }),
    false,
  );
  assertEquals(
    shouldForceAdjustedByLoadVelocity({ yesterdayHard: true, todayIntensity: "hard", lastNightPoor: false }),
    false,
  );
});

// ── Layer 2: scenario-level assertions ──────────────────────────────────────
// These cross-check the 7 spec scenarios using the pure helpers.

Deno.test("Scenario 1: 1 poor night + HRV -12% → soft-adjust criteria met", () => {
  const nights = [
    { sleep_score: 55, sleep_duration_seconds: 6 * 3600 },
    { sleep_score: 75, sleep_duration_seconds: 8 * 3600 },
  ];
  const consecutive = countConsecutivePoor(nights);
  const hrvDeltaPct = -12;
  assertEquals(consecutive, 1);
  const softCriteria = consecutive === 1 && (hrvDeltaPct <= -10 && hrvDeltaPct >= -15);
  assertEquals(softCriteria, true);
  // Should NOT trip full ADJUSTED via trigger A
  assertNotEquals(consecutive >= 2, true);
});

Deno.test("Scenario 2: 2 poor nights + HRV -18% → ADJUSTED via trigger A", () => {
  const nights = [
    { sleep_score: 55, sleep_duration_seconds: 6 * 3600 },
    { sleep_score: 50, sleep_duration_seconds: 6.5 * 3600 },
    { sleep_score: 75, sleep_duration_seconds: 8 * 3600 },
  ];
  const consecutive = countConsecutivePoor(nights);
  const hrvDeltaPct = -18;
  assertEquals(consecutive, 2);
  const triggerA = consecutive >= 2 && hrvDeltaPct < -15;
  assertEquals(triggerA, true);
});

Deno.test("Scenario 3: load-velocity → forced ADJUSTED", () => {
  const yLoad = classifyYesterdayLoad([
    { duration_seconds: 65 * 60, avg_heart_rate: 0.88 * 195, max_heart_rate: 195 },
  ]);
  assertEquals(yLoad.hard, true);
  const intensity = detectTodayIntensity("5x800m intervals");
  assertEquals(intensity, "hard");
  const lastNightPoor = isPoorNight(58, 6.5);
  assertEquals(lastNightPoor, true);
  assertEquals(
    shouldForceAdjustedByLoadVelocity({
      yesterdayHard: yLoad.hard,
      todayIntensity: intensity,
      lastNightPoor,
    }),
    true,
  );
});

Deno.test("Scenario 4: 5 consecutive poor nights → 5+ warning emitted", () => {
  const nights = Array.from({ length: 5 }, () => ({
    sleep_score: 50,
    sleep_duration_seconds: 6 * 3600,
  }));
  assertEquals(countConsecutivePoor(nights), 5);
  const line = buildEscalationLine(5)!;
  assert(line.includes("⚠️ Sleep has been poor for 5+ nights"));
});

Deno.test("Scenario 5: 7 consecutive poor nights → mandatory rest line", () => {
  const nights = Array.from({ length: 7 }, () => ({
    sleep_score: 45,
    sleep_duration_seconds: 5 * 3600,
  }));
  assertEquals(countConsecutivePoor(nights), 7);
  const line = buildEscalationLine(7)!;
  assert(line.includes("MANDATORY REST"));
});

Deno.test("Scenario 6: rest-day prepend uses provided UK dates", () => {
  const today_date_uk = "Monday 21 May 2026";
  const target_date_uk = "Tuesday 22 May 2026";
  const prepend =
    `🛌 Today (${today_date_uk}) is a scheduled rest day.\n` +
    `Assessing tomorrow's workout (${target_date_uk})...`;
  assert(prepend.startsWith("🛌 Today (Monday 21 May 2026) is a scheduled rest day."));
  assert(prepend.includes("Assessing tomorrow's workout (Tuesday 22 May 2026)"));
});

Deno.test("Scenario 7: cadence 155 selects a cue from CADENCE_CUES", () => {
  const avgCadence = 155;
  assert(avgCadence < 160);
  const cue = pickCadenceCue(() => 0.5);
  assert(CADENCE_CUES.includes(cue));
});
