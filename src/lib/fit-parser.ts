import JSZip from "jszip";
import FitParser from "fit-file-parser";

export interface GpsPoint {
  lat: number;
  lng: number;
  time?: string;
  altitude?: number;
  heart_rate?: number;
  speed?: number;
}

export interface ParsedActivity {
  activity_type: string | null;
  start_time: string | null;
  duration_seconds: number | null;
  distance_meters: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  avg_speed: number | null;
  max_speed: number | null;
  avg_power: number | null;
  max_power: number | null;
  avg_cadence: number | null;
  total_ascent: number | null;
  total_descent: number | null;
  calories: number | null;
  avg_temperature: number | null;
  training_effect: number | null;
  training_load: number | null;
  source_file: string;
  gps_track: GpsPoint[];
  raw_data: Record<string, unknown>;
}

export interface ParseResult {
  activities: ParsedActivity[];
  errors: string[];
  fileCount: number;
}

export function parseFitBuffer(buffer: ArrayBuffer, fileName: string): Promise<ParsedActivity[]> {
  return new Promise((resolve, reject) => {
    const fitParser = new FitParser({
      force: true,
      speedUnit: "km/h",
      lengthUnit: "km",
      elapsedRecordField: true,
    });

    fitParser.parse(buffer, (error: any, data: any) => {
      if (error) {
        reject(new Error(`Failed to parse ${fileName}: ${error}`));
        return;
      }

      const activities: ParsedActivity[] = [];

      // Extract GPS track from records
      const records = data?.records || [];
      const gpsTrack: GpsPoint[] = [];
      for (const r of records) {
        const lat = r.position_lat;
        const lng = r.position_long;
        if (lat != null && lng != null && typeof lat === "number" && typeof lng === "number") {
          gpsTrack.push({
            lat,
            lng,
            time: r.timestamp ? new Date(r.timestamp).toISOString() : undefined,
            altitude: r.altitude ?? r.enhanced_altitude ?? undefined,
            heart_rate: r.heart_rate ?? undefined,
            speed: r.speed ?? r.enhanced_speed ?? undefined,
          });
        }
      }

      // Extract session-level data
      const sessions = data?.activity?.sessions || [];
      if (sessions.length > 0) {
        for (const session of sessions) {
          activities.push({
            activity_type: session.sport || session.sub_sport || null,
            start_time: session.start_time ? new Date(session.start_time).toISOString() : null,
            duration_seconds: session.total_timer_time ?? session.total_elapsed_time ?? null,
            distance_meters: session.total_distance ? session.total_distance * 1000 : null,
            avg_heart_rate: session.avg_heart_rate ?? null,
            max_heart_rate: session.max_heart_rate ?? null,
            avg_speed: session.avg_speed ?? session.enhanced_avg_speed ?? null,
            max_speed: session.max_speed ?? session.enhanced_max_speed ?? null,
            avg_power: session.avg_power ?? null,
            max_power: session.max_power ?? null,
            avg_cadence: session.avg_cadence ?? session.avg_running_cadence ?? null,
            total_ascent: session.total_ascent ?? null,
            total_descent: session.total_descent ?? null,
            calories: session.total_calories ?? null,
            avg_temperature: session.avg_temperature ?? null,
            training_effect: session.total_training_effect ?? null,
            training_load: null,
            source_file: fileName,
            gps_track: gpsTrack,
            raw_data: session,
          });
        }
      } else {
        // Fallback: try to extract from records
        if (records.length > 0) {
          const first = records[0];
          const last = records[records.length - 1];
          const hrs = records.map((r: any) => r.heart_rate).filter(Boolean);
          const speeds = records.map((r: any) => r.speed || r.enhanced_speed).filter(Boolean);

          activities.push({
            activity_type: data?.sport?.sport || null,
            start_time: first.timestamp ? new Date(first.timestamp).toISOString() : null,
            duration_seconds: first.timestamp && last.timestamp
              ? (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000
              : null,
            distance_meters: last.distance ? last.distance * 1000 : null,
            avg_heart_rate: hrs.length ? hrs.reduce((a: number, b: number) => a + b, 0) / hrs.length : null,
            max_heart_rate: hrs.length ? Math.max(...hrs) : null,
            avg_speed: speeds.length ? speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length : null,
            max_speed: speeds.length ? Math.max(...speeds) : null,
            avg_power: null,
            max_power: null,
            avg_cadence: null,
            total_ascent: null,
            total_descent: null,
            calories: null,
            avg_temperature: null,
            training_effect: null,
            training_load: null,
            source_file: fileName,
            gps_track: gpsTrack,
            raw_data: { records_count: records.length },
          });
        }
      }

      resolve(activities);
    });
  });
}

export async function parseZipFile(file: File): Promise<ParseResult> {
  const zip = await JSZip.loadAsync(file);
  const activities: ParsedActivity[] = [];
  const errors: string[] = [];
  let fileCount = 0;

  const fitFiles: { name: string; file: JSZip.JSZipObject }[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.toLowerCase().endsWith(".fit")) {
      fitFiles.push({ name: relativePath, file: zipEntry });
    }
  });

  for (const { name, file: zipEntry } of fitFiles) {
    try {
      const buffer = await zipEntry.async("arraybuffer");
      const parsed = await parseFitBuffer(buffer, name);
      activities.push(...parsed);
      fileCount++;
    } catch (e: any) {
      errors.push(e.message || `Error parsing ${name}`);
    }
  }

  if (fitFiles.length === 0) {
    errors.push("No .fit files found in the ZIP archive");
  }

  return { activities, errors, fileCount };
}
