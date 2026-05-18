/**
 * Build a descriptive workout title that reflects the actual structure
 * (e.g. "10x1min run / 1min walk intervals" or "Easy run 30min"),
 * so plans don't all show generically as "Easy Run".
 *
 * Used both by the in-app plan list (segment-only input) and by the
 * Intervals.icu sync flow (fully expanded steps).
 */

const BRAND_PREFIX = "Scarpers Dash";

type IntensityName =
  | "Easy"
  | "Recovery"
  | "Tempo"
  | "Threshold"
  | "Long"
  | "Interval"
  | "Warmup"
  | "Cooldown"
  | "Rest";

interface Step {
  duration: number; // seconds
  intensity: string;
}

interface SegmentLike {
  segment?: string;
  duration?: string;
  target?: string;
  hrZone?: string;
  notes?: string;
}

const fmtDur = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0 && sec > 0) return `${m}m${sec}s`;
  if (m > 0) return `${m}min`;
  return `${sec}s`;
};

const parseDurationSeconds = (text: string): number => {
  const cleaned = text.replace(/[()]/g, " ").trim();
  const colon = cleaned.match(/(\d{1,3}):(\d{2})/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const hour = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)s?\b/i);
  const min = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:m|min|minute)s?\b/i);
  const sec = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|second)s?\b/i);
  let total = 0;
  if (hour) total += parseFloat(hour[1]) * 3600;
  if (min) total += parseFloat(min[1]) * 60;
  if (sec) total += parseFloat(sec[1]);
  return Math.round(total);
};

const parseRepeatDuration = (duration: string): { reps: number; workSecs: number; restSecs: number } | null => {
  const cleaned = duration.replace(/[()]/g, " ").replace(/×/g, "x");
  const repeat = cleaned.match(/(\d+)\s*x\s*(.+)$/i);
  if (!repeat) return null;
  const reps = parseInt(repeat[1], 10);
  const body = repeat[2];
  const [workPart, restPart] = body.split(/\s*\/\s*/);
  const workSecs = parseDurationSeconds(workPart || "");
  const restSecs = parseDurationSeconds(restPart || "");
  if (!reps || !workSecs) return null;
  return { reps, workSecs, restSecs };
};

const intentFrom = (text: string): string | null => {
  if (/tempo/i.test(text)) return "tempo";
  if (/threshold|lthr/i.test(text)) return "threshold";
  if (/hill/i.test(text)) return "hill reps";
  if (/long/i.test(text)) return "long run";
  if (/recovery/i.test(text)) return "recovery";
  if (/vo2|v02/i.test(text)) return "VO2max";
  if (/fartlek/i.test(text)) return "fartlek";
  if (/progress/i.test(text)) return "progression";
  if (/race\s*pace/i.test(text)) return "race pace";
  return null;
};

const labelFromIntensity: Record<string, string> = {
  Easy: "easy run",
  Recovery: "recovery jog",
  Tempo: "tempo run",
  Threshold: "threshold run",
  Long: "long run",
  Interval: "interval run",
  Warmup: "easy run",
  Cooldown: "easy run",
  Rest: "rest",
};

/**
 * Derive title from fully expanded steps (used by sync).
 */
export function deriveWorkoutTitleFromSteps(
  originalTitle: string,
  steps: Step[],
  totalMins: number,
): string {
  type Group = { workDur: number; restDur: number; reps: number };
  const groups: Group[] = [];
  let i = 0;
  while (i < steps.length) {
    if (steps[i].intensity === "Interval") {
      const work = steps[i].duration;
      const next = steps[i + 1];
      const hasRest = next && (next.intensity === "Recovery" || next.intensity === "Rest");
      const rest = hasRest ? next.duration : 0;
      const last = groups[groups.length - 1];
      if (last && last.workDur === work && last.restDur === rest) last.reps += 1;
      else groups.push({ workDur: work, restDur: rest, reps: 1 });
      i += hasRest ? 2 : 1;
    } else i += 1;
  }

  const cleanedOriginal = originalTitle
    .replace(/^scarpers(?:\s+dash)?\s*[-–—]\s*/i, "")
    .replace(/\s*\(Total:[^)]*\)/i, "")
    .trim();

  const intent = intentFrom(cleanedOriginal);
  const hasMultipleReps = groups.some((g) => g.reps > 1);
  const hasRest = groups.some((g) => g.restDur > 0);

  if (groups.length === 0 || (!hasMultipleReps && !hasRest)) {
    const main = [...steps].sort((a, b) => b.duration - a.duration)[0];
    const intensity = main?.intensity || "Easy";
    const base = intent ?? labelFromIntensity[intensity] ?? "run";
    return `${capitalize(base)} ${totalMins}min (Total: ${totalMins} min)`;
  }

  // Title shows the work blocks only — walk/rest details belong in the segment table,
  // not in the headline label. Total comes from summing all step durations.
  const descs = groups.map((g) => `${g.reps}x${fmtDur(g.workDur)}`);
  const intentLabel = intent && intent !== "recovery" ? `${intent} intervals` : "intervals";
  return `${descs.join(" + ")} ${intentLabel} (Total: ${totalMins} min)`;
}

/**
 * Derive a descriptive title from raw markdown segments (used in the UI list,
 * where we don't want to fully expand every workout just to label it).
 */
export function deriveWorkoutTitleFromSegments(
  originalTitle: string,
  segments: SegmentLike[],
): string {
  const cleanedOriginal = originalTitle
    .replace(/^scarpers(?:\s+dash)?\s*[-–—]\s*/i, "")
    .replace(/\s*\(Total:[^)]*\)/i, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[—–\-]+\s*/, "")
    .trim();

  if (!cleanedOriginal || /^rest\b/i.test(cleanedOriginal)) return cleanedOriginal;
  // Race day: never derive from segments (warm-up strides would mislabel it as intervals)
  if (/race\s*day|🏁/i.test(cleanedOriginal)) return cleanedOriginal;

  // Parse each segment into seconds + role + intensity
  type Seg = { secs: number; role: "warmup" | "cooldown" | "main" | "recovery"; reps: number; intensity: string; restSecs?: number };
  const parsed: Seg[] = [];
  let totalSecs = 0;
  for (const raw of segments) {
    const dur = raw.duration || "";
    const segName = raw.segment || "";
    const targetText = `${raw.target || ""} ${raw.notes || ""} ${raw.hrZone || ""}`;

    const repeat = parseRepeatDuration(dur);
    const reps = repeat?.reps ?? 1;
    const perSecs = repeat?.workSecs ?? parseDurationSeconds(dur);
    const restSecs = repeat?.restSecs ?? 0;
    const segSecs = repeat ? reps * (perSecs + restSecs) : reps * perSecs;
    totalSecs += segSecs;

    let role: Seg["role"] = "main";
    if (/warm/i.test(segName)) role = "warmup";
    else if (/cool/i.test(segName)) role = "cooldown";
    else if (/recover|rest|walk\s*break/i.test(segName)) role = "recovery";

    let intensity = "Easy";
    if (/tempo/i.test(targetText) || /tempo/i.test(segName)) intensity = "Tempo";
    else if (/threshold|lthr/i.test(targetText)) intensity = "Threshold";
    else if (/Z4|Z5|interval|VO2|v02/i.test(targetText)) intensity = "Interval";
    else if (/long/i.test(segName) || /long/i.test(cleanedOriginal)) intensity = "Long";
    else if (/recovery|Z1\b/i.test(targetText) && role === "main") intensity = "Recovery";
    parsed.push({ secs: perSecs, role, reps, intensity, restSecs });
  }

  const totalMins = Math.max(1, Math.round(totalSecs / 60));

  // Build "Nx work / rest" groups from main/recovery sequences with reps>1 or rest
  type Group = { work: number; rest: number; reps: number };
  const groups: Group[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const cur = parsed[i];
    if (cur.role !== "main") continue;
    if (cur.reps > 1) {
      // explicit "Nx" segment — pair with following recovery if any
      const next = parsed[i + 1];
      const hasInlineRest = (cur.restSecs ?? 0) > 0;
      const rest = cur.restSecs || (next && next.role === "recovery" ? next.secs : 0);
      groups.push({ work: cur.secs, rest, reps: cur.reps });
      // Only skip the next segment if its rest was a separate recovery row,
      // not when the rest was already inline ("4 x 3 min / 1 min walk").
      if (rest && !hasInlineRest && next && next.role === "recovery") i++;
    }
  }

  const intent = intentFrom(cleanedOriginal) ?? intentFrom(parsed.map((p) => p.intensity).join(" "));

  let body: string;
  if (groups.length > 0 && (groups.some((g) => g.reps > 1) || groups.some((g) => g.rest > 0))) {
    // Title shows work blocks only — walk/rest details live in the segment table.
    const descs = groups.map((g) => `${g.reps}x${fmtDur(g.work)}`);
    const intentLabel = intent && intent !== "recovery" ? `${intent} intervals` : "intervals";
    body = `${descs.join(" + ")} ${intentLabel} ${totalMins}min`;
  } else {
    // Continuous — pick longest main as the dominant
    const main = parsed.filter((p) => p.role === "main").sort((a, b) => b.secs - a.secs)[0];
    const base = intent ?? labelFromIntensity[main?.intensity ?? "Easy"] ?? "run";
    const sessionType = base === "easy run" ? "continuous easy run" : base;
    body = main?.secs && totalSecs > main.secs
      ? `${fmtDur(main.secs)} ${sessionType} (${totalMins}min total)`
      : `${capitalize(sessionType)} ${totalMins}min`;
  }

  return body;
}

/**
 * Render the in-app plan-list label, prefixed with the brand name.
 */
export function describeWorkoutLabel(originalTitle: string, segments: SegmentLike[]): string {
  const cleaned = (originalTitle || "")
    .replace(/\s*\(Total:[^)]*\)/i, "")
    .replace(/\*\*/g, "")
    .replace(/^\s*[—–\-]+\s*/, "")
    .trim();
  if (!cleaned || /^rest\b/i.test(cleaned)) return cleaned;
  const desc = deriveWorkoutTitleFromSegments(originalTitle, segments || []);
  if (!desc) return `${BRAND_PREFIX} - ${cleaned}`;
  return `${BRAND_PREFIX} - ${desc}`;
}

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
