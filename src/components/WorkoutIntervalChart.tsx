import type { ParsedSegment } from "@/lib/plan-export";

/**
 * intervals.icu–style bar chart for a workout.
 * Each segment is a bar: width = duration, height = intensity, color = zone.
 */

// Parse a duration string into seconds. Falls back to 60s.
function durationToSeconds(d: string): number {
  if (!d) return 60;
  const s = d.toLowerCase().trim();
  // Distance-based: assume ~6:00/km baseline for the bar width
  const km = s.match(/([\d.]+)\s*km\b/);
  if (km) return parseFloat(km[1]) * 360;
  const meters = s.match(/([\d.]+)\s*m\b(?!in)/);
  if (meters) return (parseFloat(meters[1]) / 1000) * 360;
  // "N x M …" → just N × parsed M
  const rep = s.match(/(\d+)\s*x\s*([\d.]+)\s*(min|sec|s|m|km)\b/);
  if (rep) {
    const n = parseInt(rep[1], 10);
    const v = parseFloat(rep[2]);
    const u = rep[3];
    let unitSec = 60;
    if (u === "sec" || u === "s") unitSec = 1;
    else if (u === "min") unitSec = 60;
    else if (u === "km") unitSec = 360;
    else if (u === "m") unitSec = 0.36;
    return n * v * unitSec;
  }
  const hr = s.match(/([\d.]+)\s*h(r|our)?\b/);
  if (hr) return parseFloat(hr[1]) * 3600;
  const min = s.match(/([\d.]+)\s*min\b/);
  if (min) return parseFloat(min[1]) * 60;
  const sec = s.match(/([\d.]+)\s*sec\b/);
  if (sec) return parseFloat(sec[1]);
  return 60;
}

// Parse a pace target like "5:30/km" or "5:30-6:00/km" → seconds per km. null otherwise.
function paceTargetToSecPerKm(target: string): number | null {
  if (!target) return null;
  const m = target.match(/(\d{1,2}):(\d{2})\s*(?:-\s*\d{1,2}:\d{2})?\s*\/?\s*km/i);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// Map a segment to an intensity in [0, 1]. 1 = hardest.
function segmentIntensity(seg: ParsedSegment): number {
  const label = `${seg.segment} ${seg.notes ?? ""}`.toLowerCase();
  const pace = paceTargetToSecPerKm(seg.target);
  if (pace != null) {
    // Pace-driven profile so slower warm-up / walk / cool-down bars sit much
    // lower while harder running intervals still tower above them.
    const clamped = Math.max(240, Math.min(600, pace));
    if (clamped <= 300) return 0.8 + ((300 - clamped) / 60) * 0.15;
    if (clamped <= 360) return 0.55 + ((360 - clamped) / 60) * 0.25;
    if (clamped <= 450) return 0.32 + ((450 - clamped) / 90) * 0.23;
    return 0.12 + ((600 - clamped) / 150) * 0.2;
  }

  // Fallbacks when no pace exists at all.
  if (/rest/.test(label)) return 0.05;
  if (/walk|recovery/.test(label)) return 0.14;
  if (/warm\s*-?\s*up|cool\s*-?\s*down/.test(label)) return 0.18;

  const z = seg.hrZone.match(/Z\s*(\d)/i);
  if (z) {
    const zone = parseInt(z[1], 10);
    return Math.max(0.4, Math.min(1, zone / 5));
  }
  const t = `${seg.target} ${seg.segment} ${seg.notes ?? ""}`.toLowerCase();
  if (/easy|jog/.test(t)) return 0.45;
  if (/steady|aerobic/.test(t)) return 0.6;
  if (/tempo|threshold/.test(t)) return 0.8;
  if (/interval|vo2|hard|sprint|fast/.test(t)) return 0.95;
  return 0.5;
}

// Tailwind color classes by zone (1–5)
function zoneClasses(intensity: number): { bar: string; ring: string } {
  if (intensity < 0.3) return { bar: "from-sky-400/80 to-sky-500", ring: "ring-sky-300/40" };
  if (intensity < 0.5) return { bar: "from-emerald-400/80 to-emerald-500", ring: "ring-emerald-300/40" };
  if (intensity < 0.7) return { bar: "from-amber-400/80 to-amber-500", ring: "ring-amber-300/40" };
  if (intensity < 0.85) return { bar: "from-orange-400/80 to-orange-500", ring: "ring-orange-300/40" };
  return { bar: "from-rose-500/85 to-rose-600", ring: "ring-rose-300/40" };
}

function formatDuration(sec: number): string {
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m ? `${h}h${m}` : `${h}h`;
  }
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return s ? `${m}:${String(s).padStart(2, "0")}` : `${m}m`;
  }
  return `${Math.round(sec)}s`;
}

function isNoPaceSegment(seg: ParsedSegment): boolean {
  const t = `${seg.segment} ${seg.notes ?? ""}`.toLowerCase();
  return /warm\s*-?\s*up|cool\s*-?\s*down|rest|recovery|walk/.test(t);
}

function shortTarget(seg: ParsedSegment): string {
  if (isNoPaceSegment(seg)) return "";
  if (seg.target) {
    // Extract pace if present
    const p = seg.target.match(/(\d{1,2}:\d{2}(?:-\d{1,2}:\d{2})?\s*\/?\s*km)/i);
    if (p) return p[1].replace(/\s+/g, "");
  }
  if (seg.hrZone) return seg.hrZone;
  return seg.target || "";
}

export default function WorkoutIntervalChart({ segments }: { segments: ParsedSegment[] }) {
  if (!segments.length) return null;

  const bars = segments.map((seg) => {
    const sec = durationToSeconds(seg.duration);
    const intensity = segmentIntensity(seg);
    return { seg, sec, intensity, ...zoneClasses(intensity) };
  });

  const totalSec = bars.reduce((a, b) => a + b.sec, 0) || 1;
  const totalLabel = formatDuration(totalSec);

  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workout Profile
        </span>
        <span className="text-xs text-muted-foreground">Total {totalLabel}</span>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-[2px] h-32 w-full">
        {bars.map((b, i) => {
          const widthPct = (b.sec / totalSec) * 100;
          const heightPct = 5 + b.intensity * 95; // 5%–100%
          const target = shortTarget(b.seg);
          return (
            <div
              key={i}
              className="relative flex flex-col items-center justify-end h-full"
              style={{ width: `${widthPct}%`, minWidth: 6 }}
              title={`${b.seg.segment} · ${formatDuration(b.sec)}${target ? " · " + target : ""}`}
            >
              {target && widthPct > 6 && (
                <span className="absolute -top-0.5 text-[9px] font-semibold text-foreground/80 whitespace-nowrap">
                  {target}
                </span>
              )}
              <div
                className={`w-full bg-gradient-to-t ${b.bar} ring-1 ${b.ring} rounded-t-sm transition-all`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          );
        })}
      </div>

      {/* Duration axis */}
      <div className="flex gap-[2px] mt-1">
        {bars.map((b, i) => {
          const widthPct = (b.sec / totalSec) * 100;
          return (
            <div
              key={i}
              className="text-center text-[9px] text-muted-foreground truncate"
              style={{ width: `${widthPct}%`, minWidth: 6 }}
            >
              {widthPct > 6 ? formatDuration(b.sec) : ""}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-sky-500" /> Recovery</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> Easy</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> Steady</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-500" /> Tempo</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500" /> Hard</span>
      </div>
    </div>
  );
}
