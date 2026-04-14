/**
 * DOCX Training Plan Importer
 * 
 * Parses a Word doc training plan that contains native intervals.icu
 * workout text blocks and preserves them for direct sync.
 */

import * as mammoth from "mammoth";

interface ExtractedWorkout {
  date: Date;
  dateStr: string;       // e.g. "Wed 15 Apr 2026"
  type: string;          // Easy, Tempo, Long, Race Pace, etc.
  session: string;       // S1, S2, S3
  description: string;   // Coach description text
  targetPace: string;    // e.g. "11:30–12:30/mi"
  hrZone: string;        // e.g. "Z2", "Z1–Z2", "Z3–Z4"
  weekNumber: number;
  weekTheme: string;
  intervalsText: string; // Native intervals.icu workout text block
}

/**
 * Extract the native intervals.icu workout text from nested tables.
 * These look like:
 *   Warmup
 *   - Warmup walk 5m Z1 HR
 *   Easy run
 *   - Easy run/walk 20m Z2 HR
 *   Cooldown
 *   - Cooldown walk 5m Z1 HR
 */
function extractIntervalsTextFromTable(tableHtml: string): string | null {
  // Look for nested table content with the workout steps
  // The pattern is: Section name followed by "- step description"
  const lines: string[] = [];
  
  // Extract text content from <p> tags in order
  const pMatches = tableHtml.match(/<p[^>]*>(?:<b>)?(.*?)(?:<\/b>)?<\/p>/gi) || [];
  
  for (const p of pMatches) {
    const text = p.replace(/<[^>]+>/g, "").trim();
    if (!text) {
      // Empty <p> = blank line separator
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      continue;
    }
    lines.push(text);
  }
  
  // Check if this looks like a workout text block (has "- " step lines with zone refs)
  const hasSteps = lines.some(l => l.startsWith("- ") && /Z\d/i.test(l));
  if (!hasSteps) return null;
  
  return lines.join("\n").trim();
}

/**
 * Parse the full DOCX HTML to extract workouts with their native intervals.icu text.
 */
function parseWorkoutsFromHtml(html: string): ExtractedWorkout[] {
  const workouts: ExtractedWorkout[] = [];
  let currentWeek = 0;
  let currentTheme = "";

  // Find week headers
  const weekHeaderRegex = /Week\s+(\d+)\s*(?:<\/b>)?(?:<b>)?[-–—]\s*(?:<\/b>)?(?:<b>)?\s*([^<·]+)/gi;
  
  // Split into workout sections by looking for date patterns in table headers
  // Date pattern: "Wed 15 Apr 2026" or similar
  const dateTableRegex = /<table[^>]*>[\s\S]*?<\/table>/gi;
  const tables = html.match(dateTableRegex) || [];
  
  // Process the HTML linearly to maintain week context
  const fullText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  
  // Extract week info
  const weekMatches = [...fullText.matchAll(/Week\s+(\d+)\s*[-–—]\s*([^·]+?)(?:\s*·|\s*Coach)/gi)];
  const weekMap: Array<{ week: number; theme: string; pos: number }> = weekMatches.map(m => ({
    week: parseInt(m[1], 10),
    theme: m[2].trim(),
    pos: m.index || 0,
  }));

  // Find all workout blocks: date header table + nested workout text table
  // Pattern: table with date → coach description → nested table with workout steps
  const dateRegex = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/gi;
  
  // Process tables to find workout sections
  for (let t = 0; t < tables.length; t++) {
    const table = tables[t];
    
    // Check if this table contains a date header
    const dateMatch = table.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
    if (!dateMatch) continue;
    
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    
    const day = parseInt(dateMatch[1], 10);
    const month = months[dateMatch[2].toLowerCase()];
    const year = parseInt(dateMatch[3], 10);
    if (month === undefined) continue;
    
    const date = new Date(year, month, day);
    
    // Determine which week this belongs to
    const tablePos = html.indexOf(table);
    for (const w of weekMap) {
      if (w.pos < tablePos) {
        currentWeek = w.week;
        currentTheme = w.theme;
      }
    }
    
    // Extract session (S1, S2, S3)
    const sessionMatch = table.match(/\bS(\d)\b/);
    const session = sessionMatch ? `S${sessionMatch[1]}` : "S1";
    
    // Extract type (Easy, Tempo, Long, Race Pace, RACE)
    const tableText = table.replace(/<[^>]+>/g, " ");
    const typeMatch = tableText.match(/\b(Easy|Tempo|Long|Race\s*Pace|RACE)\b/i);
    const type = typeMatch ? typeMatch[1] : "Easy";
    
    // Extract HR zone
    const hrZoneMatch = tableText.match(/HR Zone[\s\S]*?(Z\d[\s–-]*(?:Z\d)?)/i) ||
                        tableText.match(/(Z\d[\s–-]*Z\d)/i) ||
                        tableText.match(/(Z\d)/i);
    const hrZone = hrZoneMatch ? hrZoneMatch[1].replace(/\s/g, "") : "Z2";
    
    // Extract target pace
    const paceMatch = tableText.match(/(\d{1,2}:\d{2}[\s–-]+\d{1,2}:\d{2}\/mi)/i) ||
                      tableText.match(/(\d{1,2}:\d{2}[\s–-]+\d{1,2}:\d{2})/i);
    const targetPace = paceMatch ? paceMatch[1] : "";
    
    // Extract coach description from colspan cell
    const descMatch = table.match(/<td[^>]*colspan[^>]*>[\s\S]*?<p[^>]*>(?:<b>)?([\s\S]*?)(?:<\/b>)?<\/p>[\s\S]*?<\/td>/i);
    const description = descMatch 
      ? descMatch[1].replace(/<[^>]+>/g, "").trim()
      : "";
    
    // Extract native intervals.icu workout text from nested table
    const nestedTableMatch = table.match(/<td[^>]*colspan[^>]*>[\s\S]*?(<table[\s\S]*?<\/table>)[\s\S]*?<\/td>/i);
    let intervalsText = "";
    
    if (nestedTableMatch) {
      const extracted = extractIntervalsTextFromTable(nestedTableMatch[1]);
      if (extracted) {
        intervalsText = extracted;
      }
    }
    
    // Skip if we already have this date+session (avoid duplicates)
    const dateKey = `${date.toISOString()}-${session}`;
    if (workouts.some(w => `${w.date.toISOString()}-${w.session}` === dateKey)) continue;
    
    workouts.push({
      date,
      dateStr: dateMatch[0],
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
 * Convert extracted workouts to markdown with embedded intervals.icu text.
 */
function workoutsToMarkdown(workouts: ExtractedWorkout[], planTitle: string): string {
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

    // Extract total minutes from intervals text
    const minMatches = w.intervalsText.match(/(\d+)m\b/g) || [];
    const secMatches = w.intervalsText.match(/(\d+)s\b/g) || [];
    let totalSecs = 0;
    for (const m of minMatches) totalSecs += parseInt(m, 10) * 60;
    for (const s of secMatches) totalSecs += parseInt(s, 10);
    const totalMin = Math.round(totalSecs / 60) || 30;
    
    const title = `${w.type} Run (${totalMin} min)`;

    lines.push(`**${dayName} ${dateStr}** – ${title}`);
    lines.push("");

    // Build segment table for display
    const segments = parseIntervalsTextToSegments(w.intervalsText, w.hrZone);
    lines.push("| Segment | Duration | Target | HR Zone | Notes |");
    lines.push("|---------|----------|--------|---------|-------|");
    for (const seg of segments) {
      lines.push(`| ${seg.segment} | ${seg.duration} | ${seg.target} | ${seg.hrZone} | ${seg.notes || ""} |`);
    }
    lines.push("");
    
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
 * Parse intervals.icu text into display segments for the table.
 */
function parseIntervalsTextToSegments(text: string, defaultZone: string): Array<{
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
      // Check for repeat pattern like "Pickups 4x" or "Tempo set 2x" or "Race pace intervals 3x"
      const repeatMatch = trimmed.match(/(\d+)x\s*$/i);
      if (repeatMatch) {
        currentSection = trimmed.replace(/\s*\d+x\s*$/i, "").trim();
      } else {
        currentSection = trimmed;
      }
      continue;
    }
    
    // Step line: "- Warmup walk 5m Z1 HR"
    const stepText = trimmed.slice(2).trim();
    const durMatch = stepText.match(/(\d+)m\b/i);
    const secMatch = stepText.match(/(\d+)s\b/i);
    const zoneMatch = stepText.match(/(Z\d(?:\s*[-–]\s*Z\d)?)\s*HR/i) || stepText.match(/(Z\d(?:\s*[-–]\s*Z\d)?)/i);
    
    let duration = "";
    if (durMatch) duration = `${durMatch[1]} min`;
    else if (secMatch) duration = `${secMatch[1]} sec`;
    
    const hrZone = zoneMatch ? zoneMatch[1].replace(/\s/g, "") : defaultZone;
    
    // Determine segment name from section header or step text
    let segName = currentSection || "Main";
    if (/warm/i.test(stepText)) segName = "Warm-up";
    else if (/cool/i.test(stepText)) segName = "Cool-down";
    else if (/recover/i.test(stepText)) segName = "Recovery";
    
    // Target from step text (remove duration and zone parts)
    const target = stepText
      .replace(/\d+[ms]\b/g, "")
      .replace(/Z\d(?:\s*[-–]\s*Z\d)?\s*HR/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    
    segments.push({
      segment: segName,
      duration,
      target,
      hrZone,
      notes: "",
    });
  }
  
  return segments;
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
  
  // Extract both HTML and raw text
  const [htmlResult, textResult] = await Promise.all([
    mammoth.convertToHtml({ arrayBuffer }),
    mammoth.extractRawText({ arrayBuffer }),
  ]);
  
  const html = htmlResult.value;
  const text = textResult.value;

  // Extract plan metadata from raw text
  const titleMatch = text.match(/(\d+[\s-]*Week\s+\w+\s+Plan)/i) ||
                     text.match(/(Running\s+Plan)/i);
  const planTitle = titleMatch ? titleMatch[1] : "Imported Training Plan";

  const distanceMatch = text.match(/(?:Goal|Target):\s*(?:Sub[\s-]?\d+[:\d]*\s+)?(\d+k|half[\s-]*marathon|marathon)/i);
  const raceDistance = distanceMatch 
    ? distanceMatch[1].toLowerCase().replace(/\s+/g, "-") 
    : "5k";

  // Parse workouts from HTML to get native intervals.icu text blocks
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
