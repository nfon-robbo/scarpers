/**
 * Plan Export Utilities
 * 
 * Parses markdown training plans and exports them as:
 * - TCX workout files (for intervals.icu → watch sync)
 * - ICS calendar files
 * - Clipboard text (for manual entry)
 */

import JSZip from "jszip";
import { encodeTcxWorkout } from "./tcx-workout-encoder";

export interface ParsedSegment {
  segment: string;   // e.g. "Warm-up", "Main", "Cool-down"
  duration: string;  // e.g. "10 min", "5 km"
  target: string;    // e.g. "Walk/Easy Jog", "5:30/km"
  hrZone: string;    // e.g. "Z1", "Z2-Z3"
  notes?: string;
}

export interface ParsedWorkout {
  date: string;       // raw date string e.g. "17/02/2025"
  dateObj: Date | null;
  title: string;      // e.g. "Easy Recovery Run (30 min)"
  segments: ParsedSegment[];
  rawText: string;    // full markdown text of this workout
  intervalsText?: string; // Native intervals.icu workout text block (from DOCX import)
}

/**
 * Strip in-title benchmark markers (e.g. `[benchmark:30min]`) from a workout
 * title before it's pushed to intervals.icu / a watch. The marker is our
 * internal cue for the benchmark detector — the watch must never render it in
 * the workout name.
 */
export function stripBenchmarkTokens(title: string): string {
  return title.replace(/\s*\[benchmark:[^\]]+\]\s*/gi, " ").replace(/\s{2,}/g, " ").trim();
}

function cleanMarkdownCell(value: string): string {
  return value
    .replace(/\\([*_`])/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

/**
 * Parse a markdown training plan to extract individual workouts.
 * Looks for bold date + workout title patterns followed by segment tables.
 */
export function parseWorkoutsFromPlan(markdown: string): ParsedWorkout[] {
  const lines = markdown.split("\n");
  const workouts: ParsedWorkout[] = [];

  // Pattern: **Day DD/MM/YYYY** or **Monday DD/MM/YYYY** followed by workout info
  // Also matches: **DD/MM/YYYY** – Title
  const datePattern = /\*\*(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+)?(\d{1,2}\/\d{1,2}\/\d{4})\*\*/i;
  const altDatePattern = /\*\*(\d{1,2}\/\d{1,2}\/\d{4})[^*]*\*\*/i;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const dateMatch = line.match(datePattern) || line.match(altDatePattern);

    if (dateMatch) {
      const dateStr = dateMatch[1];
      // Extract title from the rest of the line
      const titleMatch = line.match(/\*\*[^*]+\*\*\s*[-–:]\s*(.+)/) ||
                         line.match(/\*\*[^*]+\*\*\s+(.+)/);
      const title = titleMatch ? titleMatch[1].replace(/\*\*/g, "").trim() : line.replace(/\*\*/g, "").trim();

      // Parse date (DD/MM/YYYY)
      const dateParts = dateStr.split("/");
      let dateObj: Date | null = null;
      if (dateParts.length === 3) {
        const day = parseInt(dateParts[0], 10);
        const month = parseInt(dateParts[1], 10) - 1;
        const year = parseInt(dateParts[2], 10);
        dateObj = new Date(year, month, day);
        if (isNaN(dateObj.getTime())) dateObj = null;
      }

      // Collect lines until next workout or end
      const startLine = i;
      i++;
      const segments: ParsedSegment[] = [];

      // Look for a table with segments
      while (i < lines.length) {
        // Check if next workout starts
        if (i > startLine + 1 && (lines[i].match(datePattern) || lines[i].match(altDatePattern))) {
          break;
        }
        // Also break on week headers
        if (i > startLine + 1 && /^###\s+Week\s+\d/i.test(lines[i])) {
          break;
        }

        // Detect table header row with "Segment" column
        if (lines[i].includes("|") && /segment/i.test(lines[i])) {
          const headerCells = lines[i].split("|").map(c => c.trim()).filter(Boolean);
          const headerIndex = (patterns: RegExp[]) => headerCells.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));
          const segmentIdx = headerIndex([/^segment$/i, /^section$/i]);
          const durationIdx = headerIndex([/duration/i, /distance/i]);
          const targetIdx = headerIndex([/target/i, /pace/i, /intensity/i]);
          const hrIdx = headerIndex([/hr\s*zone/i, /heart\s*rate/i]);
          const notesIdx = headerIndex([/notes?/i, /cue/i]);
          i++; // skip header
          // Skip separator row
          if (i < lines.length && /^\s*\|?\s*[-:]+/.test(lines[i])) i++;

          // Parse body rows
          while (i < lines.length && lines[i].includes("|") && !/^\s*\|?\s*[-:]+[-|:\s]+$/.test(lines[i])) {
            const cells = lines[i].split("|").map(c => c.trim()).filter(Boolean);
            if (cells.length >= 3) {
              const getCell = (idx: number, fallback = "") => cleanMarkdownCell(idx >= 0 ? (cells[idx] || fallback) : fallback);
              const segName = getCell(segmentIdx, cells[0] || "");
              // Strip mobility / stretching / yoga / foam-rolling segments — these
              // should never appear as workout rows (per user instruction).
              if (/\b(mobility|static\s*stretch(?:ing)?|stretch(?:ing)?|foam[\s-]*roll(?:ing)?|yoga|pilates)\b/i.test(segName)) {
                i++;
                continue;
              }
              const target = getCell(targetIdx, cells[2] || "");
              const explicitHrZone = getCell(hrIdx, "");
              // When no dedicated HR Zone column exists, extract JUST the zone
              // label (e.g. "Z2", "Z2-Z3") from the target. Copying the full
              // target string in causes downstream renderers to display the
              // same value twice (once as Target, once as HR Zone).
              let derivedHrZone = explicitHrZone;
              if (!derivedHrZone) {
                const zoneMatches = Array.from(target.matchAll(/Z(\d)/gi)).map((m) => `Z${m[1]}`);
                if (zoneMatches.length === 1) derivedHrZone = zoneMatches[0];
                else if (zoneMatches.length > 1) derivedHrZone = `${zoneMatches[0]}-${zoneMatches[zoneMatches.length - 1]}`;
              }
              segments.push({
                segment: segName,
                duration: getCell(durationIdx, cells[1] || ""),
                target,
                hrZone: derivedHrZone,
                notes: getCell(notesIdx, hrIdx >= 0 ? cells[4] || "" : cells[3] || ""),
              });
            }
            i++;
          }
          continue;
        }
        i++;
      }

      // Capture raw text
      const rawText = lines.slice(startLine, i).join("\n");

      // Extract native intervals.icu text from ~~~intervals code blocks
      let intervalsText: string | undefined;
      const intervalsMatch = rawText.match(/~~~intervals\n([\s\S]*?)~~~/);
      if (intervalsMatch) {
        intervalsText = intervalsMatch[1].trim();
      }

      // PREFERRED: parse the ~~~intervals block into structured segments.
      // This must run BEFORE the title-based fallback, otherwise titles like
      // "S1 10x1min Run/" trigger the fallback's hardcoded "Warm-up 10 min".
      if (intervalsText && segments.length === 0) {
        const parsed = parseIntervalsBlock(intervalsText);
        if (parsed.length) segments.push(...parsed);
      }

      // Fallback: if no table segments AND no intervals block, parse compact
      // format from the title line e.g. "Easy Run (30 min) @ Z2".
      if (segments.length === 0 && title) {
        const durationMatch = title.match(/\((\d+\s*min)\)/i) || title.match(/(\d+\s*min)/i);
        const zoneMatch = title.match(/Z(\d)/i);
        if (durationMatch) {
          const dur = durationMatch[1];
          const zone = zoneMatch ? `Z${zoneMatch[1]}` : "Z2";
          const intervalMatch = title.match(/(\d+)\s*x\s*([\d.]+\s*(?:m|km|min|sec)\b)/i);
          if (intervalMatch) {
            segments.push({ segment: "Warm-up", duration: "5 min", target: "easy", hrZone: "Z1", notes: "" });
            segments.push({ segment: "Main", duration: `${intervalMatch[1]} x ${intervalMatch[2]}`, target: "", hrZone: zone, notes: "" });
            segments.push({ segment: "Cool-down", duration: "5 min", target: "easy", hrZone: "Z1", notes: "" });
          } else {
            segments.push({ segment: "Warm-up", duration: "5 min", target: "easy", hrZone: "Z1", notes: "" });
            segments.push({ segment: "Main", duration: dur, target: "", hrZone: zone, notes: "" });
            segments.push({ segment: "Cool-down", duration: "5 min", target: "easy", hrZone: "Z1", notes: "" });
          }
        }
      }

      workouts.push({
        date: dateStr,
        dateObj,
        title,
        segments,
        rawText,
        intervalsText,
      });
      continue;
    }
    i++;
  }

  return workouts;
}

/**
 * Parse an intervals.icu native workout block into ParsedSegments.
 * Handles section headers (Warmup / Cooldown / Nx repeat blocks) and
 * step lines like "- 5m 9:00/km-9:30/km Pace" or "- 1m 7:00-7:30/km".
 */
function parseIntervalsBlock(text: string): ParsedSegment[] {
  const out: ParsedSegment[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let section: "warmup" | "cooldown" | "main" = "main";
  let pendingReps = 1;
  let repeatBuffer: ParsedSegment[] | null = null;

  const flushRepeat = () => {
    if (repeatBuffer && pendingReps > 1) {
      for (let r = 0; r < pendingReps; r++) out.push(...repeatBuffer.map((s) => ({ ...s })));
    } else if (repeatBuffer) {
      out.push(...repeatBuffer);
    }
    repeatBuffer = null;
    pendingReps = 1;
  };

  for (const line of lines) {
    if (/^warm\s*up/i.test(line)) { flushRepeat(); section = "warmup"; continue; }
    if (/^cool\s*down/i.test(line)) { flushRepeat(); section = "cooldown"; continue; }
    const repMatch = line.match(/^(\d+)\s*x\s*$/i);
    if (repMatch) {
      flushRepeat();
      pendingReps = parseInt(repMatch[1], 10);
      section = "main";
      repeatBuffer = [];
      continue;
    }
    const stepMatch = line.match(/^-\s*(\d+(?:\.\d+)?)\s*(m|min|s|sec|h|hr)\b\s*(.*)$/i);
    if (!stepMatch) continue;
    const num = parseFloat(stepMatch[1]);
    const unit = stepMatch[2].toLowerCase();
    let durationStr: string;
    if (unit.startsWith("h")) durationStr = `${num} h`;
    else if (unit.startsWith("s")) durationStr = `${num} sec`;
    else durationStr = `${num} min`;
    const target = stepMatch[3].trim();

    let segName: string;
    if (repeatBuffer) {
      // Inside an Nx block: alternate run / recovery
      segName = repeatBuffer.length % 2 === 0 ? "Main" : "Recovery";
    } else if (section === "warmup") segName = "Warm-up";
    else if (section === "cooldown") segName = "Cool-down";
    else segName = "Main";

    const seg: ParsedSegment = { segment: segName, duration: durationStr, target, hrZone: "", notes: "" };
    if (repeatBuffer) repeatBuffer.push(seg);
    else out.push(seg);
  }
  flushRepeat();
  return out;
}


/**
 * Generate a ZIP file containing one .tcx workout file per workout day.
 * TCX is accepted by intervals.icu, Garmin Connect, and most training platforms.
 */
export async function generateWorkoutZip(workouts: ParsedWorkout[]): Promise<Blob> {
  const zip = new JSZip();

  for (const workout of workouts) {
    if (workout.segments.length === 0) continue;

    const exportTitle = stripBenchmarkTokens(workout.title || "Workout") || "Workout";
    const tcxContent = encodeTcxWorkout(exportTitle, workout.segments);
    const safeName = (workout.date || "workout").replace(/\//g, "-");
    const fileName = `${safeName}_${exportTitle.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.tcx`;
    zip.file(fileName, tcxContent);
  }

  return zip.generateAsync({ type: "blob" });
}

/**
 * Generate an ICS calendar file from parsed workouts.
 */
export function generateIcsCalendar(workouts: ParsedWorkout[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TrainingPlan//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const workout of workouts) {
    if (!workout.dateObj) continue;

    const y = workout.dateObj.getFullYear();
    const m = String(workout.dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(workout.dateObj.getDate()).padStart(2, "0");
    const dateVal = `${y}${m}${d}`;

    // Build description from segments
    const descParts = workout.segments.map(
      (s, i) => `Step ${i + 1}: ${s.segment} | ${s.duration} | ${s.hrZone}${s.target ? ` | ${s.target}` : ""}`
    );
    const description = descParts.join("\\n");

    lines.push("BEGIN:VEVENT");
    lines.push(`DTSTART;VALUE=DATE:${dateVal}`);
    lines.push(`DTEND;VALUE=DATE:${dateVal}`);
    lines.push(`SUMMARY:🏃 ${workout.title}`);
    lines.push(`DESCRIPTION:${description}`);
    lines.push(`UID:${dateVal}-${Math.random().toString(36).slice(2)}@trainingplan`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * Format a single workout for clipboard copy.
 */
export function formatWorkoutForClipboard(workout: ParsedWorkout): string {
  const parts: string[] = [`WORKOUT: ${workout.title}`, ""];
  workout.segments.forEach((seg, i) => {
    const hrInfo = seg.hrZone ? ` | ${seg.hrZone}` : "";
    const targetInfo = seg.target ? ` | ${seg.target}` : "";
    parts.push(`Step ${i + 1}: ${seg.segment} | ${seg.duration}${hrInfo}${targetInfo}`);
  });
  if (workout.segments.length > 0 && workout.segments[0].notes) {
    parts.push("", `Notes: ${workout.segments[0].notes}`);
  }
  return parts.join("\n");
}

/**
 * Trigger a file download in the browser.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadText(content: string, filename: string, mimeType = "text/plain") {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}
