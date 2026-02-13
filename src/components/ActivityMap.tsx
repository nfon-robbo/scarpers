import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface GpsPoint {
  lat: number;
  lng: number;
  altitude?: number;
  heart_rate?: number;
  speed?: number;
}

interface Props {
  track: GpsPoint[];
  className?: string;
}

const ActivityMap = ({ track, className = "" }: Props) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || track.length < 2) return;

    // Clean up previous instance
    if (mapInstance.current) {
      mapInstance.current.remove();
      mapInstance.current = null;
    }

    const map = L.map(mapRef.current, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: false,
    });

    mapInstance.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      maxZoom: 19,
    }).addTo(map);

    const latlngs: L.LatLngExpression[] = track.map((p) => [p.lat, p.lng]);

    // Draw route polyline
    const polyline = L.polyline(latlngs, {
      color: "hsl(152, 60%, 36%)",
      weight: 3,
      opacity: 0.9,
    }).addTo(map);

    // Start marker
    const startIcon = L.divIcon({
      html: '<div style="width:12px;height:12px;background:hsl(152,60%,36%);border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      className: "",
    });

    // End marker
    const endIcon = L.divIcon({
      html: '<div style="width:12px;height:12px;background:hsl(0,72%,51%);border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3)"></div>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
      className: "",
    });

    L.marker(latlngs[0], { icon: startIcon }).addTo(map);
    L.marker(latlngs[latlngs.length - 1], { icon: endIcon }).addTo(map);

    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, [track]);

  if (track.length < 2) return null;

  return (
    <div
      ref={mapRef}
      className={`rounded-lg overflow-hidden border border-border ${className}`}
      style={{ height: 300 }}
    />
  );
};

export default ActivityMap;
