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

  // Keep only activities with a usable start_time, then sort chronologically
  const dated = activities
    .filter((a) => !!a.start_time)
    .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime());

  if (dated.length === 0) {
    throw new Error(
      errors.length
        ? `No workouts with dates were found. ${errors[0]}`
        : "No workouts with dates were found in the FIT files."
    );
  }

  const markdown = activitiesToMarkdown(dated);
  const startDate = toIso(new Date(dated[0].start_time!));
  const endDate = toIso(new Date(dated[dated.length - 1].start_time!));

  // Infer training days from weekday frequency
  const dayCounts: Record<string, number> = {};
  for (const a of dated) {
    const name = DAY_NAMES_SHORT[new Date(a.start_time!).getDay()];
    dayCounts[name] = (dayCounts[name] || 0) + 1;
  }
  const trainingDays = Object.entries(dayCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d)
    .sort((a, b) => DAY_NAMES_SHORT.indexOf(a) - DAY_NAMES_SHORT.indexOf(b));

  // Best-effort race distance guess from longest activity
  const longest = [...dated].sort((a, b) => (b.distance_meters || 0) - (a.distance_meters || 0))[0];
  const longestKm = (longest?.distance_meters || 0) / 1000;
  let raceDistance = "5k";
  if (longestKm >= 35) raceDistance = "marathon";
  else if (longestKm >= 18) raceDistance = "half-marathon";
  else if (longestKm >= 9) raceDistance = "10k";

  return {
    markdown,
    workoutCount: dated.length,
    startDate,
    endDate,
    raceDistance,
    trainingDays,
    errors,
  };
}
