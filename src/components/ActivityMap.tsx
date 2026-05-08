import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { segmentGpsTrack } from "@/lib/gps-track";

interface GpsPoint {
  lat: number;
  lng?: number;
  lon?: number;
  altitude?: number;
  heart_rate?: number;
  speed?: number;
}

interface Props {
  track: GpsPoint[];
  className?: string;
  /** Enable scroll-wheel zoom and full pan/zoom UX (use inside a dialog/detail view). */
  interactive?: boolean;
  /** Map height in px. Defaults to 300, or 420 when interactive. */
  height?: number;
}

const ActivityMap = ({ track, className = "", interactive = false, height }: Props) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || track.length < 1) return;

    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

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
      .map((segment) => segment
        .filter((p) => p.lat != null && (p.lng != null || p.lon != null) && isFinite(p.lat) && isFinite((p.lng ?? p.lon)!))
        .map((p) => [p.lat, (p.lng ?? p.lon)!] as [number, number]))
      .filter((segment) => segment.length > 0);
    const latlngs: L.LatLngExpression[] = segments.flat();

    if (latlngs.length === 0) {
      map.remove();
      mapInstance.current = null;
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

    if (latlngs.length === 1) {
      L.marker(latlngs[0], { icon: makePin("hsl(152,60%,36%)") })
        .addTo(map)
        .bindTooltip("Location", { direction: "top", offset: [0, -10] });
      map.setView(latlngs[0] as L.LatLngExpression, 15);
    } else {
      for (const segment of segments) {
        L.polyline(segment, {
          color: "hsl(152, 60%, 36%)",
          weight: 4,
          opacity: 0.9,
        }).addTo(map);
      }

      L.marker(latlngs[0], { icon: makePin("hsl(152,60%,36%)", "S") })
        .addTo(map)
        .bindTooltip("Start", { direction: "top", offset: [0, -12] });

      L.marker(latlngs[latlngs.length - 1], { icon: makePin("hsl(0,72%,51%)", "F") })
        .addTo(map)
        .bindTooltip("Finish", { direction: "top", offset: [0, -12] });

      map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
    }

    // Ensure map computes correct size after mount (important inside dialogs)
    const resizeTimer = window.setTimeout(() => {
      if (mapInstance.current === map) map.invalidateSize();
    }, 0);

    return () => {
      window.clearTimeout(resizeTimer);
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [track, interactive]);

  if (track.length < 1) return null;

  return (
    <div
      ref={mapRef}
      className={`rounded-lg overflow-hidden border border-border ${className}`}
      style={{ height: height ?? (interactive ? 420 : 300) }}
    />
  );
};

export default ActivityMap;
