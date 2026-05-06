/**
 * Shared step expansion used by BOTH the UI step list (PlanDayList) and the
 * intervals.icu sync (TrainingPlan handleSyncToIntervals). They MUST produce
 * the same list — overrides are stored by positional index, so any divergence
 * causes user edits (e.g. cool-down pace) to land on the wrong step or be
 * silently dropped.
 */
import type { ParsedSegment } from "./plan-export";

export interface ExpandedStep {
  duration: number; // seconds
  hrLow: number;
  hrHigh: number;
  hrZone: string;
  intensity: "Warmup" | "Cooldown" | "Interval" | "Recovery" | "Rest" | "Active";
  pace: string;
  /** Human label e.g. "Warm Up", "Run 3", "Walk 3", "Cool Down". */
  label: string;
}

const WALK_PACE = "9:57/km";

export function parseDurationSeconds(duration: string): number {
  const clockMatch = duration.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (clockMatch) return parseInt(clockMatch[1], 10) * 60 + parseInt(clockMatch[2], 10);
  const hourMatch = duration.match(/([\d.]+)\s*h(?:r|our)?s?\b/i);
  const minMatch = duration.match(/(\d+)\s*m(?:in(?:ute)?s?)?\b/i);
  const secMatch = duration.match(/(\d+)\s*s(?:ec(?:ond)?s?)?\b/i);
  let total = 0;
  if (hourMatch) total += parseFloat(hourMatch[1]) * 3600;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);
  if (total === 0) {
    const kmMatch = duration.match(/([\d.]+)\s*km/i);
    if (kmMatch) total = Math.round(parseFloat(kmMatch[1]) * 360);
  }
  if (total === 0 && /^\d+(?:\.\d+)?$/.test(duration.trim())) total = Math.round(parseFloat(duration.trim()) * 60);
  return total || 600;
}

function zoneNumberToBpm(zone: number): { low: number; high: number } {
  switch (zone) {
    case 1: return { low: 100, high: 120 };
    case 2: return { low: 120, high: 140 };
    case 3: return { low: 140, high: 160 };
    case 4: return { low: 160, high: 175 };
    case 5: return { low: 175, high: 200 };
    default: return { low: 100, high: 140 };
  }
}

export function normalizeHrZone(hrZone: string): string {
  const matches = Array.from(hrZone.matchAll(/Z(\d)/gi)).map((m) => parseInt(m[1], 10));
  if (matches.length === 0) return "Z2";
  if (matches.length === 1) return `Z${matches[0]}`;
  return `Z${matches[0]}-Z${matches[matches.length - 1]}`;
}

export function hrZoneToBpm(hrZone: string): { low: number; high: number } {
  const matches = Array.from(hrZone.matchAll(/Z(\d)/gi)).map((m) => parseInt(m[1], 10));
  if (matches.length === 0) return zoneNumberToBpm(2);
  const lo = zoneNumberToBpm(matches[0]);
  const hi = zoneNumberToBpm(matches[matches.length - 1]);
  return { low: lo.low, high: hi.high };
}

function paceForSegment(seg: ParsedSegment, intensity: string): string {
  const txt = `${seg.segment} ${seg.duration} ${seg.target} ${seg.notes || ""}`.toLowerCase();
  // Range like "7:00/km-7:30/km" or "7:00-7:30/km" — use the slower (second)
  // bound as the displayed/target pace, matching how Garmin/intervals.icu
  // expose the prescribed pace.
  const range = txt.match(/(\d{1,2}:\d{2})\s*(?:\/\s*(?:km|mi))?\s*[-–]\s*(\d{1,2}:\d{2})/);
  if (range) return `${range[2]}/km`;
  const explicit = txt.match(/(\d{1,2}:\d{2})\s*(?:\/\s*(?:km|mi)|\b)/i);
  if (explicit) return `${explicit[1]}/km`;
  if (/recovery|rest/i.test(intensity) || /recovery|rest/.test(txt)) return WALK_PACE;
  if (/warmup|cooldown/i.test(intensity)) return /walk/.test(txt) ? WALK_PACE : "6:27/km";
  if (/walk/.test(txt) && !/run|interval|tempo|stride|fast/.test(txt)) return WALK_PACE;
  if (/z5|vo2|sprint|fast/.test(txt)) return "4:30/km";
  if (/z4|threshold|race\s*pace|5k/.test(txt)) return "5:00/km";
  if (/z3|tempo|steady/.test(txt)) return "5:30/km";
  return "6:27/km";
}

/** Parse "M:SS/km" → seconds-per-km. Returns null if unparseable. */
function paceToSeconds(pace: string): number | null {
  const m = pace.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Walk/run ramp sessions must use conversational easy paces. The AI
 * occasionally injects race-derived targets (e.g. 2:45/km, 3:05/km) which are
 * dangerous and unrealistic. Clamp anything faster than 5:30/km to 6:00/km.
 */
function clampWalkRunPace(pace: string): string {
  const secs = paceToSeconds(pace);
  if (secs == null) return pace;
  if (secs < 330) return "6:00/km"; // < 5:30/km
  return pace;
}

export function normalizePaceInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/\/\s*(km|mi)$/i.test(trimmed)) return trimmed.replace(/\s+/g, "");
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? `${trimmed}/km` : trimmed;
}

/** Detect repeat spec from free text e.g. "10 x 1min", "10x1min Run/1min Walk". */
function detectIntervalSpec(text: string): { reps: number; on: string; off: string } | null {
  if (!text) return null;
  const re = /(\d+)\s*[x×]\s*(\d+(?:\.\d+)?\s*(?:min|sec|s|m)\b)(?:\s*(?:run|on)?)?(?:\s*[\/,]\s*(\d+(?:\.\d+)?\s*(?:min|sec|s|m)\b)(?:\s*(?:walk|off|recovery)?)?)?/i;
  const m = text.match(re);
  if (!m) return null;
  return { reps: parseInt(m[1], 10), on: m[2], off: m[3] || "1 min" };
}

/**
 * Expand all segments into the canonical ordered step list.
 * Title is used as a fallback to find an "Nx" repeat spec when no segment
 * row contains its own spec (e.g. plans imported from a `~~~intervals` block
 * where each rep appears as its own row already).
 */
export function expandWorkoutSteps(
  segments: ParsedSegment[],
  workoutTitle: string,
  rawText: string,
): ExpandedStep[] {
  const out: ExpandedStep[] = [];
  let runIdx = 0;
  let walkIdx = 0;

  // If any segment contains its own repeat spec (e.g. duration "10 x 1min / 1min")
  // then we trust the segments. Otherwise fall back to parsing the title for "10x1min".
  const segHasOwnSpec = segments.some((s) => {
    const cleaned = s.duration.replace(/[()]/g, "").trim();
    return /(\d+)\s*[x×]\s*[\d.]+\s*(?:m(?:in)?|sec|h)/i.test(cleaned);
  });
  // Detect if the segment list itself already represents the expanded reps —
  // i.e. multiple "Main" rows of equal short duration. Common for ~~~intervals
  // plans where each rep is one segment row.
  const mainRows = segments.filter((s) => /main|interval|rep|work/i.test(s.segment));
  const mainAlreadyExpanded = mainRows.length >= 2;

  const fallback = (!segHasOwnSpec && !mainAlreadyExpanded)
    ? detectIntervalSpec(workoutTitle) || detectIntervalSpec(rawText)
    : null;
  let mainInjected = false;

  // Walk/run ramp sessions: clamp absurd race-paces. Detect from title or text.
  const isWalkRun = /walk\s*[\/-]\s*run|run\s*[\/-]\s*walk|walk\/run|run\/walk/i.test(
    `${workoutTitle} ${rawText}`,
  );
  const maybeClamp = (pace: string) => (isWalkRun ? clampWalkRunPace(pace) : pace);

  const pushStep = (s: Omit<ExpandedStep, "label"> & { label?: string }, label: string) => {
    out.push({ ...s, label } as ExpandedStep);
  };

  const emitFallbackBlock = (refSeg: ParsedSegment | null) => {
    if (!fallback) return;
    const hr = refSeg ? normalizeHrZone(refSeg.hrZone) : "Z2";
    const bpm = hrZoneToBpm(hr);
    const restZone = `Z${Math.max(1, parseInt(hr.match(/Z(\d)/i)?.[1] || "2", 10) - 1)}`;
    const restBpm = hrZoneToBpm(restZone);
    const workPace = refSeg ? paceForSegment(refSeg, "Interval") : "6:27/km";
    const onSec = parseDurationSeconds(fallback.on);
    const offSec = parseDurationSeconds(fallback.off);
    for (let i = 0; i < fallback.reps; i++) {
      runIdx++;
      pushStep({ duration: onSec, hrLow: bpm.low, hrHigh: bpm.high, hrZone: hr, intensity: "Interval", pace: workPace }, `Run ${runIdx}`);
      walkIdx++;
      pushStep({ duration: offSec, hrLow: restBpm.low, hrHigh: restBpm.high, hrZone: restZone, intensity: "Recovery", pace: WALK_PACE }, `Walk ${walkIdx}`);
    }
    mainInjected = true;
  };

  for (const seg of segments) {
    const segName = seg.segment.toLowerCase();
    const isWarmup = /warm/.test(segName);
    const isCooldown = /cool/.test(segName);
    const isRest = /rest/.test(segName);
    const isRecover = /recover/.test(segName);
    const isMain = /main|interval|rep|work/.test(segName);
    const hrZone = normalizeHrZone(seg.hrZone);
    const { low, high } = hrZoneToBpm(hrZone);

    let intensity: ExpandedStep["intensity"] = "Active";
    if (isWarmup) intensity = "Warmup";
    else if (isCooldown) intensity = "Cooldown";
    else if (isRest) intensity = "Rest";
    else if (isRecover) intensity = "Recovery";
    else if (isMain) intensity = "Interval";

    const cleanDuration = seg.duration.replace(/[()]/g, "").trim();

    // Inline "Nx Awork / Brest" pattern (accept both ASCII x and Unicode ×)
    const repeatMatch = cleanDuration.match(/(\d+)\s*[x×]\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b[^/]*?)\s*\/\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b.*)/i);
    if (repeatMatch) {
      const reps = parseInt(repeatMatch[1], 10);
      const workDuration = parseDurationSeconds(repeatMatch[2]);
      const restDuration = parseDurationSeconds(repeatMatch[3]);
      const workZoneNumber = parseInt(hrZone.match(/Z(\d)/i)?.[1] || "2", 10);
      const restZone = `Z${Math.max(1, workZoneNumber - 1)}`;
      const restBpm = hrZoneToBpm(restZone);
      const workPace = paceForSegment(seg, "Interval");
      for (let i = 0; i < reps; i++) {
        runIdx++;
        pushStep({ duration: workDuration, hrLow: low, hrHigh: high, hrZone, intensity: "Interval", pace: workPace }, `Run ${runIdx}`);
        walkIdx++;
        pushStep({ duration: restDuration, hrLow: restBpm.low, hrHigh: restBpm.high, hrZone: restZone, intensity: "Recovery", pace: WALK_PACE }, `Walk ${walkIdx}`);
      }
      mainInjected = true;
      continue;
    }

    // Inline "Nx Awork" without rest (accept both ASCII x and Unicode ×)
    const simpleRepeatMatch = cleanDuration.match(/(\d+)\s*[x×]\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b)/i);
    if (simpleRepeatMatch) {
      const reps = parseInt(simpleRepeatMatch[1], 10);
      const workDuration = parseDurationSeconds(simpleRepeatMatch[2]);
      const restMatch = seg.target?.match(/([\d.]+)\s*(?:min|sec)/i);
      const restDuration = restMatch ? parseDurationSeconds(restMatch[0]) : 60;
      const restZone = "Z1";
      const restBpm = hrZoneToBpm(restZone);
      const workPace = paceForSegment(seg, "Interval");
      for (let i = 0; i < reps; i++) {
        runIdx++;
        pushStep({ duration: workDuration, hrLow: low, hrHigh: high, hrZone, intensity: "Interval", pace: workPace }, `Run ${runIdx}`);
        walkIdx++;
        pushStep({ duration: restDuration, hrLow: restBpm.low, hrHigh: restBpm.high, hrZone: restZone, intensity: "Recovery", pace: WALK_PACE }, `Walk ${walkIdx}`);
      }
      mainInjected = true;
      continue;
    }

    // Plain segment: emit one step.
    const duration = parseDurationSeconds(seg.duration);
    const pace = paceForSegment(seg, intensity);
    let label: string;
    if (isWarmup) label = "Warm Up";
    else if (isCooldown) label = "Cool Down";
    else if (intensity === "Recovery" || intensity === "Rest") {
      walkIdx++;
      label = `Walk ${walkIdx}`;
    } else {
      runIdx++;
      label = isMain ? `Run ${runIdx}` : seg.segment || `Run ${runIdx}`;
    }
    pushStep({ duration, hrLow: low, hrHigh: high, hrZone, intensity, pace }, label);

    // After a warm-up, if we have a fallback spec from the title and no segment
    // row will provide the main block, inject reps now.
    if (isWarmup && fallback && !mainInjected) {
      const refSeg = mainRows[0] || null;
      emitFallbackBlock(refSeg);
    }
  }

  // If neither warm-up injection nor segment rows produced the main block, append it.
  if (fallback && !mainInjected) emitFallbackBlock(mainRows[0] || null);

  return out;
}
