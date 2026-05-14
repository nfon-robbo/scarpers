import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Target } from "lucide-react";
import { format } from "date-fns";
import type { ParsedWorkout } from "@/lib/plan-export";

interface Props {
  workouts: ParsedWorkout[];
  linkedActivities: Record<string, any>;
  raceDistance?: string;
  goalTime?: string;
}

type SessionType = "easy" | "tempo" | "race";

function classify(title: string): SessionType | null {
  const t = title.toLowerCase();
  // Exclude only pure rest days or walk-only sessions (not walk/run)
  if (/\brest\b/.test(t)) return null;
  if (/\bwalk\b/.test(t) && !/run|jog/.test(t)) return null;
  if (/race[\s-]?pace|\bintervals?\b|repeats?|vo2|track|400m|800m|1k repeats/i.test(title)) return "race";
  if (/tempo|threshold|lactate|\blt\b|cruise/i.test(title)) return "tempo";
  if (/easy|recovery|long\s+run|long\s+slow|steady|aerobic|base|walk\/?run|run\/?walk/i.test(title)) return "easy";
  return "easy";
}

function distanceKm(raceDistance?: string): number | null {
  switch ((raceDistance || "").toLowerCase()) {
    case "5k": return 5;
    case "10k": return 10;
    case "half-marathon": return 21.0975;
    case "marathon": return 42.195;
    default: return null;
  }
}

function distanceLabel(raceDistance?: string): string {
  switch ((raceDistance || "").toLowerCase()) {
    case "5k": return "5K";
    case "10k": return "10K";
    case "half-marathon": return "Half Marathon";
    case "marathon": return "Marathon";
    default: return raceDistance || "race";
  }
}

/** Parse "MM:SS" or "H:MM:SS" or "30 min" → seconds. */
function parseGoalSeconds(goal?: string): number | null {
  if (!goal) return null;
  const g = goal.trim();
  const colon = g.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colon) {
    const a = parseInt(colon[1], 10);
    const b = parseInt(colon[2], 10);
    const c = colon[3] ? parseInt(colon[3], 10) : null;
    return c != null ? a * 3600 + b * 60 + c : a * 60 + b;
  }
  const minOnly = g.match(/(\d+(?:\.\d+)?)\s*min/i);
  if (minOnly) return Math.round(parseFloat(minOnly[1]) * 60);
  const hOnly = g.match(/(\d+(?:\.\d+)?)\s*h(?:r|our)?/i);
  if (hOnly) return Math.round(parseFloat(hOnly[1]) * 3600);
  return null;
}

function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  const total = Math.round(sec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtPace(secPerKm: number): string {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export default function RaceTimeEstimate({ workouts, linkedActivities, raceDistance, goalTime }: Props) {
  const data = useMemo(() => {
    const km = distanceKm(raceDistance);
    const goalSec = parseGoalSeconds(goalTime);
    if (!km || !goalSec) return null;

    // Gather completed planned sessions with valid pace (exclude rest/walk).
    const completed = workouts
      .filter(w => w.dateObj)
      .map(w => {
        const key = format(w.dateObj as Date, "yyyy-MM-dd");
        const act = linkedActivities[key];
        if (!act) return null;
        const dist = Number(act.distance_meters || 0);
        const dur = Number(act.duration_seconds || 0);
        if (dist < 500 || dur < 60) return null;
        const type = classify(w.title);
        if (!type) return null;
        const pace = dur / (dist / 1000); // sec per km
        if (pace < 150 || pace > 900) return null;
        return { date: w.dateObj as Date, type, pace, title: w.title };
      })
      .filter(Boolean) as { date: Date; type: SessionType; pace: number; title: string }[];

    completed.sort((a, b) => b.date.getTime() - a.date.getTime());

    return { km, goalSec, completed };
  }, [workouts, linkedActivities, raceDistance, goalTime]);

  if (!data) return null;
  const { km, goalSec, completed } = data;

  // Take last 3 completed sessions; pick latest of each type for blending
  const last3 = completed.slice(0, 3);
  const ready = last3.length >= 3;

  const latestOf = (t: SessionType) => completed.find(c => c.type === t)?.pace ?? null;
  const easyPace = latestOf("easy");
  const tempoPace = latestOf("tempo");
  const racePace = latestOf("race");

  // Derived race-pace contributions
  const easyContrib = easyPace; // 100% of easy pace
  const tempoContrib = tempoPace != null ? tempoPace + 45 : null; // +45s/km → threshold
  const raceContrib = racePace; // direct

  // Blend with weighting; if a category is missing, redistribute its weight proportionally
  const parts: { weight: number; pace: number }[] = [];
  if (easyContrib != null) parts.push({ weight: 0.2, pace: easyContrib });
  if (tempoContrib != null) parts.push({ weight: 0.4, pace: tempoContrib });
  if (raceContrib != null) parts.push({ weight: 0.4, pace: raceContrib });

  let estPace: number | null = null;
  if (parts.length > 0 && ready) {
    const totalW = parts.reduce((a, p) => a + p.weight, 0);
    estPace = parts.reduce((a, p) => a + p.pace * (p.weight / totalW), 0);
  }
  const estFinish = estPace != null ? estPace * km : null;

  // Gauge bounds (relative to goal)
  const slowSec = goalSec * 1.5;
  const fastSec = goalSec * (25 / 30);
  const redToAmber = goalSec * (35 / 30);
  const amberToGreen = goalSec * (31 / 30);

  // Map seconds → angle along semicircle (180° = slow on left, 0° = fast on right)
  const toAngle = (sec: number) => {
    const clamped = Math.max(fastSec, Math.min(slowSec, sec));
    const t = (slowSec - clamped) / (slowSec - fastSec); // 0 slow → 1 fast
    return 180 - t * 180; // degrees from positive x-axis (SVG)
  };

  // SVG geometry
  const W = 320;
  const H = 180;
  const cx = W / 2;
  const cy = 160;
  const r = 130;
  const rInner = 100;

  const arcPoint = (angleDeg: number, radius: number) => {
    const rad = (Math.PI * angleDeg) / 180;
    return { x: cx - radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
  };

  // Build coloured arc segment paths
  const arcPath = (fromAngle: number, toAngle: number) => {
    const start = arcPoint(fromAngle, r);
    const end = arcPoint(toAngle, r);
    const startInner = arcPoint(toAngle, rInner);
    const endInner = arcPoint(fromAngle, rInner);
    const largeArc = Math.abs(fromAngle - toAngle) > 180 ? 1 : 0;
    const sweepOuter = fromAngle > toAngle ? 0 : 1;
    const sweepInner = fromAngle > toAngle ? 1 : 0;
    return [
      `M ${start.x} ${start.y}`,
      `A ${r} ${r} 0 ${largeArc} ${sweepOuter} ${end.x} ${end.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} ${sweepInner} ${endInner.x} ${endInner.y}`,
      "Z",
    ].join(" ");
  };

  const angleSlow = toAngle(slowSec);            // 180°
  const angleRedAmber = toAngle(redToAmber);
  const angleAmberGreen = toAngle(amberToGreen);
  const angleFast = toAngle(fastSec);             // 0°
  const angleGoal = toAngle(goalSec);

  // Needle
  const needleAngle = estFinish != null ? toAngle(estFinish) : 90;
  const needleEnd = arcPoint(needleAngle, r - 10);

  // Goal notch
  const goalOuter = arcPoint(angleGoal, r + 8);
  const goalInner = arcPoint(angleGoal, rInner - 6);

  // Distance to goal line
  let deltaText = "";
  if (estFinish != null) {
    const diff = estFinish - goalSec;
    if (Math.abs(diff) < 5) deltaText = "On target";
    else if (diff > 0) deltaText = `${fmtTime(diff)} off target`;
    else deltaText = `${fmtTime(-diff)} ahead of target`;
  }

  return (
    <Card className="glass border-border/30">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Target className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold">Estimated {distanceLabel(raceDistance)} Time</h3>
        </div>

        <div className="flex flex-col items-center">
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className={ready ? "" : "opacity-40"}>
            {/* Coloured arc zones */}
            <path d={arcPath(angleSlow, angleRedAmber)} fill="hsl(var(--destructive) / 0.85)" />
            <path d={arcPath(angleRedAmber, angleAmberGreen)} fill="hsl(38 92% 55% / 0.9)" />
            <path d={arcPath(angleAmberGreen, angleFast)} fill="hsl(142 70% 45% / 0.9)" />

            {/* End-tick labels */}
            <text x={arcPoint(angleSlow, r + 14).x} y={arcPoint(angleSlow, r + 14).y} fontSize="10" fill="hsl(var(--muted-foreground))" textAnchor="middle">{fmtTime(slowSec)}</text>
            <text x={arcPoint(angleFast, r + 14).x} y={arcPoint(angleFast, r + 14).y} fontSize="10" fill="hsl(var(--muted-foreground))" textAnchor="middle">{fmtTime(fastSec)}</text>

            {/* Goal notch */}
            <line x1={goalOuter.x} y1={goalOuter.y} x2={goalInner.x} y2={goalInner.y} stroke="hsl(var(--foreground))" strokeWidth="2.5" />
            <text x={goalOuter.x} y={goalOuter.y - 4} fontSize="10" fill="hsl(var(--foreground))" textAnchor="middle" fontWeight="600">Goal {fmtTime(goalSec)}</text>

            {/* Needle */}
            {ready && (
              <>
                <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke="hsl(var(--foreground))" strokeWidth="3" strokeLinecap="round" />
                <circle cx={cx} cy={cy} r={6} fill="hsl(var(--foreground))" />
              </>
            )}

            {/* Centre message when not ready */}
            {!ready && (
              <text x={cx} y={cy - 30} fontSize="11" fill="hsl(var(--muted-foreground))" textAnchor="middle">
                <tspan x={cx} dy="0">Complete more sessions</tspan>
                <tspan x={cx} dy="14">to unlock your estimate</tspan>
              </text>
            )}
          </svg>

          {ready && estPace != null && estFinish != null ? (
            <div className="text-center space-y-1 mt-2">
              <p className="text-xs text-muted-foreground">Estimated pace · <span className="text-foreground font-medium">{fmtPace(estPace)}</span></p>
              <p className="text-base font-bold tracking-tight">{fmtTime(estFinish)}</p>
              <p className={`text-xs ${estFinish <= goalSec + 5 ? "text-green-400" : estFinish <= redToAmber ? "text-amber-400" : "text-red-400"}`}>{deltaText}</p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {last3.length} / 3 planned sessions completed
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
