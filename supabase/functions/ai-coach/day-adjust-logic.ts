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

// ── Today's-activity awareness ───────────────────────────────────────────────

export const EXTREME_DAY_VOLUME = { minutes: 90, km: 15 } as const;

/**
 * Absolute-tolerance floor for short planned workouts. Short workouts must
 * match within these absolute deltas regardless of percentage — prevents a
 * warm-up or shake-out from being misidentified as the planned session.
 */
export const MATCH_FLOOR = { distanceKm: 0.75, durationMin: 5 } as const;
export const SHORT_THRESHOLD = { distanceKm: 7.5, durationMin: 50 } as const;

export type Discipline = "run" | "bike" | "swim" | "other";

export interface WorkoutSignals {
  distanceKm: number | null;
  durationMin: number | null;
  discipline: Discipline;
  keywords: string[];
}

/** Extract distance, duration, discipline & keywords from a planned-workout markdown blob. */
export function extractWorkoutSignals(plannedWorkoutText: string | null | undefined): WorkoutSignals {
  const text = String(plannedWorkoutText || "");
  const lower = text.toLowerCase();

  // Distance (first km / mile mention). Convert miles → km.
  let distanceKm: number | null = null;
  const kmMatch = lower.match(/(\d+(?:\.\d+)?)\s*k(?:m|ilometre|ilometer)?s?\b/);
  const miMatch = lower.match(/(\d+(?:\.\d+)?)\s*mi(?:les?|\b)/);
  if (kmMatch) distanceKm = parseFloat(kmMatch[1]);
  else if (miMatch) distanceKm = parseFloat(miMatch[1]) * 1.60934;

  // Duration: prefer "Total: Xmin" or "X min/minutes/hr".
  let durationMin: number | null = null;
  const totalMatch = lower.match(/total[^0-9]*(\d+)\s*(?:min|m)\b/);
  const hrMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:hr|hour|hours|h)\b/);
  const minMatch = lower.match(/(\d+)\s*(?:min|minute|minutes)\b/);
  if (totalMatch) durationMin = parseInt(totalMatch[1], 10);
  else if (hrMatch) durationMin = Math.round(parseFloat(hrMatch[1]) * 60);
  else if (minMatch) durationMin = parseInt(minMatch[1], 10);

  // Discipline
  let discipline: Discipline = "run";
  if (/\b(cycle|cycling|bike|ride|spin)\b/.test(lower)) discipline = "bike";
  else if (/\b(swim|swimming|pool)\b/.test(lower)) discipline = "swim";
  else if (!/\b(run|jog|tempo|interval|threshold|easy|long|recovery|race|hill|fartlek|track)\b/.test(lower)
           && !/^run|\brun\b/.test(lower)) {
    discipline = "other";
  }

  // Keywords (intensity / session-type words)
  const keywordList = [
    "tempo", "interval", "intervals", "threshold", "race pace", "vo2", "hill",
    "hill repeats", "fartlek", "easy", "recovery", "long", "progression",
    "track", "strides", "warm-up", "cool-down",
  ];
  const keywords = keywordList.filter((kw) => lower.includes(kw));

  return { distanceKm, durationMin, discipline, keywords };
}

export interface TodayActivityInput {
  id?: string | null;
  activity_id?: string | null;
  activity_type?: string | null;
  distance_meters?: number | null;
  duration_seconds?: number | null;
  avg_heart_rate?: number | null;
  start_time?: string | null;
  name?: string | null;
  raw_data?: Record<string, unknown> | null;
}

function pctDiff(a: number, b: number): number {
  if (b === 0) return Infinity;
  return Math.abs(a - b) / b;
}

function disciplineMatches(activityType: string | null | undefined, signal: Discipline): boolean {
  const t = String(activityType || "").toLowerCase();
  if (!t) return signal === "run" || signal === "other";
  if (signal === "run") return /run|jog|treadmill/.test(t);
  if (signal === "bike") return /bike|cycl|ride/.test(t);
  if (signal === "swim") return /swim/.test(t);
  return true;
}

export interface MatchResult {
  matched: boolean;
  reason: string;
}

/** Match an activity against the planned-workout signals (±20% on each present signal). */
export function matchScheduledWorkout(
  activity: TodayActivityInput,
  signals: WorkoutSignals,
): MatchResult {
  const distKm = activity.distance_meters != null ? Number(activity.distance_meters) / 1000 : null;
  const durMin = activity.duration_seconds != null ? Number(activity.duration_seconds) / 60 : null;

  if (!disciplineMatches(activity.activity_type, signals.discipline)) {
    return { matched: false, reason: `discipline mismatch (${activity.activity_type} vs ${signals.discipline})` };
  }

  // Hard-session guard: if the plan calls for a hard session, the activity
  // must mention a matching keyword in its name — otherwise an easy run of
  // similar distance would be falsely matched as "completed".
  const HARD_KEYWORDS = ["tempo", "interval", "intervals", "threshold", "vo2", "hill", "hill repeats", "fartlek", "race pace"];
  const plannedHard = signals.keywords.some((k) => HARD_KEYWORDS.includes(k));
  const activityName = String(
    activity.name
      || (activity.raw_data && (activity.raw_data as any).name)
      || (activity.raw_data && (activity.raw_data as any).title)
      || (activity.raw_data && (activity.raw_data as any).activity_name)
      || "",
  ).toLowerCase();
  if (plannedHard && !HARD_KEYWORDS.some((kw) => activityName.includes(kw))) {
    return { matched: false, reason: "planned hard session but activity name has no matching keyword" };
  }

  const checks: string[] = [];
  let signalCount = 0;
  let okCount = 0;

  if (signals.distanceKm != null && distKm != null) {
    signalCount++;
    const absDelta = Math.abs(distKm - signals.distanceKm);
    const pct = pctDiff(distKm, signals.distanceKm);
    const isShort = signals.distanceKm < SHORT_THRESHOLD.distanceKm;
    const pass = isShort
      ? absDelta <= MATCH_FLOOR.distanceKm
      : pct <= 0.20;
    if (pass) { okCount++; checks.push(`distance ✓ (${distKm.toFixed(1)}/${signals.distanceKm.toFixed(1)}km, Δ${absDelta.toFixed(2)}km, ${(pct*100).toFixed(0)}%)`); }
    else checks.push(`distance ✗ (${distKm.toFixed(1)}/${signals.distanceKm.toFixed(1)}km, Δ${absDelta.toFixed(2)}km${isShort ? ` exceeds floor ${MATCH_FLOOR.distanceKm}km for short workout` : `, ${(pct*100).toFixed(0)}% exceeds 20%`})`);
  }
  if (signals.durationMin != null && durMin != null) {
    signalCount++;
    const absDelta = Math.abs(durMin - signals.durationMin);
    const pct = pctDiff(durMin, signals.durationMin);
    const isShort = signals.durationMin < SHORT_THRESHOLD.durationMin;
    const pass = isShort
      ? absDelta <= MATCH_FLOOR.durationMin
      : pct <= 0.20;
    if (pass) { okCount++; checks.push(`duration ✓ (${durMin.toFixed(0)}/${signals.durationMin}min, Δ${absDelta.toFixed(0)}min, ${(pct*100).toFixed(0)}%)`); }
    else checks.push(`duration ✗ (${durMin.toFixed(0)}/${signals.durationMin}min, Δ${absDelta.toFixed(0)}min${isShort ? ` exceeds floor ${MATCH_FLOOR.durationMin}min for short workout` : `, ${(pct*100).toFixed(0)}% exceeds 20%`})`);
  }

  // Fuzzy name match (soft): if any planned keyword appears in activity name/raw title.
  const name = String(
    activity.name
      || (activity.raw_data && (activity.raw_data as any).name)
      || (activity.raw_data && (activity.raw_data as any).title)
      || (activity.raw_data && (activity.raw_data as any).activity_name)
      || "",
  ).toLowerCase();
  const nameKeywordHit = signals.keywords.find((kw) => name.includes(kw));

  // Decision: every present signal must pass ±20%. Soft override: if no
  // distance/duration signals but name keyword hits, accept.
  if (signalCount === 0) {
    if (nameKeywordHit) return { matched: true, reason: `name keyword "${nameKeywordHit}" matched` };
    return { matched: false, reason: "no signals to match" };
  }
  const matched = okCount === signalCount;
  if (matched) return { matched: true, reason: checks.join("; ") };
  if (nameKeywordHit && okCount >= 1) {
    return { matched: true, reason: `${checks.join("; ")}; name keyword "${nameKeywordHit}"` };
  }
  return { matched: false, reason: checks.join("; ") };
}

export type TodayStatus = "SCHEDULED_WORKOUT_COMPLETED" | "EXTRA_ACTIVITY" | "NONE";

export interface TodayTotals {
  count: number;
  totalDistanceKm: number;
  totalDurationMin: number;
}

export interface TodayClassification {
  status: TodayStatus;
  totals: TodayTotals;
  matchedActivity: TodayActivityInput | null;
  others: TodayActivityInput[];
}

export function classifyTodayActivities(
  activities: ReadonlyArray<TodayActivityInput>,
  plannedWorkoutText: string | null | undefined,
): TodayClassification {
  const totals: TodayTotals = { count: 0, totalDistanceKm: 0, totalDurationMin: 0 };
  for (const a of activities) {
    totals.count++;
    totals.totalDistanceKm += Number(a.distance_meters || 0) / 1000;
    totals.totalDurationMin += Number(a.duration_seconds || 0) / 60;
  }

  if (activities.length === 0) {
    return { status: "NONE", totals, matchedActivity: null, others: [] };
  }

  const signals = extractWorkoutSignals(plannedWorkoutText);
  let matched: TodayActivityInput | null = null;
  const others: TodayActivityInput[] = [];
  for (const a of activities) {
    if (!matched && matchScheduledWorkout(a, signals).matched) matched = a;
    else others.push(a);
  }

  if (matched) {
    return { status: "SCHEDULED_WORKOUT_COMPLETED", totals, matchedActivity: matched, others };
  }
  return { status: "EXTRA_ACTIVITY", totals, matchedActivity: null, others: [...activities] };
}

export function isExtremeAccumulatedVolume(totals: TodayTotals): boolean {
  return totals.totalDurationMin > EXTREME_DAY_VOLUME.minutes
    || totals.totalDistanceKm > EXTREME_DAY_VOLUME.km;
}
