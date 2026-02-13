/**
 * ZWO Workout File Encoder
 * 
 * Generates Zwift Workout (.zwo) files — the ONLY format
 * TrainingPeaks accepts for importing planned workouts.
 */

import { ParsedSegment } from "./plan-export";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Map HR zone (Z1-Z5) to approximate FTP power fraction.
 * ZWO uses power-based targets; TrainingPeaks converts these
 * to HR zones when syncing to devices.
 */
function hrZoneToPower(hrZone: string): number {
  const match = hrZone.match(/Z(\d)/i);
  if (!match) return 0.65; // default to easy
  const zone = parseInt(match[1], 10);
  switch (zone) {
    case 1: return 0.55;
    case 2: return 0.68;
    case 3: return 0.82;
    case 4: return 0.94;
    case 5: return 1.10;
    default: return 0.65;
  }
}

function parseDurationSeconds(duration: string): number {
  const hourMatch = duration.match(/([\d.]+)\s*h/i);
  const minMatch = duration.match(/(\d+)\s*min/i);
  const secMatch = duration.match(/(\d+)\s*sec/i);

  let total = 0;
  if (hourMatch) total += parseFloat(hourMatch[1]) * 3600;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);

  // Distance-based: estimate duration from distance at ~6 min/km
  if (total === 0) {
    const kmMatch = duration.match(/([\d.]+)\s*km/i);
    const mMatch = duration.match(/(\d+)\s*m\b/i);
    if (kmMatch) total = Math.round(parseFloat(kmMatch[1]) * 360); // 6min/km
    else if (mMatch) total = Math.round(parseInt(mMatch[1], 10) * 0.36);
  }

  return total || 600; // fallback 10 min
}

function isWarmup(segment: string): boolean {
  return /warm[- ]?up/i.test(segment);
}

function isCooldown(segment: string): boolean {
  return /cool[- ]?down/i.test(segment);
}

function segmentToZwoElement(seg: ParsedSegment): string {
  const duration = parseDurationSeconds(seg.duration);
  const power = hrZoneToPower(seg.hrZone);

  if (isWarmup(seg.segment)) {
    return `    <Warmup Duration="${duration}" PowerLow="${(power * 0.7).toFixed(2)}" PowerHigh="${power.toFixed(2)}" pace="4" />`;
  }

  if (isCooldown(seg.segment)) {
    return `    <Cooldown Duration="${duration}" PowerLow="${power.toFixed(2)}" PowerHigh="${(power * 0.7).toFixed(2)}" pace="4" />`;
  }

  // Regular steady state segment
  return `    <SteadyState Duration="${duration}" Power="${power.toFixed(2)}" pace="4" />`;
}

export function encodeZwoWorkout(
  workoutName: string,
  segments: ParsedSegment[],
  description: string = ""
): string {
  const steps = segments.map(segmentToZwoElement).join("\n");

  return `<workout_file>
  <author>Training Plan Generator</author>
  <name>${escapeXml(workoutName.slice(0, 60))}</name>
  <description>${escapeXml(description)}</description>
  <sportType>run</sportType>
  <tags/>
  <workout>
${steps}
  </workout>
</workout_file>`;
}
