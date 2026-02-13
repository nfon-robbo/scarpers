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

      // Extract records — in cascade mode they may be nested in sessions/laps
      let records = data?.records || [];
      if (records.length === 0) {
        const allSessions = data?.sessions || data?.activity?.sessions || [];
        for (const s of allSessions) {
          if (s.laps) {
            for (const lap of s.laps) {
              if (lap.records) records = records.concat(lap.records);
            }
          }
          if (s.records) records = records.concat(s.records);
        }
      }
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

      // Compute record-level fallbacks for fields missing from session
      const recordCadences = records.map((r: any) => r.cadence ?? r.running_cadence).filter(Boolean);
      const recordPowers = records.map((r: any) => r.power).filter((v: any) => v != null && v > 0);
      const recordTemps = records.map((r: any) => r.temperature).filter((v: any) => v != null);
      const recordAltitudes = records.map((r: any) => r.altitude ?? r.enhanced_altitude).filter((v: any) => v != null);
      let recAscent = 0, recDescent = 0;
      for (let i = 1; i < recordAltitudes.length; i++) {
        const diff = recordAltitudes[i] - recordAltitudes[i - 1];
        if (diff > 0) recAscent += diff; else recDescent += Math.abs(diff);
      }

      // Extract session-level data — try multiple paths
      const sessions = data?.sessions || data?.activity?.sessions || [];
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
            avg_power: session.avg_power ?? (recordPowers.length ? recordPowers.reduce((a: number, b: number) => a + b, 0) / recordPowers.length : null),
            max_power: session.max_power ?? (recordPowers.length ? Math.max(...recordPowers) : null),
            avg_cadence: session.avg_cadence ?? session.avg_running_cadence ?? (recordCadences.length ? recordCadences.reduce((a: number, b: number) => a + b, 0) / recordCadences.length : null),
            total_ascent: session.total_ascent != null ? session.total_ascent * 1000 : (recordAltitudes.length > 1 ? recAscent * 1000 : null),
            total_descent: session.total_descent != null ? session.total_descent * 1000 : (recordAltitudes.length > 1 ? recDescent * 1000 : null),
            calories: session.total_calories ?? null,
            avg_temperature: session.avg_temperature ?? (recordTemps.length ? recordTemps.reduce((a: number, b: number) => a + b, 0) / recordTemps.length : null),
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
          const powers = records.map((r: any) => r.power).filter((v: any) => v != null && v > 0);
          const cadences = records.map((r: any) => r.cadence ?? r.running_cadence).filter(Boolean);
          const temps = records.map((r: any) => r.temperature).filter((v: any) => v != null);

          // Compute elevation gain/loss from altitude data
          const altitudes = records.map((r: any) => r.altitude ?? r.enhanced_altitude).filter((v: any) => v != null);
          let totalAscent = 0;
          let totalDescent = 0;
          for (let i = 1; i < altitudes.length; i++) {
            const diff = altitudes[i] - altitudes[i - 1];
            if (diff > 0) totalAscent += diff;
            else totalDescent += Math.abs(diff);
          }

          // Compute distance from GPS track if not available
          let distanceMeters: number | null = last.distance ? last.distance * 1000 : null;
          if (!distanceMeters && gpsTrack.length >= 2) {
            let d = 0;
            for (let i = 1; i < gpsTrack.length; i++) {
              d += haversineDistance(gpsTrack[i - 1].lat, gpsTrack[i - 1].lng, gpsTrack[i].lat, gpsTrack[i].lng);
            }
            distanceMeters = Math.round(d);
          }

          activities.push({
            activity_type: data?.sport?.sport || null,
            start_time: first.timestamp ? new Date(first.timestamp).toISOString() : null,
            duration_seconds: first.timestamp && last.timestamp
              ? (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) / 1000
              : null,
            distance_meters: distanceMeters,
            avg_heart_rate: hrs.length ? hrs.reduce((a: number, b: number) => a + b, 0) / hrs.length : null,
            max_heart_rate: hrs.length ? Math.max(...hrs) : null,
            avg_speed: speeds.length ? speeds.reduce((a: number, b: number) => a + b, 0) / speeds.length : null,
            max_speed: speeds.length ? Math.max(...speeds) : null,
            avg_power: powers.length ? powers.reduce((a: number, b: number) => a + b, 0) / powers.length : null,
            max_power: powers.length ? Math.max(...powers) : null,
            avg_cadence: cadences.length ? cadences.reduce((a: number, b: number) => a + b, 0) / cadences.length : null,
            total_ascent: altitudes.length > 1 ? totalAscent * 1000 : null,
            total_descent: altitudes.length > 1 ? totalDescent * 1000 : null,
            calories: null,
            avg_temperature: temps.length ? temps.reduce((a: number, b: number) => a + b, 0) / temps.length : null,
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

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
