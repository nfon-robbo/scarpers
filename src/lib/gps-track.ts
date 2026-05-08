export interface GpsTrackPoint {
  lat: number;
  lng?: number;
  lon?: number;
  time?: string;
  elapsed_time?: number;
  distance_meters?: number;
}

const lonOf = (p: GpsTrackPoint) => p.lng ?? p.lon;

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidPoint(p: GpsTrackPoint): boolean {
  const lon = lonOf(p);
  return (
    Number.isFinite(p.lat) &&
    Number.isFinite(lon) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(lon!) <= 180 &&
    Math.abs(p.lat) > 0.01
  );
}

function pointDistance(a: GpsTrackPoint, b: GpsTrackPoint): number {
  return haversineDistance(a.lat, lonOf(a)!, b.lat, lonOf(b)!);
}

function distanceDelta(a: GpsTrackPoint, b: GpsTrackPoint): number | null {
  return a.distance_meters != null && b.distance_meters != null
    ? Math.abs(Number(b.distance_meters) - Number(a.distance_meters))
    : null;
}

function elapsedDelta(a: GpsTrackPoint, b: GpsTrackPoint): number | null {
  if (a.elapsed_time != null && b.elapsed_time != null) return Math.abs(Number(b.elapsed_time) - Number(a.elapsed_time));
  if (a.time && b.time) {
    const dt = Math.abs(new Date(b.time).getTime() - new Date(a.time).getTime()) / 1000;
    return Number.isFinite(dt) ? dt : null;
  }
  return null;
}

export function cleanGpsTrack<T extends GpsTrackPoint>(track: T[]): T[] {
  const valid = track.filter(isValidPoint);
  if (valid.length < 3) return valid;

  return valid.filter((point, index) => {
    if (index === 0 || index === valid.length - 1) return true;
    const prev = valid[index - 1];
    const next = valid[index + 1];
    const inMeters = pointDistance(prev, point);
    const outMeters = pointDistance(point, next);
    const skipMeters = pointDistance(prev, next);

    // Remove single-point GPS spikes where the watch jumps away then immediately returns.
    return !(inMeters > 35 && outMeters > 35 && skipMeters < Math.max(20, Math.min(inMeters, outMeters) * 0.25));
  });
}

export function segmentGpsTrack<T extends GpsTrackPoint>(track: T[]): T[][] {
  const clean = cleanGpsTrack(track);
  if (clean.length < 2) return clean.length ? [clean] : [];

  const segments: T[][] = [[clean[0]]];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const point = clean[i];
    const meters = pointDistance(prev, point);
    const fitMeters = distanceDelta(prev, point);
    const seconds = elapsedDelta(prev, point);
    const distanceMismatch = fitMeters != null && meters > 25 && meters > fitMeters * 4 + 15;
    const impossibleRunSpeed = seconds != null && seconds > 0 && seconds <= 10 && meters / seconds > 8;

    if (distanceMismatch || impossibleRunSpeed) {
      segments.push([point]);
    } else {
      segments[segments.length - 1].push(point);
    }
  }

  return segments.filter((segment) => segment.length > 1);
}