/**
 * TCX Workout File Encoder
 * 
 * Generates Training Center XML (.tcx) workout files
 * compatible with TrainingPeaks import.
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

function segmentToIntensity(segment: string): string {
  const lower = segment.toLowerCase();
  if (lower.includes("rest") || lower.includes("recovery")) return "Resting";
  return "Active";
}

function parseDurationSeconds(duration: string): number | null {
  const timeMatch = duration.match(/(\d+)\s*min/i);
  const secMatch = duration.match(/(\d+)\s*sec/i);
  if (timeMatch) return parseInt(timeMatch[1], 10) * 60;
  if (secMatch) return parseInt(secMatch[1], 10);
  return null;
}

function parseDistanceMeters(duration: string): number | null {
  const kmMatch = duration.match(/([\d.]+)\s*km/i);
  const mMatch = duration.match(/(\d+)\s*m\b/i);
  if (kmMatch) return parseFloat(kmMatch[1]) * 1000;
  if (mMatch) return parseInt(mMatch[1], 10);
  return null;
}

function parseHrZone(hrZone: string): number | null {
  const match = hrZone.match(/Z(\d)/i);
  return match ? parseInt(match[1], 10) : null;
}

function buildStepXml(seg: ParsedSegment, stepId: number): string {
  const intensity = segmentToIntensity(seg.segment);
  const seconds = parseDurationSeconds(seg.duration);
  const meters = parseDistanceMeters(seg.duration);
  const zone = parseHrZone(seg.hrZone);

  let durationXml: string;
  if (seconds != null) {
    durationXml = `        <Duration xsi:type="Time_t"><Seconds>${seconds}</Seconds></Duration>`;
  } else if (meters != null) {
    durationXml = `        <Duration xsi:type="Distance_t"><Meters>${meters}</Meters></Duration>`;
  } else {
    durationXml = `        <Duration xsi:type="UserInitiated_t"/>`;
  }

  let targetXml: string;
  if (zone != null) {
    targetXml = `        <Target xsi:type="HeartRate_t">
          <HeartRateZone xsi:type="PredefinedHeartRateZone_t">
            <Number>${zone}</Number>
          </HeartRateZone>
        </Target>`;
  } else {
    targetXml = `        <Target xsi:type="None_t"/>`;
  }

  return `      <Step xsi:type="Step_t">
        <StepId>${stepId}</StepId>
        <Name>${escapeXml(seg.segment)}</Name>
${durationXml}
        <Intensity>${intensity}</Intensity>
${targetXml}
      </Step>`;
}

export function encodeTcxWorkout(
  workoutName: string,
  segments: ParsedSegment[],
  sport: string = "Running"
): string {
  const steps = segments.map((seg, i) => buildStepXml(seg, i + 1)).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Workouts>
    <Workout Sport="${escapeXml(sport)}">
      <Name>${escapeXml(workoutName.slice(0, 47))}</Name>
${steps}
    </Workout>
  </Workouts>
</TrainingCenterDatabase>`;
}
