// Pure, testable helpers mirroring the day-adjust gating logic in index.ts.
// Keep these in sync with the inline implementations in `index.ts`
// (lines ~457–615). Used by day-adjust.test.ts.

export const CADENCE_CUES: string[] = [
  "Try a 170 BPM metronome playlist today (search 'running 170 bpm' on Spotify).",
  "Focus on quicker foot turnover — imagine running on hot coals.",
  "Shorten your stride 10% while maintaining the same speed — your feet should feel lighter.",
  "Count three footfalls per second out loud for the first kilometre to lock in the rhythm.",
  "Cue 'quick, light feet' — land softly directly under your hips, not out in front.",
  "Run alongside a song at 170 BPM (e.g. 'Stayin' Alive') for the warm-up to set the pace.",
];

/** Median that filters out null/undefined/non-finite values. Returns null for empty input. */
export function median(arr: ReadonlyArray<number | null | undefined>): number | null {
  const clean = arr.filter(
    (v): v is number => v != null && Number.isFinite(v as number)
  );
  if (!clean.length) return null;
  const s = [...clean].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Poor night: (score < 60 AND duration < 7h) OR score < 50 */
export function isPoorNight(
  score: number | null | undefined,
  durationHours: number | null | undefined
): boolean {
  if (score == null) return false;
  if (score < 50) return true;
  if (score < 60 && durationHours != null && durationHours < 7) return true;
  return false;
}

export interface Night {
  sleep_score: number | null;
  sleep_duration_seconds: number | null;
}

/** Counts consecutive poor nights from the most-recent end of the array. */
export function countConsecutivePoor(nights: ReadonlyArray<Night>): number {
  let n = 0;
  for (const night of nights) {
    const hours = night.sleep_duration_seconds != null ? night.sleep_duration_seconds / 3600 : null;
    if (isPoorNight(night.sleep_score, hours)) n++;
    else break;
  }
  return n;
}

export interface YesterdayLoadInput {
  duration_seconds?: number | null;
  avg_heart_rate?: number | null;
  max_heart_rate?: number | null;
  training_load?: number | null;
}

export interface YesterdayLoad {
  hard: boolean;
  long: boolean;
  reason: string;
}

/** Classifies yesterday's activity as hard/long using explicit thresholds. */
export function classifyYesterdayLoad(
  activities: ReadonlyArray<YesterdayLoadInput>
): YesterdayLoad {
  const out: YesterdayLoad = { hard: false, long: false, reason: "" };
  for (const a of activities) {
    const dur = Number(a.duration_seconds || 0);
    const avgHr = Number(a.avg_heart_rate || 0);
    const maxHr = Number(a.max_heart_rate || 0) || 190;
    const load = Number(a.training_load || 0);
    if (dur > 5400) {
      out.long = true;
      out.reason += `duration ${(dur / 60).toFixed(0)}min; `;
    }
    if ((dur > 3600 && avgHr >= 0.85 * maxHr) || load > 150) {
      out.hard = true;
      out.reason += load > 150
        ? `training load ${load.toFixed(0)}; `
        : `${(dur / 60).toFixed(0)}min @ ${avgHr.toFixed(0)}bpm (≥85% max); `;
    }
  }
  out.reason = out.reason.trim();
  return out;
}

export type TodayIntensity = "hard" | "easy" | "rest";

/** Detects today's planned intensity from the workout markdown. */
export function detectTodayIntensity(workoutMarkdown: string | null | undefined): TodayIntensity {
  const text = (workoutMarkdown || "").toLowerCase();
  if (!text.trim() || /\brest\b/.test(text)) return "rest";
  if (/tempo|interval|threshold|race pace|vo2|hill repeat|hill repeats/.test(text)) return "hard";
  return "easy";
}

/** Pick a cadence cue. Inject a deterministic RNG for tests. */
export function pickCadenceCue(rand: () => number = Math.random): string {
  return CADENCE_CUES[Math.floor(rand() * CADENCE_CUES.length)];
}

/** Returns the escalation line for chronic poor sleep, or null if < 3 nights. */
export function buildEscalationLine(consecutivePoor: number): string | null {
  if (consecutivePoor >= 7) {
    return "⚠️ MANDATORY REST — seven consecutive poor nights indicates you need medical attention, not training.";
  }
  if (consecutivePoor >= 5) {
    return "⚠️ Sleep has been poor for 5+ nights. Prioritise rest and recovery — training is secondary right now. Consider consulting a doctor if this continues.";
  }
  if (consecutivePoor >= 3) {
    return "Third poor night in a row — identify what's disrupting your sleep (stress, caffeine, screen time).";
  }
  return null;
}

/** Training-load velocity rule: force ADJUSTED when stacking hard sessions on poor recovery. */
export function shouldForceAdjustedByLoadVelocity(input: {
  yesterdayHard: boolean;
  todayIntensity: TodayIntensity;
  lastNightPoor: boolean;
}): boolean {
  return input.yesterdayHard && input.todayIntensity === "hard" && input.lastNightPoor;
}
