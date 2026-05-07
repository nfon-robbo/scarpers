import {
  encodeWorkoutFit,
  INTENSITY,
  WKT_STEP_DURATION,
  WKT_STEP_TARGET,
  WorkoutStep,
} from "./fit-workout-encoder";

interface SyncApiStep {
  duration: number;
  hrLow: number;
  hrHigh: number;
  hrZone?: string;
  intensity: string;
  pace?: string;
}

interface SyncWorkoutInput {
  name: string;
  rawDescription?: string;
  steps: SyncApiStep[];
}

interface FitFilePayload {
  fileContentsBase64: string;
  fileName: string;
}

const durationPattern = /(\d+m\d+s?|\d+m|\d+s)\b/i;
const bpmPattern = /(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm\s*HR/i;
const pacePattern = /(\d{1,2}:\d{2})(?:\s*\/\s*(km|mi))?\s*Pace/i;

function durationTextToMilliseconds(value: string): number {
  const match = value.toLowerCase().match(/(?:(\d+)m)?(?:(\d+)s?)?/);
  const minutes = Number(match?.[1] ?? 0);
  const seconds = Number(match?.[2] ?? 0);
  return (minutes * 60 + seconds) * 1000;
}

function zoneToBpmRange(zone: string): { low: number; high: number } {
  const matches = Array.from(zone.matchAll(/Z(\d)/gi)).map((match) => Number(match[1]));
  const bpmForZone = (zoneNumber: number) => {
    switch (zoneNumber) {
      case 1:
        return { low: 100, high: 120 };
      case 2:
        return { low: 120, high: 140 };
      case 3:
        return { low: 140, high: 160 };
      case 4:
        return { low: 160, high: 175 };
      case 5:
        return { low: 175, high: 200 };
      default:
        return { low: 120, high: 140 };
    }
  };

  if (matches.length === 0) return bpmForZone(2);
  const low = bpmForZone(matches[0]);
  const high = bpmForZone(matches[matches.length - 1]);
  return { low: low.low, high: high.high };
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function toFitIntensity(intensity: string): string {
  const normalized = intensity.toLowerCase();
  if (normalized === "warmup") return INTENSITY.WARMUP;
  if (normalized === "cooldown") return INTENSITY.COOLDOWN;
  if (normalized === "recovery") return INTENSITY.RECOVERY;
  if (normalized === "rest") return INTENSITY.REST;
  if (normalized === "interval") return "interval";
  return INTENSITY.ACTIVE;
}

function paceToSpeedMps(pace: string): number | null {
  const match = pace.match(/(\d{1,2}):(\d{2})(?:\s*\/\s*(km|mi))?/i);
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  if (seconds <= 0) return null;
  const metres = /mi/i.test(match[3] || "") ? 1609.344 : 1000;
  return metres / seconds;
}

function stepName(intensity: string, target: string): string {
  const normalized = intensity.toLowerCase();
  const label = normalized === "warmup" ? "Warm up" : normalized === "cooldown" ? "Cool down" : normalized === "rest" || normalized === "recovery" ? "Recover" : "Run";
  return `${label} ${target}`.slice(0, 31);
}

function buildOpenStep(durationMs: number, intensity: string, label: string): WorkoutStep {
  return {
    name: stepName(intensity, label),
    intensity: toFitIntensity(intensity),
    durationType: WKT_STEP_DURATION.TIME,
    durationValue: durationMs,
    targetType: WKT_STEP_TARGET.OPEN,
    targetValue: 0,
  };
}

function buildSpeedFitStep(durationMs: number, pace: string, intensity: string): WorkoutStep | null {
  // No pace target for warmup/cooldown/recovery/rest — avoids nagging alerts
  const normalized = (intensity || "").toLowerCase();
  if (["warmup", "cooldown", "recovery", "rest"].includes(normalized)) {
    return buildOpenStep(durationMs, intensity, "easy");
  }
  const speed = paceToSpeedMps(pace);
  if (!speed) return null;
  const targetPace = pace.replace(/\s+/g, "").replace(/\s*Pace$/i, "");
  const speedFitValue = speed * 1000;
  return {
    name: stepName(intensity, targetPace),
    intensity: toFitIntensity(intensity),
    durationType: WKT_STEP_DURATION.TIME,
    durationValue: durationMs,
    targetType: WKT_STEP_TARGET.SPEED,
    targetValue: 0,
    customTargetLow: speedFitValue * 0.97,
    customTargetHigh: speedFitValue * 1.03,
  };
}

function buildFitStep(durationMs: number, hrLow: number, hrHigh: number, intensity: string): WorkoutStep {
  return {
    name: stepName(intensity, `${hrLow}-${hrHigh} bpm`),
    intensity: toFitIntensity(intensity),
    durationType: WKT_STEP_DURATION.TIME,
    durationValue: durationMs,
    targetType: WKT_STEP_TARGET.HEART_RATE,
    targetValue: 0,
    // FIT spec: HR custom targets must be offset by +100 to be interpreted
    // as absolute bpm. Without the offset, Intervals.icu treats the value
    // as a percentage of LTHR / max HR.
    customTargetLow: hrLow + 100,
    customTargetHigh: hrHigh + 100,
  };
}

function parseTextStep(line: string, intensity: string): WorkoutStep | null {
  const durationMatch = line.match(durationPattern);
  if (!durationMatch) return null;
  // Walks should not carry a pace target — keep them open like warmup/cooldown
  const isWalk = /\bwalk(ing)?\b/i.test(line);
  const effectiveIntensity = isWalk ? "Recovery" : intensity;
  const paceMatch = line.match(pacePattern);
  if (paceMatch) return buildSpeedFitStep(durationTextToMilliseconds(durationMatch[1]), paceMatch[0], effectiveIntensity);

  const bpmMatch = line.match(bpmPattern);
  const zoneMatch = line.match(/Z\d(?:\s*[-–]\s*Z\d)?/i);
  const range = bpmMatch
    ? { low: Number(bpmMatch[1]), high: Number(bpmMatch[2]) }
    : zoneMatch
      ? zoneToBpmRange(zoneMatch[0])
      : null;

  if (!range) return null;

  return buildFitStep(durationTextToMilliseconds(durationMatch[1]), range.low, range.high, effectiveIntensity);
}

function parseRawDescriptionToFitSteps(rawDescription: string): WorkoutStep[] {
  const lines = rawDescription.split("\n");
  const steps: WorkoutStep[] = [];
  let currentIntensity = "Active";
  let i = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (!trimmed.startsWith("-")) {
      const repeatMatch = trimmed.match(/^(\d+)x$/i);
      if (repeatMatch) {
        const reps = Number(repeatMatch[1]);
        const block: WorkoutStep[] = [];
        i += 1;

        while (i < lines.length) {
          const candidate = lines[i].trim();
          if (!candidate) {
            i += 1;
            continue;
          }
          if (!candidate.startsWith("-")) break;

          const parsed = parseTextStep(candidate, block.length === 0 ? "Interval" : "Recovery");
          if (parsed) block.push(parsed);
          i += 1;
        }

        for (let rep = 0; rep < reps; rep += 1) {
          steps.push(...block);
        }
        continue;
      }

      if (/warm/i.test(trimmed)) currentIntensity = "Warmup";
      else if (/cool/i.test(trimmed)) currentIntensity = "Cooldown";
      else if (/recover|rest/i.test(trimmed)) currentIntensity = "Recovery";
      else currentIntensity = "Active";

      i += 1;
      continue;
    }

    const parsed = parseTextStep(trimmed, currentIntensity);
    if (parsed) steps.push(parsed);
    i += 1;
  }

  return steps;
}

function convertApiStepsToFitSteps(steps: SyncApiStep[]): WorkoutStep[] {
  return steps
    .filter((step) => step.duration > 0)
    .map((step) => {
      const bpmRange =
        step.hrLow > 0 && step.hrHigh > 0
          ? { low: step.hrLow, high: step.hrHigh }
          : zoneToBpmRange(step.hrZone ?? "Z2");

      return buildSpeedFitStep(step.duration * 1000, step.pace || "6:27/km", step.intensity)
        ?? buildFitStep(step.duration * 1000, bpmRange.low, bpmRange.high, step.intensity);
    });
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "workout";
}

export function buildIntervalsFitFile(workout: SyncWorkoutInput): FitFilePayload | undefined {
  const fitSteps = workout.rawDescription
    ? parseRawDescriptionToFitSteps(workout.rawDescription)
    : convertApiStepsToFitSteps(workout.steps);

  if (fitSteps.length === 0) return undefined;

  const fileBytes = encodeWorkoutFit(workout.name, fitSteps);

  return {
    fileName: `${sanitizeFileName(workout.name)}.fit`,
    fileContentsBase64: encodeBase64(fileBytes),
  };
}

export type { SyncApiStep, SyncWorkoutInput, FitFilePayload };