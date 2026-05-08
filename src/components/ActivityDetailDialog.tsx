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
        const pts = decodePolyline(poly);
        return pts.map(([lat, lng]) => ({ lat, lng }));
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
    const firstTrackTime = track[0]?.time ? new Date(track[0].time).getTime() : null;
    const elapsedForPoint = (p: any) => p.elapsed_time ?? (p.time && firstTrackTime != null ? (new Date(p.time).getTime() - firstTrackTime) / 1000 : null);
    let lastT = 0;
    for (let i = 0; i < track.length; i++) {
      const p: any = track[i];
      const hr = p.heart_rate;
      if (!hr) { lastT = elapsedForPoint(p) ?? lastT; continue; }
      const pct = hr / userMax;
      const z = pct < 0.6 ? 0 : pct < 0.7 ? 1 : pct < 0.8 ? 2 : pct < 0.9 ? 3 : 4;
      const t = elapsedForPoint(p) ?? lastT + 1;
      zones[z] += Math.max(0, t - lastT);
      lastT = t;
    }
    const zonesTotal = zones.reduce((a, b) => a + b, 0);

    const readMeasurement = (split: any, field: string) => {
      const m = Array.isArray(split?.measurements)
        ? split.measurements.find((x: any) => x?.fieldEnum === field && x?.valid !== false)
        : null;
      const n = Number(m?.value);
      return Number.isFinite(n) ? n : null;
    };

    const splits: { km: number; time: number; pace: string; hr: number | null; ascent: number }[] = [];
    const garminSplits = Array.isArray(data.raw_data?.garmin?.splits) ? data.raw_data.garmin.splits : [];
    const measuredGarminSplits = garminSplits
      .map((s: any) => {
        const meters = readMeasurement(s, "SUM_DISTANCE");
        const movingMs = readMeasurement(s, "SUM_DURATION") ?? readMeasurement(s, "SUM_MOVINGDURATION") ?? readMeasurement(s, "SUM_ELAPSEDDURATION");
        const elapsedMs = readMeasurement(s, "SUM_ELAPSEDDURATION") ?? movingMs;
        const hr = readMeasurement(s, "WEIGHTED_MEAN_HEARTRATE");
        const ascent = readMeasurement(s, "GAIN_ELEVATION");
        return meters != null && elapsedMs != null ? { meters: meters / 100, time: elapsedMs / 1000, movingTime: movingMs != null ? movingMs / 1000 : elapsedMs / 1000, hr, ascent: ascent != null ? ascent / 100 : 0 } : null;
      })
      .filter(Boolean) as { meters: number; time: number; movingTime: number; hr: number | null; ascent: number }[];

    if (!track.some((p: any) => p.elapsed_time != null || p.time) && measuredGarminSplits.length) {
      let carryDistance = 0;
      let carryMovingTime = 0;
      let carryHrWeighted = 0;
      let carryHrMeters = 0;
      let carryAscent = 0;
      for (const s of measuredGarminSplits) {
        carryDistance += s.meters;
        carryMovingTime += s.movingTime;
        if (s.hr) { carryHrWeighted += s.hr * s.meters; carryHrMeters += s.meters; }
        carryAscent += s.ascent;
        while (carryDistance >= 1000) {
          const ratio = 1000 / carryDistance;
          const splitTime = carryMovingTime * ratio;
          const paceMin = Math.floor(splitTime / 60);
          const paceSec = Math.round(splitTime - paceMin * 60);
          splits.push({
            km: splits.length + 1,
            time: splitTime,
            pace: `${paceMin}:${paceSec.toString().padStart(2, "0")}`,
            hr: carryHrMeters ? Math.round(carryHrWeighted / carryHrMeters) : null,
            ascent: Math.round(carryAscent * ratio),
          });
          carryDistance -= 1000;
          carryMovingTime *= 1 - ratio;
          carryHrWeighted *= 1 - ratio;
          carryHrMeters *= 1 - ratio;
          carryAscent *= 1 - ratio;
        }
      }
    } else if (track.length > 10 && dist > 1000) {
      let cumDist = 0;
      let lastSplitDist = 0;
      let lastSplitTime = elapsedForPoint(track[0]) ?? 0;
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
          const currentTime = elapsedForPoint(p) ?? lastSplitTime;
          const splitTime = currentTime - lastSplitTime;
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
          lastSplitTime = currentTime;
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

                    {/* Running Dynamics */}
                    {(() => {
                      const r = data.raw_data || {};
                      const has = r.avg_stance_time != null || r.avg_vertical_oscillation != null ||
                        r.avg_vertical_ratio != null || r.avg_stance_time_balance != null ||
                        r.avg_stride_length != null || r.total_strides != null;
                      if (!has) return null;
                      return (
                        <Card>
                          <CardContent className="p-4">
                            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Running Dynamics</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                              <Stat label="Ground Contact" value={r.avg_stance_time != null ? `${Math.round(r.avg_stance_time)} ms` : null} />
                              <Stat label="GCT Balance" value={r.avg_stance_time_balance != null ? `${Number(r.avg_stance_time_balance).toFixed(1)}%` : null} />
                              <Stat label="Vert Oscillation" value={r.avg_vertical_oscillation != null ? `${Number(r.avg_vertical_oscillation).toFixed(1)} cm` : null} />
                              <Stat label="Vert Ratio" value={r.avg_vertical_ratio != null ? `${Number(r.avg_vertical_ratio).toFixed(1)}%` : null} />
                              <Stat label="Avg Stride" value={r.avg_stride_length != null ? `${Number(r.avg_stride_length).toFixed(2)} m` : null} />
                              <Stat label="Total Strides" value={r.total_strides != null ? Number(r.total_strides).toLocaleString() : null} />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })()}

                    {/* Power Detail */}
                    {(() => {
                      const r = data.raw_data || {};
                      const has = r.normalized_power != null || r.intensity_factor != null ||
                        r.training_stress_score != null || r.total_work != null || r.left_right_balance != null;
                      if (!has) return null;
                      return (
                        <Card>
                          <CardContent className="p-4">
                            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Power Detail</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                              <Stat label="Normalized Power" value={r.normalized_power != null ? `${Math.round(r.normalized_power)} W` : null} icon={Zap} />
                              <Stat label="Intensity Factor" value={r.intensity_factor != null ? Number(r.intensity_factor).toFixed(2) : null} />
                              <Stat label="TSS" value={r.training_stress_score != null ? Math.round(r.training_stress_score).toString() : null} />
                              <Stat label="Total Work" value={r.total_work != null ? `${Math.round(Number(r.total_work) / 1000)} kJ` : null} />
                              <Stat label="L/R Balance" value={r.left_right_balance != null ? `${Number(r.left_right_balance).toFixed(0)}%` : null} />
                              <Stat label="FTP" value={r.functional_threshold_power != null ? `${Math.round(r.functional_threshold_power)} W` : null} />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })()}

                    {/* Activity Detail */}
                    {(() => {
                      const r = data.raw_data || {};
                      const has = r.total_timer_time != null || r.total_elapsed_time != null ||
                        r.num_laps != null || r.avg_running_cadence != null || r.max_running_cadence != null;
                      if (!has) return null;
                      return (
                        <Card>
                          <CardContent className="p-4">
                            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wider">Activity Detail</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
                              <Stat label="Moving Time" value={r.total_timer_time != null ? fmtDuration(r.total_timer_time) : null} />
                              <Stat label="Elapsed Time" value={r.total_elapsed_time != null ? fmtDuration(r.total_elapsed_time) : null} />
                              <Stat label="Laps" value={r.num_laps != null ? String(r.num_laps) : null} />
                              <Stat label="Max Cadence" value={r.max_running_cadence != null ? `${Math.round(r.max_running_cadence * 2)} spm` : (r.max_cadence != null ? `${Math.round(r.max_cadence)} rpm` : null)} />
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })()}

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
