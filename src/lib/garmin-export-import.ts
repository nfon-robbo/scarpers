/**
 * Garmin Connect Export Importer
 *
 * Parses a "Garmin Connect" data export ZIP (the one Garmin emails when you
 * request your data). Imports activities, daily wellness metrics, sleep
 * windows, and bio metrics into Lovable's tables — REPLACING any existing
 * rows that overlap so the export is the source of truth.
 */

import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

export interface GarminImportProgress {
  phase: string;
  current?: number;
  total?: number;
}

export interface GarminImportResult {
  activities: { inserted: number; replaced: number };
  dailyMetrics: { inserted: number; replaced: number };
  sleepDays: number;
  bioMetrics: { heightCm: number | null; weightKg: number | null };
  errors: string[];
}

type Cb = (p: GarminImportProgress) => void;

function readJson<T = any>(zip: JSZip, path: string): Promise<T | null> {
  const f = zip.file(path);
  if (!f) return Promise.resolve(null);
  return f.async("string").then((s) => {
    try { return JSON.parse(s) as T; } catch { return null; }
  });
}

async function findFiles(zip: JSZip, predicate: (p: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  zip.forEach((path, entry) => { if (!entry.dir && predicate(path)) out.push(path); });
  return out;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Garmin "startTimeGmt" is sometimes a number (ms) and sometimes "YYYY-MM-DD HH:MM:SS"
function toIso(v: any): string | null {
  if (v == null) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  const s = String(v).trim();
  if (!s) return null;
  // "2026-04-25T21:35:00.0" or "2026-04-25 21:35:00"
  const norm = s.replace(" ", "T");
  const d = new Date(norm.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(norm) ? norm : norm + "Z");
  return isNaN(d.getTime()) ? null : d.toISOString();
}

export async function isGarminExportZip(file: File): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(file);
    let found = false;
    zip.forEach((path) => { if (path.startsWith("DI_CONNECT/")) found = true; });
    return found;
  } catch {
    return false;
  }
}

export async function importGarminExport(
  file: File,
  userId: string,
  onProgress?: Cb
): Promise<GarminImportResult> {
  const errors: string[] = [];
  const result: GarminImportResult = {
    activities: { inserted: 0, replaced: 0 },
    dailyMetrics: { inserted: 0, replaced: 0 },
    sleepDays: 0,
    bioMetrics: { heightCm: null, weightKg: null },
    errors,
  };

  onProgress?.({ phase: "Opening ZIP" });
  const zip = await JSZip.loadAsync(file);

  // Create an upload record so this import shows in history.
  const { data: uploadRow, error: upErr } = await supabase
    .from("uploads")
    .insert({
      user_id: userId,
      file_name: `Garmin Export: ${file.name}`,
      file_type: "garmin-export",
      record_count: 0,
      status: "processing",
    })
    .select("id")
    .single();
  if (upErr) errors.push(upErr.message);
  const uploadId = uploadRow?.id || null;

  // 1. Activities — DI-Connect-Fitness/*_summarizedActivities.json
  try {
    onProgress?.({ phase: "Reading activities" });
    const actFiles = await findFiles(zip, (p) => /summarizedActivities\.json$/i.test(p));
    const allActs: any[] = [];
    for (const path of actFiles) {
      const raw = await readJson<any[]>(zip, path);
      if (!raw) continue;
      // Shape: [{ summarizedActivitiesExport: [...] }]
      for (const block of raw) {
        const arr = block?.summarizedActivitiesExport || [];
        if (Array.isArray(arr)) allActs.push(...arr);
      }
    }
    onProgress?.({ phase: "Importing activities", total: allActs.length, current: 0 });

    // Build rows
    const rows = allActs.map((a) => {
      const start = toIso(a.startTimeGmt ?? a.beginTimestamp);
      return {
        user_id: userId,
        upload_id: uploadId,
        activity_type: (a.activityType || a.sportType || "other").toString().toLowerCase(),
        start_time: start,
        duration_seconds: a.duration != null ? Math.round(Number(a.duration) / 1000) : null,
        distance_meters: a.distance ?? null,
        avg_heart_rate: a.avgHr ?? null,
        max_heart_rate: a.maxHr ?? null,
        avg_speed: a.avgSpeed ?? null,
        max_speed: a.maxSpeed ?? null,
        avg_power: a.avgPower ?? null,
        max_power: a.maxPower ?? null,
        avg_cadence: a.avgRunCadence ?? a.avgBikeCadence ?? a.avgDoubleCadence ?? null,
        total_ascent: a.elevationGain ?? null,
        total_descent: a.elevationLoss ?? null,
        calories: a.calories ?? null,
        avg_temperature: a.minTemperature != null && a.maxTemperature != null ? (a.minTemperature + a.maxTemperature) / 2 : null,
        training_effect: a.aerobicTrainingEffect ?? null,
        training_load: a.activityTrainingLoad ?? null,
        total_steps: a.steps ? Math.round(a.steps) : null,
        latitude: a.startLatitude ?? null,
        longitude: a.startLongitude ?? null,
        source_file: `garmin-export:${a.activityId}`,
        raw_data: { source: "garmin-export", activityId: a.activityId, name: a.name, garmin: a },
      };
    }).filter((r) => r.start_time);

    // Replace existing by source_file (Garmin activity id) — atomic per-batch.
    const sourceFiles = rows.map((r) => r.source_file);
    if (sourceFiles.length) {
      const chunkSize = 500;
      for (let i = 0; i < sourceFiles.length; i += chunkSize) {
        await supabase.from("activities")
          .delete()
          .eq("user_id", userId)
          .in("source_file", sourceFiles.slice(i, i + chunkSize));
      }
    }

    // Also delete any pre-existing activity at same start_time (overlap from Strava/FIT).
    // Done in a single query per batch using OR of timestamps.
    const startTimes = rows.map((r) => r.start_time!).filter(Boolean);
    if (startTimes.length) {
      const chunkSize = 500;
      for (let i = 0; i < startTimes.length; i += chunkSize) {
        await supabase.from("activities")
          .delete()
          .eq("user_id", userId)
          .in("start_time", startTimes.slice(i, i + chunkSize));
      }
    }

    // Insert in batches
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from("activities").insert(batch as any);
      if (error) { errors.push(`Activities: ${error.message}`); break; }
      result.activities.inserted += batch.length;
      onProgress?.({ phase: "Importing activities", total: rows.length, current: i + batch.length });
    }
  } catch (e: any) {
    errors.push(`Activities: ${e?.message || e}`);
  }

  // 2. Daily metrics — UDSFile_*.json (aggregator)
  try {
    onProgress?.({ phase: "Reading daily wellness" });
    const udsFiles = await findFiles(zip, (p) => /UDSFile_.*\.json$/i.test(p));
    const dailyByDate = new Map<string, any>();
    for (const path of udsFiles) {
      const arr = await readJson<any[]>(zip, path);
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        const date = (r.calendarDate || "").slice(0, 10);
        if (!date) continue;
        // Prefer the entry with most data (richer wellness wins)
        const prev = dailyByDate.get(date);
        if (!prev || Object.keys(r).length > Object.keys(prev).length) dailyByDate.set(date, r);
      }
    }

    // Read sleep windows, sum durations per night
    const sleepFiles = await findFiles(zip, (p) => /_sleepData\.json$/i.test(p));
    const sleepByDate = new Map<string, number>(); // date -> seconds
    for (const path of sleepFiles) {
      const arr = await readJson<any[]>(zip, path);
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        const date = (s.calendarDate || "").slice(0, 10);
        const start = toIso(s.sleepStartTimestampGMT);
        const end = toIso(s.sleepEndTimestampGMT);
        if (!date || !start || !end) continue;
        const secs = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
        if (secs > 0) sleepByDate.set(date, Math.max(sleepByDate.get(date) || 0, secs));
      }
    }
    result.sleepDays = sleepByDate.size;

    onProgress?.({ phase: "Importing daily metrics", total: dailyByDate.size, current: 0 });

    const rows: any[] = [];
    const allDates = new Set<string>([...dailyByDate.keys(), ...sleepByDate.keys()]);
    for (const date of allDates) {
      const r = dailyByDate.get(date) || {};
      rows.push({
        user_id: userId,
        upload_id: uploadId,
        date,
        steps: r.totalSteps ?? null,
        calories_total: r.totalKilocalories ?? null,
        active_calories: r.activeKilocalories ?? null,
        resting_heart_rate: r.restingHeartRate ?? null,
        spo2: r.averageSpo2Value ?? r.latestSpo2Value ?? null,
        sleep_duration_seconds: sleepByDate.get(date) || null,
        source_file: "garmin-export",
        raw_data: { source: "garmin-export", uds: r },
      });
    }

    // Replace existing rows for these dates
    const dates = rows.map((r) => r.date);
    if (dates.length) {
      const chunkSize = 500;
      for (let i = 0; i < dates.length; i += chunkSize) {
        await supabase.from("daily_metrics")
          .delete()
          .eq("user_id", userId)
          .in("date", dates.slice(i, i + chunkSize));
      }
    }

    const batchSize = 200;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase.from("daily_metrics").insert(batch as any);
      if (error) { errors.push(`Daily metrics: ${error.message}`); break; }
      result.dailyMetrics.inserted += batch.length;
      onProgress?.({ phase: "Importing daily metrics", total: rows.length, current: i + batch.length });
    }
  } catch (e: any) {
    errors.push(`Daily metrics: ${e?.message || e}`);
  }

  // 3. Sleep stages — write a single 'sleep' span per night so SleepCalendar shows it.
  try {
    onProgress?.({ phase: "Importing sleep windows" });
    const sleepFiles = await findFiles(zip, (p) => /_sleepData\.json$/i.test(p));
    const stageRows: any[] = [];
    const datesTouched = new Set<string>();
    for (const path of sleepFiles) {
      const arr = await readJson<any[]>(zip, path);
      if (!Array.isArray(arr)) continue;
      for (const s of arr) {
        const date = (s.calendarDate || "").slice(0, 10);
        const start = toIso(s.sleepStartTimestampGMT);
        const end = toIso(s.sleepEndTimestampGMT);
        if (!date || !start || !end) continue;
        const secs = (new Date(end).getTime() - new Date(start).getTime()) / 1000;
        if (secs <= 0) continue;
        datesTouched.add(date);
        stageRows.push({
          user_id: userId,
          date,
          stage: "sleep",
          duration_seconds: Math.round(secs),
          start_time: start,
          end_time: end,
          source: "garmin-export",
        });
      }
    }
    if (datesTouched.size) {
      const dates = Array.from(datesTouched);
      const chunkSize = 500;
      for (let i = 0; i < dates.length; i += chunkSize) {
        await supabase.from("sleep_stages")
          .delete()
          .eq("user_id", userId)
          .in("date", dates.slice(i, i + chunkSize));
      }
    }
    if (stageRows.length) {
      const batchSize = 500;
      for (let i = 0; i < stageRows.length; i += batchSize) {
        const { error } = await supabase.from("sleep_stages").insert(stageRows.slice(i, i + batchSize) as any);
        if (error) { errors.push(`Sleep: ${error.message}`); break; }
      }
    }
  } catch (e: any) {
    errors.push(`Sleep: ${e?.message || e}`);
  }

  // 4. Bio metrics — pick latest height/weight for profile
  try {
    onProgress?.({ phase: "Importing biometrics" });
    const bioFiles = await findFiles(zip, (p) => /userBioMetrics\.json$/i.test(p));
    let latestHeight: { ts: number; v: number } | null = null;
    let latestWeight: { ts: number; v: number } | null = null;
    for (const path of bioFiles) {
      const arr = await readJson<any[]>(zip, path);
      if (!Array.isArray(arr)) continue;
      for (const r of arr) {
        const ts = Number(r?.metaData?.sequence) || 0;
        if (typeof r.height === "number" && r.height > 0 && (!latestHeight || ts > latestHeight.ts)) {
          latestHeight = { ts, v: r.height };
        }
        if (typeof r.weight === "number" && r.weight > 0 && (!latestWeight || ts > latestWeight.ts)) {
          // Garmin weight is grams in many exports; but value here may be kg if realistic
          latestWeight = { ts, v: r.weight };
        }
      }
    }
    const updates: any = {};
    if (latestHeight) {
      updates.height_cm = latestHeight.v > 100 ? latestHeight.v : latestHeight.v * 100;
      result.bioMetrics.heightCm = updates.height_cm;
    }
    if (latestWeight) {
      // Heuristic: > 1000 → grams; otherwise kg
      updates.weight_kg = latestWeight.v > 1000 ? latestWeight.v / 1000 : latestWeight.v;
      result.bioMetrics.weightKg = updates.weight_kg;
    }
    if (Object.keys(updates).length) {
      await supabase.from("profiles").update(updates).eq("user_id", userId);
    }
  } catch (e: any) {
    errors.push(`Biometrics: ${e?.message || e}`);
  }

  // Finalize upload row
  if (uploadId) {
    await supabase.from("uploads").update({
      status: errors.length ? "completed_with_errors" : "completed",
      record_count: result.activities.inserted + result.dailyMetrics.inserted,
    }).eq("id", uploadId);
  }

  onProgress?.({ phase: "Done" });
  return result;
}
