import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Play, Pause, RotateCcw } from "lucide-react";
import { segmentGpsTrack } from "@/lib/gps-track";

interface GpsPoint {
  lat: number;
  lng?: number;
  lon?: number;
  altitude?: number;
  heart_rate?: number;
  speed?: number;
  time?: string;
  elapsed_time?: number;
}

interface Props {
  track: GpsPoint[];
  className?: string;
  interactive?: boolean;
  height?: number;
}

// Speed (m/s) -> HSL hue. Blue (slow) -> Green -> Yellow -> Red (fast).
function speedColor(speed: number, min: number, max: number): string {
  if (!isFinite(speed) || max <= min) return "hsl(152, 60%, 36%)";
  const t = Math.max(0, Math.min(1, (speed - min) / (max - min)));
  // 240 (blue) -> 0 (red)
  const hue = 240 - 240 * t;
  return `hsl(${hue}, 85%, 50%)`;
}

const ActivityMap = ({ track, className = "", interactive = false, height }: Props) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);
  const playMarkerRef = useRef<L.Marker | null>(null);
  const flatPointsRef = useRef<[number, number][]>([]);
  const rafRef = useRef<number | null>(null);
  const playIndexRef = useRef<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasRoute, setHasRoute] = useState(false);
  const [speedRange, setSpeedRange] = useState<{ min: number; max: number } | null>(null);

  useEffect(() => {
    if (!mapRef.current || track.length < 1) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }
    playMarkerRef.current = null;
    flatPointsRef.current = [];
    setIsPlaying(false);
    playIndexRef.current = 0;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: interactive,
      doubleClickZoom: true,
      dragging: true,
      touchZoom: true,
      boxZoom: interactive,
      keyboard: interactive,
    });

    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    const segments = segmentGpsTrack(track)
      .map((segment) =>
        segment
          .filter(
            (p) =>
              p.lat != null &&
              (p.lng != null || p.lon != null) &&
              isFinite(p.lat) &&
              isFinite((p.lng ?? p.lon)!)
          )
          .map((p) => ({
            latlng: [p.lat, (p.lng ?? p.lon)!] as [number, number],
            speed: typeof p.speed === "number" && isFinite(p.speed) ? p.speed : null,
          }))
      )
      .filter((segment) => segment.length > 0);

    const flat = segments.flatMap((s) => s.map((p) => p.latlng));
    flatPointsRef.current = flat;

    if (flat.length === 0) {
      map.remove();
      mapInstance.current = null;
      setHasRoute(false);
      return;
    }

    const makePin = (color: string, letter?: string) =>
      L.divIcon({
        html: `<div style="
          position:relative;width:22px;height:22px;
          background:${color};border:2px solid white;border-radius:50%;
          box-shadow:0 2px 6px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;
          font:700 11px/1 system-ui,sans-serif;color:white;">${letter ?? ""}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        className: "",
      });

    if (flat.length === 1) {
      L.marker(flat[0], { icon: makePin("hsl(152,60%,36%)") })
        .addTo(map)
        .bindTooltip("Location", { direction: "top", offset: [0, -10] });
      map.setView(flat[0], 15);
      setHasRoute(false);
      setSpeedRange(null);
      return;
    }

    // Compute speed range across all points with a speed.
    const speeds: number[] = [];
    for (const seg of segments) for (const p of seg) if (p.speed != null) speeds.push(p.speed);
    let min = 0;
    let max = 0;
    if (speeds.length > 2) {
      const sorted = [...speeds].sort((a, b) => a - b);
      // Trim 5th/95th percentile to avoid GPS spikes skewing the gradient.
      min = sorted[Math.floor(sorted.length * 0.05)];
      max = sorted[Math.floor(sorted.length * 0.95)];
    }
    const hasSpeed = speeds.length > 0 && max > min;
    setSpeedRange(hasSpeed ? { min, max } : null);

    for (const segment of segments) {
      if (segment.length < 2) continue;
      if (hasSpeed) {
        for (let i = 1; i < segment.length; i++) {
          const a = segment[i - 1];
          const b = segment[i];
          const s = b.speed ?? a.speed ?? (min + max) / 2;
          L.polyline([a.latlng, b.latlng], {
            color: speedColor(s, min, max),
            weight: 5,
            opacity: 0.95,
            lineCap: "round",
          }).addTo(map);
        }
      } else {
        L.polyline(segment.map((p) => p.latlng), {
          color: "hsl(152, 60%, 36%)",
          weight: 4,
          opacity: 0.9,
        }).addTo(map);
      }
    }

    L.marker(flat[0], { icon: makePin("hsl(152,60%,36%)", "S") })
      .addTo(map)
      .bindTooltip("Start", { direction: "top", offset: [0, -12] });

    L.marker(flat[flat.length - 1], { icon: makePin("hsl(0,72%,51%)", "F") })
      .addTo(map)
      .bindTooltip("Finish", { direction: "top", offset: [0, -12] });

    map.fitBounds(L.latLngBounds(flat), { padding: [24, 24] });
    setHasRoute(true);

    const resizeTimer = window.setTimeout(() => {
      if (mapInstance.current === map) map.invalidateSize();
    }, 0);

    return () => {
      window.clearTimeout(resizeTimer);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [track, interactive]);

  // Playback animation
  useEffect(() => {
    const map = mapInstance.current;
    const points = flatPointsRef.current;
    if (!map || points.length < 2) return;

    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }

    // Create or reset marker
    const runnerIcon = L.divIcon({
      html: `<div style="
        width:16px;height:16px;border-radius:50%;
        background:hsl(45, 100%, 55%);
        border:3px solid white;
        box-shadow:0 0 0 2px hsl(45, 100%, 55%), 0 2px 8px rgba(0,0,0,0.5);
      "></div>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      className: "",
    });

    if (!playMarkerRef.current) {
      const startIdx = Math.min(playIndexRef.current, points.length - 1);
      playMarkerRef.current = L.marker(points[startIdx], { icon: runnerIcon, zIndexOffset: 1000 }).addTo(map);
    }

    // ~10 seconds total animation regardless of point count
    const totalMs = 10000;
    const stepMs = totalMs / points.length;
    let lastTs = performance.now();
    let accumulator = 0;

    const tick = (ts: number) => {
      const dt = ts - lastTs;
      lastTs = ts;
      accumulator += dt;
      while (accumulator >= stepMs && playIndexRef.current < points.length - 1) {
        playIndexRef.current += 1;
        accumulator -= stepMs;
      }
      const idx = playIndexRef.current;
      if (playMarkerRef.current) {
        playMarkerRef.current.setLatLng(points[idx]);
      }
      if (idx >= points.length - 1) {
        setIsPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [isPlaying]);

  const handlePlayPause = () => {
    if (playIndexRef.current >= flatPointsRef.current.length - 1) {
      playIndexRef.current = 0;
      if (playMarkerRef.current && flatPointsRef.current[0]) {
        playMarkerRef.current.setLatLng(flatPointsRef.current[0]);
      }
    }
    setIsPlaying((p) => !p);
  };

  const handleReset = () => {
    setIsPlaying(false);
    playIndexRef.current = 0;
    if (playMarkerRef.current && mapInstance.current) {
      mapInstance.current.removeLayer(playMarkerRef.current);
      playMarkerRef.current = null;
    }
  };

  if (track.length < 1) return null;

  const fmtSpeed = (mps: number) => {
    const kmh = mps * 3.6;
    if (kmh < 0.1) return "0";
    const paceSecPerKm = 1000 / mps;
    const m = Math.floor(paceSecPerKm / 60);
    const s = Math.round(paceSecPerKm % 60).toString().padStart(2, "0");
    return `${kmh.toFixed(1)} km/h · ${m}:${s}/km`;
  };

  return (
    <div className={`relative ${className}`}>
      <div
        ref={mapRef}
        className="rounded-lg overflow-hidden border border-border"
        style={{ height: height ?? (interactive ? 420 : 300) }}
      />
      {hasRoute && (
        <>
          <div className="absolute top-2 left-2 z-[400] flex gap-1.5">
            <button
              type="button"
              onClick={handlePlayPause}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-background/95 backdrop-blur border border-border shadow-sm text-xs font-medium hover:bg-accent transition-colors"
              aria-label={isPlaying ? "Pause route playback" : "Play route"}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? "Pause" : "Play route"}
            </button>
            {(isPlaying || playIndexRef.current > 0) && (
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center justify-center w-8 h-8 rounded-md bg-background/95 backdrop-blur border border-border shadow-sm hover:bg-accent transition-colors"
                aria-label="Reset playback"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {speedRange && (
            <div className="absolute bottom-2 right-2 z-[400] px-2.5 py-1.5 rounded-md bg-background/95 backdrop-blur border border-border shadow-sm text-[10px] leading-tight">
              <div className="font-medium mb-1 text-muted-foreground uppercase tracking-wide">Speed</div>
              <div
                className="h-2 w-32 rounded-sm mb-1"
                style={{
                  background:
                    "linear-gradient(to right, hsl(240,85%,50%), hsl(180,85%,50%), hsl(120,85%,50%), hsl(60,85%,50%), hsl(0,85%,50%))",
                }}
              />
              <div className="flex justify-between text-muted-foreground tabular-nums">
                <span>{fmtSpeed(speedRange.min)}</span>
                <span>{fmtSpeed(speedRange.max)}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ActivityMap;
