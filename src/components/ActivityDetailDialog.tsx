import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useUnits } from "@/hooks/useUnits";
import {
  Loader2, Heart, Timer, TrendingUp, Mountain, Gauge, Zap, MapPin,
  Activity as ActivityIcon, Flame, Footprints, Ruler, Thermometer,
} from "lucide-react";
import ActivityMap from "@/components/ActivityMap";
import ActivityCharts from "@/components/ActivityCharts";
import { decodePolyline } from "@/lib/polyline";

interface Props {
  activityId: string | null;
  onClose: () => void;
}

interface ActivityRow {
  id: string;
  start_time: string | null;
  activity_type: string | null;
  source_file: string | null;
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
  total_steps: number | null;
  latitude: number | null;
  longitude: number | null;
  raw_data: any;
}

const fmtDuration = (seconds: number | null | undefined, detailed = true) => {
  if (!seconds) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (detailed) return h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const teDescription = (te: number) => {
  if (te < 2.0) return "Recovery — minor impact.";
  if (te < 3.0) return "Maintaining aerobic fitness.";
  if (te < 4.0) return "Improving aerobic fitness.";
  if (te < 5.0) return "Highly improving — hard workout.";
  return "Overreaching — extreme effort.";
};

const ActivityDetailDialog = ({ activityId, onClose }: Props) => {
  const { fmt, label, units } = useUnits();
  const [data, setData] = useState<ActivityRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!activityId) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    supabase.from("activities").select("*").eq("id", activityId).maybeSingle()
      .then(({ data: row }) => {
        if (!cancelled) {
          setData(row as ActivityRow);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [activityId]);

  const track = useMemo(() => {
    const t = data?.raw_data?.gps_track;
    if (Array.isArray(t) && t.length > 0) return t;
    // Fallback: decode Strava map_polyline if present
    const poly = data?.raw_data?.map_polyline;
    if (typeof poly === "string" && poly.length > 0) {
      try {
        // Lazy require to avoid circulars
        const { decodePolyline } = require("@/lib/polyline");
        const pts = decodePolyline(poly);
        return pts.map(([lat, lng]: [number, number]) => ({ lat, lng }));
      } catch {
        return [];
      }
    }
    // Fallback: start_latlng / end_latlng if present
    const start = data?.raw_data?.start_latlng;
    const end = data?.raw_data?.end_latlng;
    if (Array.isArray(start) && start.length === 2) {
      const arr: any[] = [{ lat: start[0], lng: start[1] }];
      if (Array.isArray(end) && end.length === 2) arr.push({ lat: end[0], lng: end[1] });
      return arr;
    }
    return [];
  }, [data]);

  const hasMap = track.length >= 1 ||
    (data?.latitude != null && data?.longitude != null && Math.abs(data.latitude) > 0.01);

  // ---- Derived stats (Garmin-like) ----
  const derived = useMemo(() => {
    if (!data) return null;
    const dist = data.distance_meters ?? 0;
    const dur = data.duration_seconds ?? 0;
    // Pace min/km
    const paceSecPerKm = dist > 0 && dur > 0 ? (dur / (dist / 1000)) : null;
    const maxPaceSecPerKm = data.max_speed && data.max_speed > 0
      ? 3600 / data.max_speed : null;

    // HR zones from track (using max HR ~ user's max if present, else 190)
    const userMax = data.max_heart_rate ?? 190;
    const zones = [0, 0, 0, 0, 0];
    let lastT = 0;
    for (let i = 0; i < track.length; i++) {
      const p: any = track[i];
      const hr = p.heart_rate;
      if (!hr) { lastT = p.elapsed_time ?? lastT; continue; }
      const pct = hr / userMax;
      const z = pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4;
      const t = p.elapsed_time ?? lastT + 1;
      zones[z] += Math.max(0, t - lastT);
      lastT = t;
    }
    const zonesTotal = zones.reduce((a, b) => a + b, 0);

    // Splits per km from gps_track
    const splits: { km: number; time: number; pace: string; hr: number | null; ascent: number }[] = [];
    if (track.length > 10 && dist > 1000) {
      let cumDist = 0;
      let lastSplitDist = 0;
      let lastSplitTime = track[0]?.elapsed_time ?? 0;
      let splitHrSum = 0;
      let splitHrN = 0;
      let splitAscent = 0;
      let prevAlt: number | null = null;
      let prevLat: number | null = null;
      let prevLon: number | null = null;
      const haversine = (a: any, b: any) => {
        const R = 6371000;
        const toRad = (x: number) => x * Math.PI / 180;
        const lat1 = a.lat, lon1 = a.lng ?? a.lon;
        const lat2 = b.lat, lon2 = b.lng ?? b.lon;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
      };
      for (const p of track as any[]) {
        if (prevLat != null && p.lat != null) {
          cumDist += haversine({ lat: prevLat, lon: prevLon }, p);
        }
        prevLat = p.lat; prevLon = p.lng ?? p.lon;
        if (p.altitude != null) {
          if (prevAlt != null && p.altitude > prevAlt) splitAscent += p.altitude - prevAlt;
          prevAlt = p.altitude;
        }
        if (p.heart_rate) { splitHrSum += p.heart_rate; splitHrN++; }
        while (cumDist - lastSplitDist >= 1000) {
          const splitTime = (p.elapsed_time ?? 0) - lastSplitTime;
          const km = splits.length + 1;
          const paceMin = Math.floor(splitTime / 60);
          const paceSec = Math.round(splitTime - paceMin * 60);
          splits.push({
            km,
            time: splitTime,
            pace: `${paceMin}:${paceSec.toString().padStart(2, "0")}`,
            hr: splitHrN ? Math.round(splitHrSum / splitHrN) : null,
            ascent: Math.round(splitAscent),
          });
          lastSplitDist += 1000;
          lastSplitTime = p.elapsed_time ?? lastSplitTime;
          splitHrSum = 0; splitHrN = 0; splitAscent = 0;
        }
      }
    }

    return { paceSecPerKm, maxPaceSecPerKm, zones, zonesTotal, splits, userMax };
  }, [data, track]);

  const fmtPace = (secPerKm: number | null) => {
    if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return null;
    const useMi = units.distance === "mi" || units.speed === "min/mi" || units.speed === "mph";
    const sec = useMi ? secPerKm * 1.609344 : secPerKm;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec - m * 60);
    return `${m}:${s.toString().padStart(2, "0")} /${useMi ? "mi" : "km"}`;
  };

  const open = !!activityId;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-5xl max-h-[92vh] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <ActivityIcon className="w-5 h-5 text-primary" />
            <span>
              {data?.start_time
                ? new Date(data.start_time).toLocaleDateString("en-GB", {
                    weekday: "short", day: "2-digit", month: "short", year: "numeric",
                  })
                : "Activity"}
            </span>
            {data?.start_time && (
              <span className="text-sm font-normal text-muted-foreground">
                · {new Date(data.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            {data?.activity_type && (
              <Badge variant="secondary" className="capitalize">{data.activity_type}</Badge>
            )}
            {data?.raw_data?.name && (
              <span className="text-sm font-normal text-muted-foreground truncate">— {data.raw_data.name}</span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">Activity details</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(92vh-72px)]">
          <div className="p-5 space-y-5">
            {loading || !data ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Hero metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <HeroStat icon={TrendingUp} label="Distance" value={fmt.distance(data.distance_meters)} />
                  <HeroStat icon={Timer} label="Duration" value={fmtDuration(data.duration_seconds)} />
                  <HeroStat
                    icon={Gauge}
                    label={units.speed.includes("min") ? "Avg Pace" : "Avg Speed"}
                    value={units.speed.includes("min")
                      ? fmtPace(derived?.paceSecPerKm ?? null)
                      : fmt.speed(data.avg_speed)}
                  />
                  <HeroStat icon={Heart} label="Avg HR" value={data.avg_heart_rate ? `${Math.round(data.avg_heart_rate)} bpm` : null} />
                </div>

                <Tabs defaultValue="overview">
                  <TabsList className="w-full grid grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="splits" disabled={!derived?.splits.length}>
                      Splits {derived?.splits.length ? `(${derived.splits.length})` : ""}
                    </TabsTrigger>
                    <TabsTrigger value="zones" disabled={!derived?.zonesTotal}>HR Zones</TabsTrigger>
                    <TabsTrigger value="raw">All Data</TabsTrigger>
                  </TabsList>

                  {/* OVERVIEW */}
                  <TabsContent value="overview" className="space-y-5 mt-4">
                    {hasMap && (
                      <Card>
                        <CardContent className="p-3">
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> {track.length >= 2 ? "Route" : "Location"}
                          </p>
                          {track.length >= 2 ? (
                            <ActivityMap track={track} interactive />
                          ) : (
                            <ActivityMap track={[{ lat: data.latitude!, lng: data.longitude! }]} interactive height={300} />
                          )}
                        </CardContent>
                      </Card>
                    )}

                    {/* Detailed stats grid */}
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Performance</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                          <Stat label="Distance" value={fmt.distance(data.distance_meters)} />
                          <Stat label="Moving Time" value={fmtDuration(data.duration_seconds)} />
                          <Stat label="Avg Pace" value={fmtPace(derived?.paceSecPerKm ?? null)} />
                          <Stat label="Best Pace" value={fmtPace(derived?.maxPaceSecPerKm ?? null)} />
                          <Stat label="Avg Speed" value={fmt.speed(data.avg_speed)} />
                          <Stat label="Max Speed" value={fmt.speed(data.max_speed)} />
                          <Stat label="Calories" value={data.calories ? `${Math.round(data.calories)} kcal` : null} icon={Flame} />
                          <Stat label="Avg Temp" value={fmt.temperature(data.avg_temperature)} icon={Thermometer} />
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Heart Rate</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                          <Stat label="Avg HR" value={data.avg_heart_rate ? `${Math.round(data.avg_heart_rate)} bpm` : null} icon={Heart} />
                          <Stat label="Max HR" value={data.max_heart_rate ? `${Math.round(data.max_heart_rate)} bpm` : null} icon={Heart} />
                          <Stat label="Min HR" value={data.raw_data?.min_heart_rate ? `${Math.round(data.raw_data.min_heart_rate)} bpm` : null} />
                          <Stat label="HR Reserve" value={data.avg_heart_rate && data.max_heart_rate ? `${Math.round((data.avg_heart_rate / data.max_heart_rate) * 100)}%` : null} />
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Cadence & Power</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                          <Stat label="Avg Cadence" value={data.avg_cadence ? `${Math.round(data.avg_cadence)} rpm` : null} icon={Footprints} />
                          <Stat label="Avg Power" value={data.avg_power ? `${Math.round(data.avg_power)} W` : null} icon={Zap} />
                          <Stat label="Max Power" value={data.max_power ? `${Math.round(data.max_power)} W` : null} icon={Zap} />
                          <Stat label="Total Steps" value={(() => {
                            if (data.total_steps) return `${data.total_steps.toLocaleString()}`;
                            const stepLen = data.raw_data?.avg_step_length;
                            if (stepLen && data.distance_meters) return `${Math.round(data.distance_meters / (stepLen / 1000)).toLocaleString()}`;
                            if (data.avg_cadence && data.duration_seconds) return `${Math.round(data.avg_cadence * (data.duration_seconds / 60)).toLocaleString()}`;
                            return null;
                          })()} icon={Footprints} />
                          <Stat label="Avg Step Length" value={data.raw_data?.avg_step_length ? `${(data.raw_data.avg_step_length).toFixed(2)} m` : null} icon={Ruler} />
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Elevation</p>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                          <Stat label="Total Ascent" value={fmt.elevation(data.total_ascent)} icon={Mountain} />
                          <Stat label="Total Descent" value={fmt.elevation(data.total_descent)} icon={Mountain} />
                          <Stat label="Net Elevation" value={data.total_ascent != null && data.total_descent != null
                            ? fmt.elevation(data.total_ascent - data.total_descent) : null} />
                        </div>
                      </CardContent>
                    </Card>

                    {(data.training_effect || data.training_load || data.raw_data?.total_anaerobic_training_effect) && (
                      <Card>
                        <CardContent className="p-4">
                          <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Training</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-3">
                            {data.training_effect != null && (
                              <div>
                                <p className="text-xs text-muted-foreground">Aerobic TE</p>
                                <p className="text-base font-semibold">{Number(data.training_effect).toFixed(1)}</p>
                                <p className="text-[11px] text-muted-foreground mt-0.5">{teDescription(Number(data.training_effect))}</p>
                              </div>
                            )}
                            {data.raw_data?.total_anaerobic_training_effect != null && (
                              <Stat label="Anaerobic TE" value={Number(data.raw_data.total_anaerobic_training_effect).toFixed(1)} />
                            )}
                            {data.training_load != null && (
                              <Stat label="Training Load" value={`${Math.round(Number(data.training_load))}`} />
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Charts */}
                    {track.length >= 10 && (
                      <ActivityCharts
                        track={track}
                        avgHR={data.avg_heart_rate}
                        maxHR={data.max_heart_rate}
                      />
                    )}
                  </TabsContent>

                  {/* SPLITS */}
                  <TabsContent value="splits" className="mt-4">
                    <Card>
                      <CardContent className="p-0">
                        <div className="grid grid-cols-4 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border/50">
                          <span>Split</span>
                          <span className="text-right">Time</span>
                          <span className="text-right">Pace</span>
                          <span className="text-right">Avg HR</span>
                        </div>
                        {derived?.splits.map((s) => (
                          <div key={s.km} className="grid grid-cols-4 px-4 py-2 text-sm border-b border-border/30 last:border-0">
                            <span className="font-medium">{s.km} km</span>
                            <span className="text-right tabular-nums">{fmtDuration(s.time, true)}</span>
                            <span className="text-right tabular-nums">{s.pace} /km</span>
                            <span className="text-right tabular-nums">{s.hr ? `${s.hr} bpm` : "—"}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* HR ZONES */}
                  <TabsContent value="zones" className="mt-4">
                    <Card>
                      <CardContent className="p-4 space-y-2.5">
                        {[
                          { label: "Z1 Recovery", color: "bg-sky-500", range: `<${Math.round(derived!.userMax * 0.6)}` },
                          { label: "Z2 Endurance", color: "bg-emerald-500", range: `${Math.round(derived!.userMax * 0.6)}–${Math.round(derived!.userMax * 0.7)}` },
                          { label: "Z3 Tempo", color: "bg-amber-500", range: `${Math.round(derived!.userMax * 0.7)}–${Math.round(derived!.userMax * 0.8)}` },
                          { label: "Z4 Threshold", color: "bg-orange-500", range: `${Math.round(derived!.userMax * 0.8)}–${Math.round(derived!.userMax * 0.9)}` },
                          { label: "Z5 VO2 Max", color: "bg-rose-500", range: `>${Math.round(derived!.userMax * 0.9)}` },
                        ].map((z, i) => {
                          const sec = derived!.zones[i];
                          const pct = derived!.zonesTotal ? (sec / derived!.zonesTotal) * 100 : 0;
                          return (
                            <div key={i}>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="font-medium">{z.label} <span className="text-muted-foreground">({z.range} bpm)</span></span>
                                <span className="tabular-nums text-muted-foreground">{fmtDuration(sec, true)} · {pct.toFixed(0)}%</span>
                              </div>
                              <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div className={`h-full ${z.color}`} style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  </TabsContent>

                  {/* RAW */}
                  <TabsContent value="raw" className="mt-4">
                    <Card>
                      <CardContent className="p-4">
                        <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">All Captured Fields</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                          {Object.entries(data)
                            .filter(([k, v]) =>
                              k !== "raw_data" && k !== "user_id" && k !== "id" && k !== "upload_id" &&
                              v !== null && v !== undefined && v !== "")
                            .map(([k, v]) => (
                              <RawField key={k} k={k} v={v} />
                            ))}
                          {data.raw_data && typeof data.raw_data === "object" &&
                            Object.entries(data.raw_data)
                              .filter(([k, v]) =>
                                k !== "gps_track" && k !== "map_polyline" &&
                                v !== null && v !== undefined && v !== "")
                              .map(([k, v]) => (
                                <RawField key={`raw_${k}`} k={k} v={v} />
                              ))}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>

                <p className="text-[11px] text-muted-foreground text-center pt-2">
                  Source: {data.source_file || "—"}
                </p>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};

const HeroStat = ({ icon: Icon, label, value }: { icon: any; label: string; value: string | null }) => (
  <Card>
    <CardContent className="p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <p className="text-xl font-bold tabular-nums">{value || "—"}</p>
    </CardContent>
  </Card>
);

const Stat = ({ label, value, icon: Icon }: { label: string; value: string | null | undefined; icon?: any }) => {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </p>
      <p className="text-sm font-semibold tabular-nums">{value}</p>
    </div>
  );
};

const RawField = ({ k, v }: { k: string; v: any }) => {
  let display: string;
  if (typeof v === "number") display = Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
  else if (typeof v === "boolean") display = v ? "Yes" : "No";
  else if (Array.isArray(v)) display = `Array(${v.length})`;
  else if (typeof v === "object") display = JSON.stringify(v).slice(0, 60);
  else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    display = new Date(v).toLocaleString("en-GB");
  } else display = String(v);
  const niceKey = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/30 pb-1.5">
      <span className="text-xs text-muted-foreground truncate">{niceKey}</span>
      <span className="text-xs font-medium tabular-nums truncate">{display}</span>
    </div>
  );
};

export default ActivityDetailDialog;
