/**
 * DOCX Training Plan Importer
 * 
 * Parses a Word doc training plan that contains native intervals.icu
 * workout text blocks and preserves them for direct sync.
 */

import * as mammoth from "mammoth";

interface ExtractedWorkout {
  date: Date;
  type: string;
  session: string;
  description: string;
  targetPace: string;
  hrZone: string;
  weekNumber: number;
  weekTheme: string;
  intervalsText: string; // Native intervals.icu workout text block
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Extract text content from HTML, stripping tags.
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function normalizeSectionHeader(line: string): string {
  const trimmed = line.trim();
  const repeatMatch = trimmed.match(/(?:^|\s)(\d+)x\s*$/i) || trimmed.match(/(?:^|\s)(\d+)\s*x\s*$/i);

  if (repeatMatch) return `${repeatMatch[1]}x`;
  if (/^warm/i.test(trimmed)) return "Warmup";
  if (/^cool/i.test(trimmed)) return "Cooldown";
  if (/recover|rest/i.test(trimmed)) return "Recovery";

  return trimmed;
}

function normalizeWorkoutStep(line: string): string {
  const stepText = line.replace(/^[-•]\s*/, "").trim();
  const durationMatch = stepText.match(/(\d+m\d+s|\d+m|\d+s)\b/i);
  const bpmMatch = stepText.match(/(\d{2,3}\s*[-–]\s*\d{2,3}\s*bpm\s*HR)/i);

  if (!durationMatch || !bpmMatch) return `- ${stepText}`;

  return `- ${durationMatch[1]} ${bpmMatch[1].replace(/\s+/g, "")}`;
}

function bpmLowerBoundToZone(bpm: number): number {
  if (bpm < 132) return 1;
  if (bpm < 154) return 2;
  if (bpm < 170) return 3;
  if (bpm < 183) return 4;
  return 5;
}

function bpmUpperBoundToZone(bpm: number): number {
  if (bpm <= 132) return 1;
  if (bpm <= 154) return 2;
  if (bpm <= 170) return 3;
  if (bpm <= 183) return 4;
  return 5;
}

function bpmRangeToZone(stepText: string): string {
  const bpmMatch = stepText.match(/(\d{2,3})\s*[-–]\s*(\d{2,3})\s*bpm/i);
  if (!bpmMatch) {
    const zoneMatch = stepText.match(/(Z\d(?:\s*[-–]\s*Z\d)?)/i);
    return zoneMatch ? zoneMatch[1].replace(/\s+/g, "") : "Z2";
  }

  const lowZone = bpmLowerBoundToZone(Number(bpmMatch[1]));
  const highZone = bpmUpperBoundToZone(Number(bpmMatch[2]));
  return lowZone === highZone ? `Z${lowZone}` : `Z${lowZone}-Z${highZone}`;
}

/**
 * Extract native intervals.icu workout text from a nested table's <p> tags.
 * Input: HTML of the nested <table> inside a workout row.
 */
function extractWorkoutSteps(nestedTableHtml: string): string {
  const lines: string[] = [];

  // Extract all <p> content in order
  const pRegex = /<p[^>]*>(.*?)<\/p>/gi;
  let match;
  while ((match = pRegex.exec(nestedTableHtml)) !== null) {
    const text = stripHtml(match[1]).trim();
    if (!text || text === " ") {
      // Blank line separator
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
    } else if (text.startsWith("- ") || text.startsWith("• ")) {
      lines.push(normalizeWorkoutStep(text));
    } else {
      lines.push(normalizeSectionHeader(text));
    }
  }

  // Trim trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines.join("\n");
}

/**
 * Parse the mammoth HTML output to extract all workouts with native intervals.icu text.
 */
function parseWorkoutsFromHtml(html: string): ExtractedWorkout[] {
  const workouts: ExtractedWorkout[] = [];

  // Track week context
  let currentWeek = 0;
  let currentTheme = "";

  // Extract week headers from the full text
  const weekHeaders: Array<{ week: number; theme: string; pos: number }> = [];
  const weekRegex = /Week\s+(\d+)<\/strong><strong>\s*[-–—]\s*([^<]+)/gi;
  let wm;
  while ((wm = weekRegex.exec(html)) !== null) {
    weekHeaders.push({
      week: parseInt(wm[1], 10),
      theme: wm[2].replace(/\s*·.*$/, "").trim(),
      pos: wm.index,
    });
  }

  // Find each workout by looking for date patterns in <strong> tags within <td>
  // Pattern: <td><p><strong>Wed 15 Apr 2026</strong></p></td>
  const dateRegex = /<td[^>]*><p><strong>((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+(\d{1,2})\s+(\w{3})\s+(\d{4}))<\/strong><\/p><\/td>/gi;

  let dm;
  while ((dm = dateRegex.exec(html)) !== null) {
    const fullDateStr = dm[1];
    const day = parseInt(dm[2], 10);
    const monthStr = dm[3].toLowerCase();
    const year = parseInt(dm[4], 10);
    const month = MONTHS[monthStr];
    if (month === undefined) continue;

    const date = new Date(year, month, day);
    const datePos = dm.index;

    // Determine week context
    for (const wh of weekHeaders) {
      if (wh.pos < datePos) {
        currentWeek = wh.week;
        currentTheme = wh.theme;
      }
    }

    // Extract the rest of the workout from the surrounding table
    // The workout table structure after the date <td> continues with:
    // <td>S1</td><td>Easy</td><td>pace</td><td>HR Zone</td>
    // Then: <tr><td colspan="5">description</td></tr>
    // Then: <tr><td colspan="5"><table>...workout steps...</table></td></tr>
    // Then: </table>

    // Find the enclosing outer table by searching forward for the matching </table>
    // We need to find the section from the date to the end of the outer table
    const afterDate = html.substring(datePos);

    // Extract session (S1, S2, S3)
    const sessionMatch = afterDate.match(/<td[^>]*><p><strong>S(\d)<\/strong><\/p><\/td>/i);
    const session = sessionMatch ? `S${sessionMatch[1]}` : "S1";

    // Extract type
    const typeMatch = afterDate.match(/<td[^>]*><p><strong>(Easy|Tempo|Long|Race\s*Pace|RACE)<\/strong><\/p><\/td>/i);
    const type = typeMatch ? typeMatch[1] : "Easy";

    // Extract HR zone
    const hrZoneMatch = afterDate.match(/HR Zone<\/p><p><strong>(Z[\d][\s–-]*(?:Z\d)?)/i) ||
                        afterDate.match(/(Z\d[\s–-]*Z\d)/i);
    const hrZone = hrZoneMatch ? hrZoneMatch[1].replace(/\s/g, "") : "Z2";

    // Extract target pace
    const paceMatch = afterDate.match(/Target pace<\/p><p><strong>([^<]+)<\/strong>/i);
    const targetPace = paceMatch ? stripHtml(paceMatch[1]) : "";

    // Extract coach description from colspan row
    const descMatch = afterDate.match(/<tr><td colspan="5"><p>([^<]+)<\/p><\/td><\/tr>/i);
    const description = descMatch ? stripHtml(descMatch[1]) : "";

    // Extract the nested table with workout steps
    // Pattern: <td colspan="5"><table><tr><td>...<p>steps</p>...</td></tr></table></td>
    const nestedMatch = afterDate.match(/<td colspan="5"><table><tr><td>([\s\S]*?)<\/td><\/tr><\/table><\/td>/i);
    let intervalsText = "";

    if (nestedMatch) {
      intervalsText = extractWorkoutSteps(nestedMatch[0]);
    }

    // Skip duplicate date+session combos
    const dateKey = `${date.toISOString()}-${session}`;
    if (workouts.some(w => `${w.date.toISOString()}-${w.session}` === dateKey)) continue;

    workouts.push({
      date,
      type: type.charAt(0).toUpperCase() + type.slice(1).toLowerCase(),
      session,
      description,
      targetPace,
      hrZone,
      weekNumber: currentWeek,
      weekTheme: currentTheme,
      intervalsText,
    });
  }

  return workouts;
}

/**
 * Parse intervals.icu text into display segments for the markdown table.
 */
function parseIntervalsTextToSegments(text: string): Array<{
  segment: string; duration: string; target: string; hrZone: string; notes: string;
}> {
  const segments: Array<{ segment: string; duration: string; target: string; hrZone: string; notes: string }> = [];
  const lines = text.split("\n");
  let currentSection = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Section header (not a step line)
    if (!trimmed.startsWith("- ")) {
      currentSection = trimmed.replace(/\s*\d+x\s*$/i, "").trim();
      continue;
    }

    // Step line: "- 5m 132-154bpmHR"
    const stepText = trimmed.slice(2).trim();
    const durationMatch = stepText.match(/(\d+m\d+s|\d+m|\d+s)\b/i);

    let duration = "";
    if (durationMatch) {
      const durationText = durationMatch[1].toLowerCase();
      if (/^\d+m\d+s$/.test(durationText)) {
        const [, mins, secs] = durationText.match(/(\d+)m(\d+)s/) || [];
        duration = `${mins} min ${secs} sec`;
      } else if (/m/.test(durationText)) {
        duration = `${durationText.replace("m", "")} min`;
      } else if (/s/.test(durationText)) {
        duration = `${durationText.replace("s", "")} sec`;
      }
    }

    const hrZone = bpmRangeToZone(stepText);

    // Segment name from section header
    let segName = currentSection || "Main";
    if (/warm/i.test(currentSection)) segName = "Warm-up";
    else if (/cool/i.test(currentSection)) segName = "Cool-down";
    else if (/recover/i.test(currentSection)) segName = "Recovery";

    const target = stepText
      .replace(/\d+m\d+s|\d+m|\d+s/gi, "")
      .replace(/\d{2,3}\s*[-–]\s*\d{2,3}\s*bpm\s*HR/gi, "")
      .replace(/Z\d(?:\s*[-–]\s*Z\d)?\s*HR/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    segments.push({ segment: segName, duration, target, hrZone, notes: "" });
  }

  return segments;
}

/**
 * Convert extracted workouts to markdown with embedded intervals.icu text.
 */
function workoutsToMarkdown(workouts: ExtractedWorkout[], planTitle: string): string {
  const lines: string[] = [];
  lines.push(`# ${planTitle}`);
  lines.push("");

  let currentWeek = 0;

  for (const w of workouts) {
    if (w.weekNumber !== currentWeek && w.weekNumber > 0) {
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

    // Calculate total duration from intervals text
    const minMatches = w.intervalsText.match(/(\d+)m\b/g) || [];
    const secMatches = w.intervalsText.match(/(\d+)s\b/g) || [];
    let totalSecs = 0;
    for (const m of minMatches) totalSecs += parseInt(m, 10) * 60;
    for (const s of secMatches) totalSecs += parseInt(s, 10);
    const totalMin = Math.round(totalSecs / 60) || 30;

    const title = `${w.type} Run (${totalMin} min)`;

    lines.push(`**${dayName} ${dateStr}** – ${title}`);
    lines.push("");

    // Build display segment table
    const segments = parseIntervalsTextToSegments(w.intervalsText);
    if (segments.length > 0) {
      lines.push("| Segment | Duration | Target | HR Zone | Notes |");
      lines.push("|---------|----------|--------|---------|-------|");
      for (const seg of segments) {
        lines.push(`| ${seg.segment} | ${seg.duration} | ${seg.target} | ${seg.hrZone} | ${seg.notes || ""} |`);
      }
      lines.push("");
    }

    // Embed native intervals.icu workout text in a fenced code block
    if (w.intervalsText) {
      lines.push("~~~intervals");
      lines.push(w.intervalsText);
      lines.push("~~~");
      lines.push("");
    }

    // Add coaching note
    if (w.description && w.description.length > 10) {
      lines.push(`> 💡 ${w.description}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Import a DOCX file and convert to the app's markdown training plan format.
 * Preserves native intervals.icu workout text for direct sync.
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

  // Extract HTML (preserves table structure with workout steps)
  const htmlResult = await mammoth.convertToHtml({ arrayBuffer });
  const html = htmlResult.value;

  // Also get raw text for metadata extraction
  const textResult = await mammoth.extractRawText({ arrayBuffer });
  const text = textResult.value;

  // Extract plan metadata
  const titleMatch = text.match(/(\d+[\s-]*Week\s+\w+\s+Plan)/i) ||
                     text.match(/(Running\s+Plan)/i);
  const planTitle = titleMatch ? titleMatch[1] : "Imported Training Plan";

  const distanceMatch = text.match(/(?:Goal|Target):\s*(?:Sub[\s-]?\d+[:\d]*\s+)?(\d+k|half[\s-]*marathon|marathon)/i);
  const raceDistance = distanceMatch
    ? distanceMatch[1].toLowerCase().replace(/\s+/g, "-")
    : "5k";

  // Parse workouts from HTML
  const workouts = parseWorkoutsFromHtml(html);

  if (workouts.length === 0) {
    throw new Error("No workouts found in the document. Make sure the plan contains dates and workout descriptions.");
  }

  // Infer training days
  const dayCounts: Record<string, number> = {};
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const w of workouts) {
    const dayName = dayNames[w.date.getDay()];
    dayCounts[dayName] = (dayCounts[dayName] || 0) + 1;
  }
  const trainingDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([d]) => d)
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
