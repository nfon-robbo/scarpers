/**
 * FIT Training Plan Importer
 *
 * Accepts standalone .fit files and/or .zip archives containing them, parses
 * each one, and converts the resulting activities into the same markdown
 * format used by the AI/DOCX-generated plans. Each FIT file becomes one
 * workout placed on the date encoded in its start_time.
 */

import { parseFitBuffer, parseZipFile, type ParsedActivity } from "./fit-parser";

interface FitPlanImportResult {
  markdown: string;
  workoutCount: number;
  startDate: string;
  endDate: string;
  raceDistance: string;
  trainingDays: string[];
  errors: string[];
}

const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function toDmy(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO week number
function isoWeek(d: Date): number {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  return Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function formatDistance(meters: number | null): string {
  if (!meters) return "";
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatPace(speedKmh: number | null): string {
  if (!speedKmh || speedKmh <= 0) return "";
  const secsPerKm = 3600 / speedKmh;
  const m = Math.floor(secsPerKm / 60);
  const s = Math.round(secsPerKm % 60);
  return `${m}:${pad(s)}/km`;
}

function workoutTitle(a: ParsedActivity): string {
  const sport = a.activity_type ? a.activity_type.charAt(0).toUpperCase() + a.activity_type.slice(1) : "Workout";
  const parts: string[] = [];
  const dist = formatDistance(a.distance_meters);
  const dur = formatDuration(a.duration_seconds);
  if (dist) parts.push(dist);
  if (dur) parts.push(dur);
  return parts.length ? `${sport} (${parts.join(", ")})` : sport;
}

function activitiesToMarkdown(activities: ParsedActivity[]): string {
  const lines: string[] = [];
  lines.push("# Imported Training Plan");
  lines.push("");

  let currentWeekKey = "";
  let weekIndex = 0;

  for (const a of activities) {
    if (!a.start_time) continue;
    const date = new Date(a.start_time);
    const weekKey = `${date.getFullYear()}-W${isoWeek(date)}`;
    if (weekKey !== currentWeekKey) {
      currentWeekKey = weekKey;
      weekIndex += 1;
      lines.push("");
      lines.push(`### Week ${weekIndex}`);
      lines.push("");
    }

    const dayName = date.toLocaleDateString("en-GB", { weekday: "long" });
    lines.push(`**${dayName} ${toDmy(date)}** – ${workoutTitle(a)}`);
    lines.push("");

    const dur = formatDuration(a.duration_seconds);
    const dist = formatDistance(a.distance_meters);
    const pace = formatPace(a.avg_speed);
    const hr = a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)} bpm avg` : "";

    lines.push("| Segment | Duration | Target | HR Zone | Notes |");
    lines.push("|---------|----------|--------|---------|-------|");
    lines.push(`| Main | ${dur || "—"} | ${[dist, pace].filter(Boolean).join(" @ ") || "—"} | ${hr || "—"} | Imported from ${a.source_file} |`);
    lines.push("");
  }

  return lines.join("\n");
}

// Try to pull a YYYY-MM-DD or DD-MM-YYYY date out of a filename
function extractDateFromName(name: string): Date | null {
  const base = name.replace(/^.*[\\/]/, "");
  // ISO: 2026-04-21 or 20260421
  let m = base.match(/(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  // DD-MM-YYYY or DD_MM_YYYY
  m = base.match(/(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2})/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export async function importFitPlan(files: File[]): Promise<FitPlanImportResult> {
  const activities: ParsedActivity[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith(".zip")) {
        const r = await parseZipFile(file);
        activities.push(...r.activities);
        errors.push(...r.errors);
      } else if (lower.endsWith(".fit")) {
        const buf = await file.arrayBuffer();
        const parsed = await parseFitBuffer(buf, file.name);
        activities.push(...parsed);
      } else {
        errors.push(`Skipped unsupported file: ${file.name}`);
      }
    } catch (e: any) {
      errors.push(e?.message || `Failed to parse ${file.name}`);
    }
  }

  if (activities.length === 0) {
    throw new Error(
      errors.length
        ? `No workouts could be parsed. ${errors[0]}`
        : "No workouts were found in the selected files."
    );
  }

  // Fill missing start_times from the source filename when possible
  for (const a of activities) {
    if (!a.start_time) {
      const fromName = extractDateFromName(a.source_file || "");
      if (fromName) {
        // Use noon to avoid TZ edge cases
        fromName.setHours(12, 0, 0, 0);
        a.start_time = fromName.toISOString();
      }
    }
  }

  const dated = activities.filter((a) => !!a.start_time);
  const undated = activities.filter((a) => !a.start_time);

  // Place undated workouts on consecutive days starting the day after the latest
  // dated workout (or today if none). Users can move them via the existing UI.
  let cursor = new Date();
  cursor.setHours(12, 0, 0, 0);
  if (dated.length) {
    const maxTs = Math.max(...dated.map((a) => new Date(a.start_time!).getTime()));
    cursor = new Date(maxTs);
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(12, 0, 0, 0);
  }
  for (const a of undated) {
    a.start_time = cursor.toISOString();
    cursor = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }

  const all = [...dated, ...undated].sort(
    (a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime()
  );

  const markdown = activitiesToMarkdown(all);
  const startDate = toIso(new Date(all[0].start_time!));
  const endDate = toIso(new Date(all[all.length - 1].start_time!));

  // Infer training days from weekday frequency
  const dayCounts: Record<string, number> = {};
  for (const a of all) {
    const name = DAY_NAMES_SHORT[new Date(a.start_time!).getDay()];
    dayCounts[name] = (dayCounts[name] || 0) + 1;
  }
  const trainingDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d)
    .sort((a, b) => DAY_NAMES_SHORT.indexOf(a) - DAY_NAMES_SHORT.indexOf(b));

  // Best-effort race distance guess from longest activity
  const longest = [...all].sort((a, b) => (b.distance_meters || 0) - (a.distance_meters || 0))[0];
  const longestKm = (longest?.distance_meters || 0) / 1000;
  let raceDistance = "5k";
  if (longestKm >= 35) raceDistance = "marathon";
  else if (longestKm >= 18) raceDistance = "half-marathon";
  else if (longestKm >= 9) raceDistance = "10k";

  if (undated.length) {
    errors.unshift(
      `${undated.length} workout(s) had no date — placed on consecutive days starting ${toIso(new Date(undated[0].start_time!))}. Tap a workout to reschedule.`
    );
  }

  return {
    markdown,
    workoutCount: all.length,
    startDate,
    endDate,
    raceDistance,
    trainingDays,
    errors,
  };
}
