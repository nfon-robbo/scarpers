/**
 * DOCX Training Plan Importer
 * 
 * Parses a Word doc training plan (like the 8-week sub-30 5k plan)
 * and converts it into the app's markdown format that's compatible
 * with parseWorkoutsFromPlan() and intervals.icu sync.
 */

import * as mammoth from "mammoth";

interface ImportedWorkout {
  date: Date;
  type: string;       // Easy, Tempo, Long, Race Pace, etc.
  session: string;     // S1, S2, S3
  description: string; // Full "what to do" text
  targetPace: string;  // e.g. "11:30–12:30"
  weekNumber: number;
  weekTheme: string;   // e.g. "Aerobic Base", "Building Distance"
}

/**
 * Parse year from surrounding context. Looks for year patterns in the text.
 */
function inferYear(fullText: string): number {
  const yearMatch = fullText.match(/20\d{2}/);
  return yearMatch ? parseInt(yearMatch[0], 10) : new Date().getFullYear();
}

/**
 * Parse a date like "Wed 15 Apr" or "Sun 26 Apr" into a Date object.
 */
function parseShortDate(dateStr: string, year: number): Date | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Match patterns like "Wed 15 Apr", "Sun 26 Apr", "15 Apr", etc.
  const match = dateStr.match(/(?:\w+\s+)?(\d{1,2})\s+(\w{3})/i);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const monthStr = match[2].toLowerCase();
  const month = months[monthStr];
  if (month === undefined) return null;

  return new Date(year, month, day);
}

/**
 * Extract duration in minutes from a description text.
 * e.g. "25 min easy run" → 25, "5 min warm-up → 10 min tempo → 5 min cool-down" → 20
 */
function extractTotalMinutes(description: string): number {
  const minMatches = description.match(/(\d+)\s*min/gi);
  if (!minMatches) return 30; // default
  let total = 0;
  for (const m of minMatches) {
    const num = parseInt(m, 10);
    total += num;
  }
  return total || 30;
}

/**
 * Map workout type + segment role to an HR zone string for intervals.icu.
 */
function inferHrZone(workoutType: string, segmentRole: string): string {
  const role = segmentRole.toLowerCase();
  if (/warm|cool|walk/i.test(role)) return "Z1";
  if (/stride|pickup/i.test(role)) return "Z4";
  if (/rest|recover/i.test(role)) return "Z1";

  const t = workoutType.toLowerCase();
  if (/race\s*pace|race/i.test(t)) return "Z4";
  if (/tempo/i.test(t)) return "Z3";
  if (/long/i.test(t)) return "Z2";
  // Easy / default
  return "Z2";
}

/**
 * Convert a workout description into structured segments for the app format.
 */
function descriptionToSegments(type: string, description: string, targetPace: string): Array<{
  segment: string;
  duration: string;
  target: string;
  hrZone: string;
  notes: string;
}> {
  const segments: Array<{ segment: string; duration: string; target: string; hrZone: string; notes: string }> = [];
  const desc = description.toLowerCase();

  // Check for structured workouts with warm-up → main → cool-down
  const arrowParts = description.split(/→|➜|->/).map(p => p.trim());

  if (arrowParts.length >= 3) {
    for (let i = 0; i < arrowParts.length; i++) {
      const part = arrowParts[i];
      const durMatch = part.match(/(\d+)\s*min/i);
      const dur = durMatch ? `${durMatch[1]} min` : "5 min";

      if (i === 0) {
        segments.push({ segment: "Warm-up", duration: dur, target: "Easy jog", hrZone: "Z1", notes: "" });
      } else if (i === arrowParts.length - 1) {
        segments.push({ segment: "Cool-down", duration: dur, target: "Easy jog", hrZone: "Z1", notes: "" });
      } else {
        const intervalMatch = part.match(/(\d+)\s*[x×]\s*(\d+)\s*min/i);
        const restMatch = part.match(/(\d+)\s*min\s*(?:easy\s*)?(?:jog\s*)?recover/i);

        if (intervalMatch) {
          const reps = parseInt(intervalMatch[1], 10);
          const workMin = parseInt(intervalMatch[2], 10);
          const restMin = restMatch ? parseInt(restMatch[1], 10) : 2;
          const mainZone = /tempo/i.test(part) ? "Z3" : /race\s*pace/i.test(part) ? "Z4" : "Z4";
          segments.push({
            segment: "Main",
            duration: `${reps} x ${workMin} min / ${restMin} min rest`,
            target: /tempo/i.test(part) ? "Tempo effort" : /race\s*pace/i.test(part) ? "Race pace" : "Hard effort",
            hrZone: mainZone,
            notes: "",
          });
        } else {
          const contMatch = part.match(/(\d+)\s*min/i);
          const mainZone = /tempo/i.test(part) ? "Z3" : /race\s*pace/i.test(part) ? "Z4" : inferHrZone(type, "Main");
          segments.push({
            segment: "Main",
            duration: contMatch ? `${contMatch[1]} min` : dur,
            target: /tempo/i.test(part) ? "Tempo effort" : /race\s*pace/i.test(part) ? "Race pace" : "Moderate effort",
            hrZone: mainZone,
            notes: "",
          });
        }
      }
    }
    return segments;
  }

  // Check for pickups pattern
  const pickupsMatch = description.match(/(\d+)\s*(?:short\s*)?(\d+)[\s-]*sec(?:ond)?\s*pickups?/i) ||
                       description.match(/(\d+)\s*[x×]\s*(\d+)[\s-]*sec/i);

  if (pickupsMatch && /pickup/i.test(description)) {
    const totalMin = extractTotalMinutes(description);
    const pickupSec = parseInt(pickupsMatch[2] || pickupsMatch[1], 10);
    segments.push({ segment: "Warm-up", duration: "5 min", target: "Easy", hrZone: "Z1", notes: "" });
    segments.push({ segment: "Main", duration: `${totalMin - 10} min`, target: "Easy run", hrZone: "Z2", notes: "" });
    segments.push({ segment: "Strides", duration: `${pickupsMatch[1] || 4} x ${pickupSec} sec`, target: "Fast pickups", hrZone: "Z4", notes: "60 sec easy between" });
    segments.push({ segment: "Cool-down", duration: "5 min", target: "Easy", hrZone: "Z1", notes: "" });
    return segments;
  }

  // Simple continuous run
  const totalMin = extractTotalMinutes(description);
  const mainZone = inferHrZone(type, "Main");

  const warmUpMatch = description.match(/(\d+)\s*min\s*warm[\s-]*up\s*walk/i);
  const coolDownMatch = description.match(/(\d+)\s*min\s*cool[\s-]*down\s*walk/i);

  if (warmUpMatch || coolDownMatch) {
    const wuMin = warmUpMatch ? parseInt(warmUpMatch[1], 10) : 0;
    const cdMin = coolDownMatch ? parseInt(coolDownMatch[1], 10) : 0;
    const mainMin = totalMin - wuMin - cdMin;
    if (wuMin > 0) segments.push({ segment: "Warm-up", duration: `${wuMin} min`, target: "Walk", hrZone: "Z1", notes: "" });
    segments.push({ segment: "Main", duration: `${mainMin > 0 ? mainMin : totalMin} min`, target: `Easy run @ ${targetPace}/mi`, hrZone: mainZone, notes: description.slice(0, 80) });
    if (cdMin > 0) segments.push({ segment: "Cool-down", duration: `${cdMin} min`, target: "Walk", hrZone: "Z1", notes: "" });
  } else {
    segments.push({ segment: "Main", duration: `${totalMin} min`, target: `${type} @ ${targetPace}/mi`, hrZone: mainZone, notes: description.slice(0, 100) });
  }

  return segments;
}

/**
 * Parse extracted text from a DOCX training plan into workouts.
 */
function parseWorkoutsFromText(text: string): ImportedWorkout[] {
  const year = inferYear(text);
  const workouts: ImportedWorkout[] = [];

  // Split into lines
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  let currentWeek = 0;
  let currentTheme = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect week headers: "Week 1 — Aerobic Base" or "Week 3 — Building Distance"
    const weekMatch = line.match(/Week\s+(\d+)\s*[-–—]\s*(.+)/i);
    if (weekMatch) {
      currentWeek = parseInt(weekMatch[1], 10);
      currentTheme = weekMatch[2].trim();
      continue;
    }

    // Detect workout rows - look for date patterns like "Wed 15 Apr", "Fri 1 May"
    const dateMatch = line.match(/((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+\d{1,2}\s+\w{3})/i);
    if (dateMatch) {
      const date = parseShortDate(dateMatch[1], year);
      if (!date) continue;

      // Extract type (Easy, Tempo, Long, Race Pace)
      const typeMatch = line.match(/(?:Easy|Tempo|Long|Race\s*Pace|RACE)/i);
      const type = typeMatch ? typeMatch[0] : "Easy";

      // Extract session (S1, S2, S3)
      const sessionMatch = line.match(/S(\d)/);
      const session = sessionMatch ? `S${sessionMatch[1]}` : "S1";

      // The description and pace might be on the same line or next lines
      // Look for the description text after the session marker
      let description = "";
      let targetPace = "";

      // Try to find description in remaining text of the line or subsequent lines
      const afterSession = line.substring(line.indexOf(session) + session.length).trim();
      if (afterSession.length > 10) {
        // Description might be inline
        // Try to split off target pace at end (pattern like "11:30–12:30" or "9:39/mi")
        const paceMatch = afterSession.match(/(\d{1,2}:\d{2}[\s–-]+\d{1,2}:\d{2}|\d{1,2}:\d{2}\/mi)\s*$/);
        if (paceMatch) {
          targetPace = paceMatch[1];
          description = afterSession.slice(0, -paceMatch[0].length).trim();
        } else {
          description = afterSession;
        }
      }

      // If description is too short, check next lines
      if (description.length < 15) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const nextLine = lines[j];
          // Stop if we hit another date or week header
          if (nextLine.match(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+\d{1,2}\s+\w{3}/i)) break;
          if (nextLine.match(/Week\s+\d/i)) break;
          if (nextLine.match(/Note:/i)) break;

          const paceMatch = nextLine.match(/(\d{1,2}:\d{2}[\s–-]+\d{1,2}:\d{2}|\d{1,2}:\d{2}\/mi)/);
          if (paceMatch && nextLine.length < 20) {
            targetPace = paceMatch[1];
          } else if (nextLine.length > 10) {
            description += " " + nextLine;
          }
        }
      }

      if (!targetPace) {
        const paceInDesc = description.match(/(\d{1,2}:\d{2}[\s–-]+\d{1,2}:\d{2})/);
        if (paceInDesc) targetPace = paceInDesc[1];
        else targetPace = "easy";
      }

      workouts.push({
        date,
        type: type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
        session,
        description: description.trim(),
        targetPace: targetPace.trim(),
        weekNumber: currentWeek,
        weekTheme: currentTheme,
      });
    }
  }

  return workouts;
}

/**
 * Convert imported workouts to the app's markdown format.
 */
function workoutsToMarkdown(workouts: ImportedWorkout[], planTitle: string): string {
  const lines: string[] = [];
  
  lines.push(`# ${planTitle}`);
  lines.push("");

  let currentWeek = 0;

  for (const w of workouts) {
    if (w.weekNumber !== currentWeek) {
      currentWeek = w.weekNumber;
      lines.push("");
      lines.push(`### Week ${w.weekNumber} — ${w.weekTheme}`);
      lines.push("");
    }

    const day = String(w.date.getDate()).padStart(2, "0");
    const month = String(w.date.getMonth() + 1).padStart(2, "0");
    const year = w.date.getFullYear();
    const dateStr = `${day}/${month}/${year}`;
    const dayName = w.date.toLocaleDateString("en-GB", { weekday: "long" });

    const totalMin = extractTotalMinutes(w.description);
    const title = `${w.type} Run (${totalMin} min)`;

    lines.push(`**${dayName} ${dateStr}** – ${title}`);
    lines.push("");

    // Build segment table
    const segments = descriptionToSegments(w.type, w.description, w.targetPace);

    lines.push("| Segment | Duration | Target | Notes |");
    lines.push("|---------|----------|--------|-------|");
    for (const seg of segments) {
      lines.push(`| ${seg.segment} | ${seg.duration} | ${seg.target} | ${seg.notes} |`);
    }
    lines.push("");
    
    // Add coaching note from original description
    if (w.description.length > 20) {
      lines.push(`> 💡 ${w.description}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Import a DOCX file and convert to the app's markdown training plan format.
 * Returns { markdown, workoutCount, startDate, endDate }
 */
export async function importDocxPlan(file: File): Promise<{
  markdown: string;
  workoutCount: number;
  startDate: string;
  endDate: string;
  raceDistance: string;
  trainingDays: string[];
}> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value;

  // Extract plan metadata
  const titleMatch = text.match(/(\d+[\s-]*Week\s+Running\s+Plan)/i) || 
                     text.match(/(Running\s+Plan)/i);
  const planTitle = titleMatch ? titleMatch[1] : "Imported Training Plan";

  const distanceMatch = text.match(/(?:Goal|Target):\s*(?:Sub[\s-]?\d+[:\d]*\s+)?(\d+k|half[\s-]*marathon|marathon)/i);
  const raceDistance = distanceMatch 
    ? distanceMatch[1].toLowerCase().replace(/\s+/g, "-") 
    : "5k";

  const workouts = parseWorkoutsFromText(text);

  if (workouts.length === 0) {
    throw new Error("No workouts found in the document. Make sure the plan contains dates and workout descriptions.");
  }

  // Infer training days from the workouts
  const dayCounts: Record<string, number> = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const w of workouts) {
    const dayName = dayNames[w.date.getDay()];
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
  }
  const trainingDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([day]) => day)
    .sort((a, b) => dayNames.indexOf(a) - dayNames.indexOf(b));

  const markdown = workoutsToMarkdown(workouts, planTitle);

  const dates = workouts.map(w => w.date).sort((a, b) => a.getTime() - b.getTime());
  const startDate = dates[0].toISOString().split("T")[0];
  const endDate = dates[dates.length - 1].toISOString().split("T")[0];

  return {
    markdown,
    workoutCount: workouts.length,
    startDate,
    endDate,
    raceDistance,
    trainingDays,
  };
}
