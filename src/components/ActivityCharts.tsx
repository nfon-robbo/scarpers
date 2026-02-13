import { useMemo } from "react";
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Heart, TrendingUp, Mountain, Gauge, Timer, Zap } from "lucide-react";
import { useUnits } from "@/hooks/useUnits";

interface GpsPoint {
  lat: number;
  lng: number;
  time?: string;
  altitude?: number;
  heart_rate?: number;
  speed?: number;
}

interface Props {
  track: GpsPoint[];
  avgHR?: number | null;
  maxHR?: number | null;
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 11,
};

const ActivityCharts = ({ track, avgHR, maxHR }: Props) => {
  const { fmt, label, units } = useUnits();
  const KM_TO_MI = 0.621371;
  const M_TO_FT = 3.28084;
  const analysis = useMemo(() => {
    if (!track || track.length < 10) return null;

    // Downsample for performance (target ~300 points)
    const step = Math.max(1, Math.floor(track.length / 300));
    const startTime = track[0]?.time ? new Date(track[0].time).getTime() : 0;

    const timeSeriesData = track
      .filter((_, i) => i % step === 0)
      .map((p, idx) => {
        const elapsedSec = p.time ? (new Date(p.time).getTime() - startTime) / 1000 : idx * step;
        const elapsedMin = Math.round(elapsedSec / 60 * 10) / 10;
        const rawSpeedKmh = p.speed ? p.speed * 3.6 : 0;
        const displaySpeed = units.speed === "mph" ? rawSpeedKmh * KM_TO_MI :
          (units.speed === "min/km" || units.speed === "min/mi") ? (rawSpeedKmh > 1.5 ? 60 / (units.speed === "min/mi" ? rawSpeedKmh * KM_TO_MI : rawSpeedKmh) : null) :
          rawSpeedKmh;
        const displayAlt = p.altitude != null ? (units.elevation === "ft" ? p.altitude * M_TO_FT : p.altitude) : null;
        return {
          min: elapsedMin,
          label: formatMinSec(elapsedSec),
          hr: p.heart_rate ?? null,
          speed: displaySpeed ? Math.round(displaySpeed * 10) / 10 : null,
          altitude: displayAlt != null ? Math.round(displayAlt * 10) / 10 : null,
        };
      });

    // HR Zone distribution (5-zone model)
    const hrPoints = track.filter((p) => p.heart_rate).map((p) => p.heart_rate!);
    const estimatedMaxHR = maxHR || (hrPoints.length ? Math.max(...hrPoints) * 1.05 : 190);
    const zones = [0, 0, 0, 0, 0]; // Z1-Z5
    const zoneThresholds = [0.5, 0.6, 0.7, 0.8, 0.9]; // % of max HR
    for (const hr of hrPoints) {
      const pct = hr / estimatedMaxHR;
      if (pct >= 0.9) zones[4]++;
      else if (pct >= 0.8) zones[3]++;
      else if (pct >= 0.7) zones[2]++;
      else if (pct >= 0.6) zones[1]++;
      else zones[0]++;
    }
    const total = hrPoints.length || 1;
    const zoneData = [
      { zone: "Z1 Recovery", pct: Math.round(zones[0] / total * 100), count: zones[0], color: "hsl(var(--chart-2))" },
      { zone: "Z2 Easy", pct: Math.round(zones[1] / total * 100), count: zones[1], color: "hsl(var(--primary))" },
      { zone: "Z3 Tempo", pct: Math.round(zones[2] / total * 100), count: zones[2], color: "hsl(var(--chart-3))" },
      { zone: "Z4 Threshold", pct: Math.round(zones[3] / total * 100), count: zones[3], color: "hsl(var(--chart-4))" },
      { zone: "Z5 Max", pct: Math.round(zones[4] / total * 100), count: zones[4], color: "hsl(var(--chart-5))" },
    ];

    // Per-km splits
    const splits: { km: number; time: number; avgHR: number; avgSpeed: number }[] = [];
    let kmStart = 0;
    let dist = 0;
    let splitHRs: number[] = [];
    let splitSpeeds: number[] = [];

    for (let i = 1; i < track.length; i++) {
      const prev = track[i - 1];
      const curr = track[i];
      const d = haversine(prev.lat, prev.lng, curr.lat, curr.lng);
      dist += d;
      if (curr.heart_rate) splitHRs.push(curr.heart_rate);
      if (curr.speed) splitSpeeds.push(curr.speed);

      if (dist >= 1000) {
        const elapsed = curr.time && track[kmStart].time
          ? (new Date(curr.time).getTime() - new Date(track[kmStart].time).getTime()) / 1000
          : 0;
        const rawAvgSpd = splitSpeeds.length ? splitSpeeds.reduce((a, b) => a + b, 0) / splitSpeeds.length * 3.6 : 0;
        const displayAvgSpd = units.speed === "mph" ? rawAvgSpd * KM_TO_MI : rawAvgSpd;
        splits.push({
          km: splits.length + 1,
          time: Math.round(elapsed),
          avgHR: splitHRs.length ? Math.round(splitHRs.reduce((a, b) => a + b, 0) / splitHRs.length) : 0,
          avgSpeed: Math.round(displayAvgSpd * 10) / 10,
        });
        dist -= 1000;
        kmStart = i;
        splitHRs = [];
        splitSpeeds = [];
      }
    }

    // Elevation stats
    const altitudes = track.filter((p) => p.altitude != null).map((p) => p.altitude!);
    const elevGainRaw = altitudes.reduce((sum, alt, i) => i > 0 && alt > altitudes[i - 1] ? sum + (alt - altitudes[i - 1]) : sum, 0);
    const elevLossRaw = altitudes.reduce((sum, alt, i) => i > 0 && alt < altitudes[i - 1] ? sum + (altitudes[i - 1] - alt) : sum, 0);
    const elevMult = units.elevation === "ft" ? M_TO_FT : 1;

    // Speed stats
    const speeds = track.filter((p) => p.speed && p.speed > 0.5).map((p) => p.speed!);
    const avgSpeedRaw = speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length * 3.6 : 0;
    const maxSpeedRaw = speeds.length ? Math.max(...speeds) * 3.6 : 0;
    const speedMult = units.speed === "mph" ? KM_TO_MI : 1;

    return {
      timeSeriesData,
      zoneData,
      splits,
      elevGain: Math.round(elevGainRaw * elevMult),
      elevLoss: Math.round(elevLossRaw * elevMult),
      minAlt: altitudes.length ? Math.round(Math.min(...altitudes) * elevMult) : null,
      maxAlt: altitudes.length ? Math.round(Math.max(...altitudes) * elevMult) : null,
      avgSpeed: Math.round(avgSpeedRaw * speedMult * 10) / 10,
      maxSpeed: speeds.length ? Math.round(maxSpeedRaw * speedMult * 10) / 10 : null,
    };
  }, [track, maxHR, units]);

  if (!analysis) {
    return (
      <p className="text-sm text-muted-foreground py-4">Not enough GPS data points for charts.</p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard icon={Mountain} label="Elevation Gain" value={`${analysis.elevGain} ${label.elevation}`} />
        <StatCard icon={Mountain} label="Elevation Loss" value={`${analysis.elevLoss} ${label.elevation}`} />
        <StatCard icon={Gauge} label="Avg Speed" value={`${analysis.avgSpeed} ${label.speed}`} />
        {analysis.maxSpeed && <StatCard icon={Zap} label="Max Speed" value={`${analysis.maxSpeed} ${label.speed}`} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Heart Rate Over Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-destructive" /> Heart Rate
            </CardTitle>
            <CardDescription className="text-xs">BPM over time</CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={analysis.timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" className="fill-muted-foreground" />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <Tooltip contentStyle={tooltipStyle} />
                {avgHR && <ReferenceLine y={avgHR} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" label={{ value: `Avg ${Math.round(avgHR)}`, fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />}
                <Area type="monotone" dataKey="hr" stroke="hsl(var(--destructive))" fill="hsl(var(--destructive))" fillOpacity={0.15} strokeWidth={1.5} name="HR (bpm)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Speed / Pace Over Time */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-primary" /> Speed
            </CardTitle>
            <CardDescription className="text-xs">{label.speed} over time</CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={analysis.timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" className="fill-muted-foreground" />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="speed" stroke="hsl(var(--primary))" strokeWidth={1.5} name={`Speed (${label.speed})`} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Altitude Profile */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Mountain className="w-4 h-4 text-chart-3" /> Elevation Profile
            </CardTitle>
            <CardDescription className="text-xs">
              {analysis.minAlt}{label.elevation} – {analysis.maxAlt}{label.elevation} · ↑{analysis.elevGain}{label.elevation} ↓{analysis.elevLoss}{label.elevation}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={analysis.timeSeriesData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" className="fill-muted-foreground" />
                <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="altitude" stroke="hsl(var(--chart-3))" fill="hsl(var(--chart-3))" fillOpacity={0.2} strokeWidth={1.5} name={`Altitude (${label.elevation})`} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* HR Zones */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-chart-4" /> Heart Rate Zones
            </CardTitle>
            <CardDescription className="text-xs">Time in each training zone</CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="space-y-2">
              {analysis.zoneData.map((z) => (
                <div key={z.zone} className="flex items-center gap-2">
                  <span className="text-xs w-24 text-muted-foreground truncate">{z.zone}</span>
                  <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(z.pct, 1)}%`, backgroundColor: z.color }}
                    />
                  </div>
                  <span className="text-xs font-mono w-10 text-right">{z.pct}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Km Splits */}
      {analysis.splits.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Timer className="w-4 h-4 text-accent" /> {units.distance === "mi" ? "Mile" : "Kilometer"} Splits
            </CardTitle>
            <CardDescription className="text-xs">Pace and HR per {units.distance === "mi" ? "mile" : "kilometer"}</CardDescription>
          </CardHeader>
          <CardContent className="pb-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={analysis.splits}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="km" tick={{ fontSize: 10 }} className="fill-muted-foreground" label={{ value: units.distance === "mi" ? "mi" : "km", position: "insideBottomRight", offset: -5, fontSize: 10 }} />
                <YAxis yAxisId="time" tick={{ fontSize: 10 }} className="fill-muted-foreground" label={{ value: "sec", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <YAxis yAxisId="hr" orientation="right" tick={{ fontSize: 10 }} className="fill-muted-foreground" label={{ value: "bpm", angle: 90, position: "insideRight", fontSize: 10 }} />
                <Tooltip contentStyle={tooltipStyle} formatter={(value: number, name: string) => {
                  if (name === "Split Time") return [formatMinSec(value), name];
                  return [value, name];
                }} />
                <Bar yAxisId="time" dataKey="time" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} name="Split Time" />
                <Line yAxisId="hr" type="monotone" dataKey="avgHR" stroke="hsl(var(--destructive))" strokeWidth={2} name="Avg HR" dot={{ r: 3 }} />
              </BarChart>
            </ResponsiveContainer>

            {/* Splits table */}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs">
                 <thead>
                   <tr className="border-b border-border">
                     <th className="text-left py-1.5 px-2 text-muted-foreground font-medium">{units.distance === "mi" ? "Mi" : "Km"}</th>
                     <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Time</th>
                     <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Pace</th>
                     <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Avg HR</th>
                     <th className="text-right py-1.5 px-2 text-muted-foreground font-medium">Speed</th>
                   </tr>
                 </thead>
                <tbody>
                  {analysis.splits.map((s) => (
                    <tr key={s.km} className="border-b border-border/50">
                      <td className="py-1.5 px-2 font-medium">{s.km}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{formatMinSec(s.time)}</td>
                      <td className="py-1.5 px-2 text-right font-mono">{formatMinSec(s.time)}/{units.distance === "mi" ? "mi" : "km"}</td>
                      <td className="py-1.5 px-2 text-right">{s.avgHR || "—"} bpm</td>
                      <td className="py-1.5 px-2 text-right">{s.avgSpeed} {label.speed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const StatCard = ({ icon: Icon, label, value }: { icon: any; label: string; value: string }) => (
  <div className="rounded-lg border border-border p-3">
    <div className="flex items-center gap-1.5 mb-1">
      <Icon className="w-3 h-3 text-muted-foreground" />
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
    <p className="text-sm font-bold">{value}</p>
  </div>
);

function formatMinSec(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = Math.round(totalSec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default ActivityCharts;
