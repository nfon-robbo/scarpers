import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Target, AlertTriangle, ChevronDown } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import type { ParsedWorkout } from "@/lib/plan-export";

interface Props {
  workouts: ParsedWorkout[];
  linkedActivities: Record<string, any>;
  raceDistance?: string;
  goalTime?: string;
}

// ── Helpers (mirrored from supabase/functions/race-predict + ai-coach) ──
function vo2maxTo5kSeconds(vo2: number): number {
  const anchors: Array<[number, number]> = [
    [30, 45 * 60], [35, 37 * 60], [42, 29 * 60 + 30],
    [50, 23 * 60 + 30], [55, 21 * 60], [60, 19 * 60],
  ];
  if (vo2 <= anchors[0][0]) return anchors[0][1];
  if (vo2 >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [v1, t1] = anchors[i];
    const [v2, t2] = anchors[i + 1];
    if (vo2 >= v1 && vo2 <= v2) return t1 + ((vo2 - v1) / (v2 - v1)) * (t2 - t1);
  }
  return 30 * 60;
}
function riegel(t1Sec: number, d1Km: number, d2Km: number): number {
  return t1Sec * Math.pow(d2Km / d1Km, 1.06);
}

const CONTAMINATION_RE = /walk|w\/r|w\+r|run\/walk|run-walk|interval|fartlek|rep(s|eats)?/i;

function isCleanContinuousRun(title: string, paceSecPerKm: number): boolean {
  if (CONTAMINATION_RE.test(title)) return false;
  if (paceSecPerKm > 8 * 60 + 30) return false; // slower than 8:30/km
  return true;
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

// Extract running-only stats from per-point GPS track.
// Garmin `gps_track` points store speed in km/h (not m/s) and a cumulative
// `distance_meters` value. A point counts as "running" if instantaneous
// speed >= 7.0 km/h (~8:34/km pace ceiling for a single sample).
type ExtractionOutcome =
  | { ok: true; durationSec: number; distanceM: number; paceSecPerKm: number }
  | { ok: false; reason: string; runSec?: number; runDistM?: number; pace?: number };

function extractRunFromGps(gps: any[]): ExtractionOutcome {
  if (!Array.isArray(gps) || gps.length < 20) {
    return { ok: false, reason: "no gps_track data" };
  }
  let runDur = 0;
  let runDist = 0;
  for (let i = 0; i < gps.length - 1; i++) {
    const p = gps[i], q = gps[i + 1];
    const speed = Number(p?.speed); // km/h
    if (!isFinite(speed) || speed < 7.0) continue; // walking / paused
    const t0 = Number(p?.elapsed_time);
    const t1 = Number(q?.elapsed_time);
    const dt = isFinite(t0) && isFinite(t1) ? Math.max(0, t1 - t0) : 1;
    if (dt <= 0 || dt > 30) continue; // skip large gaps
    const d0 = Number(p?.distance_meters);
    const d1 = Number(q?.distance_meters);
    const dd = isFinite(d0) && isFinite(d1) && d1 > d0
      ? d1 - d0
      : (speed / 3.6) * dt; // fall back to speed-derived distance
    runDur += dt;
    runDist += dd;
  }
  if (runDur < 480) {
    return { ok: false, reason: `run segments too short (${Math.round(runDur/60)}min, need ≥8min)`, runSec: runDur, runDistM: runDist };
  }
  if (runDist < 1000) {
    return { ok: false, reason: `run distance too short (${(runDist/1000).toFixed(2)}km, need ≥1km)`, runSec: runDur, runDistM: runDist };
  }
  const pace = runDur / (runDist / 1000);
  if (pace < 180 || pace > 8.5 * 60) {
    return { ok: false, reason: `extracted pace outside range (${Math.floor(pace/60)}:${String(Math.round(pace%60)).padStart(2,"0")}/km)`, pace, runSec: runDur, runDistM: runDist };
  }
  return { ok: true, durationSec: runDur, distanceM: runDist, paceSecPerKm: pace };
}

export default function RaceTimeEstimate({ workouts, linkedActivities, raceDistance, goalTime }: Props) {
  const [vo2Max, setVo2Max] = useState<number | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [extractedRuns, setExtractedRuns] = useState<{ date: Date; pace: number; title: string }[]>([]);
  const [extractedFromCount, setExtractedFromCount] = useState(0);
  const [extractionDebug, setExtractionDebug] = useState<{ attempted: number; succeeded: number; failures: { title: string; reason: string; date: Date }[]; successes: { title: string; pace: number; minutes: number; date: Date }[] }>({ attempted: 0, succeeded: 0, failures: [], successes: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const sinceIso = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
        const { data } = await supabase
          .from("daily_metrics")
          .select("vo2_max,date")
          .eq("user_id", user.id)
          .not("vo2_max", "is", null)
          .gte("date", sinceIso)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && data?.vo2_max) setVo2Max(Number(data.vo2_max));
      } catch (e) {
        // non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Identify walk/run-rejected linked activities and try to extract running segments
  // from their gps_track. Bounded to the 6 most-recent candidates to keep payload small.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const candidates: { date: Date; actId: string; title: string }[] = [];
      for (const w of workouts) {
        if (!w.dateObj) continue;
        const key = format(w.dateObj, "yyyy-MM-dd");
        const act = linkedActivities[key];
        if (!act?.id) continue;
        const dist = Number(act.distance_meters || 0);
        const dur = Number(act.duration_seconds || 0);
        if (dist < 800 || dur < 300) continue;
        const pace = dur / (dist / 1000);
        const title = `${w.title} ${act.name || ""}`.trim();
        // Only candidates that would have been REJECTED by the clean-run filter
        if (isCleanContinuousRun(title, pace)) continue;
        candidates.push({ date: w.dateObj, actId: String(act.id), title });
      }
      candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
      const recent = candidates.slice(0, 6);
      if (recent.length === 0) {
        if (!cancelled) {
          setExtractedRuns([]);
          setExtractedFromCount(0);
          setExtractionDebug({ attempted: 0, succeeded: 0, failures: [], successes: [] });
        }
        return;
      }
      try {
        const { data } = await supabase
          .from("activities")
          .select("id,raw_data")
          .in("id", recent.map((c) => c.actId));
        if (cancelled) return;
        const byId = new Map<string, any>();
        for (const row of data || []) byId.set(String(row.id), row.raw_data);
        const out: { date: Date; pace: number; title: string }[] = [];
        const failures: { title: string; reason: string; date: Date }[] = [];
        const successes: { title: string; pace: number; minutes: number; date: Date }[] = [];
        for (const c of recent) {
          const gps = byId.get(c.actId)?.gps_track;
          const ext = extractRunFromGps(gps);
          const shortTitle = c.title.length > 38 ? c.title.slice(0, 36) + "…" : c.title;
          if (ext.ok === true) {
            out.push({ date: c.date, pace: ext.paceSecPerKm, title: `${c.title} (run segments)` });
            successes.push({ title: shortTitle, pace: ext.paceSecPerKm, minutes: ext.durationSec / 60, date: c.date });
          } else {
            failures.push({ title: shortTitle, reason: ext.reason, date: c.date });
          }
        }
        if (!cancelled) {
          setExtractedRuns(out);
          setExtractedFromCount(out.length);
          setExtractionDebug({ attempted: recent.length, succeeded: out.length, failures, successes });
        }
      } catch {
        if (!cancelled) {
          setExtractedRuns([]);
          setExtractedFromCount(0);
          setExtractionDebug({ attempted: recent.length, succeeded: 0, failures: recent.map((c) => ({ title: c.title, reason: "fetch failed", date: c.date })), successes: [] });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [workouts, linkedActivities]);


  const computed = useMemo(() => {
    const km = distanceKm(raceDistance);
    const goalSec = parseGoalSeconds(goalTime);
    if (!km || !goalSec) return null;

    // Collect linked activities tied to planned workouts, with clean-filter
    const cleanRuns: { date: Date; pace: number; title: string }[] = [];
    let excludedCount = 0;
    for (const w of workouts) {
      if (!w.dateObj) continue;
      const key = format(w.dateObj, "yyyy-MM-dd");
      const act = linkedActivities[key];
      if (!act) continue;
      const dist = Number(act.distance_meters || 0);
      const dur = Number(act.duration_seconds || 0);
      if (dist < 800 || dur < 300) continue;
      const pace = dur / (dist / 1000);
      if (pace < 150 || pace > 900) continue;
      const title = `${w.title} ${act.name || ""}`.trim();
      if (!isCleanContinuousRun(title, pace)) {
        excludedCount++;
        continue;
      }
      cleanRuns.push({ date: w.dateObj, pace, title });
    }
    // Fold in extracted run segments from walk/run sessions.
    // When we have extracted run-only segments, prefer them over "clean" continuous runs that
    // are clearly contaminated (much slower than extracted pace, or wildly slower than VO2 fitness).
    let usedClean = cleanRuns.slice();
    let droppedContaminated = 0;
    if (extractedRuns.length > 0) {
      const fastestExtracted = Math.min(...extractedRuns.map((r) => r.pace));
      const vo2Pace = vo2Max != null ? vo2maxTo5kSeconds(vo2Max) / 5 : null; // sec/km @ 5k
      usedClean = cleanRuns.filter((r) => {
        if (r.pace > fastestExtracted + 45) return false; // >45s/km slower than extracted = contaminated
        if (vo2Pace != null && r.pace > vo2Pace + 90) return false; // wildly slower than VO2 fitness
        return true;
      });
      droppedContaminated = cleanRuns.length - usedClean.length;
    }
    const allClean = [...usedClean, ...extractedRuns];
    allClean.sort((a, b) => b.date.getTime() - a.date.getTime());
    const recentClean = allClean.slice(0, 6);
    // Anything we successfully extracted shouldn't still count as "excluded"
    const netExcluded = Math.max(0, excludedCount - extractedFromCount);

    // VO2-derived target time (primary)
    let tVo2: number | null = null;
    if (vo2Max != null) {
      const t5 = vo2maxTo5kSeconds(vo2Max);
      tVo2 = km === 5 ? t5 : riegel(t5, 5, km);
    }

    // Clean-run derived target (median pace * km). One clean run is enough to seed an estimate.
    let tClean: number | null = null;
    if (recentClean.length >= 1) {
      const paces = [...recentClean.map((r) => r.pace)].sort((a, b) => a - b);
      const median = paces[Math.floor(paces.length / 2)];
      // Subtract ~15 s/km to approximate race pace from training pace
      tClean = Math.max(60, (median - 15)) * km;
    }

    const basis: string[] = [];
    const breakdown: { src: string; included: boolean; note: string }[] = [];
    let estFinish: number | null = null;
    let warning: string | null = null;

    const cleanLabel = extractedFromCount > 0 && usedClean.length === 0
      ? `${extractedFromCount} extracted run segment${extractedFromCount === 1 ? "" : "s"}`
      : extractedFromCount > 0
        ? `${usedClean.length} clean + ${extractedFromCount} extracted`
        : `${recentClean.length} clean run${recentClean.length === 1 ? "" : "s"}`;


    // Walk/run phase detection: many sessions excluded, very few clean runs, no
    // successful extraction. In that case, training pace is unreliable — lean
    // 100% on VO2 max if we have it.
    const walkRunPhase = excludedCount >= 3 && cleanRuns.length <= 1 && extractedFromCount === 0;

    if (walkRunPhase && tVo2 != null) {
      estFinish = tVo2;
      basis.push(`VO2 max ${vo2Max!.toFixed(0)}`);
      breakdown.push({ src: `VO2 max ${vo2Max!.toFixed(0)}`, included: true, note: `${fmtTime(tVo2)} (100%)` });
      breakdown.push({ src: "Training pace", included: false, note: `excluded — walk/run phase, run segment extraction not yet reliable` });
      warning = `Based on VO2 max ${vo2Max!.toFixed(0)} only — run segment extraction in development.`;
    } else if (tVo2 != null && tClean != null) {
      estFinish = tVo2 * 0.7 + tClean * 0.3;
      basis.push(`VO2 max ${vo2Max!.toFixed(0)}`, cleanLabel);
      breakdown.push({ src: `VO2 max ${vo2Max!.toFixed(0)}`, included: true, note: `${fmtTime(tVo2)} (70%)` });
      breakdown.push({ src: cleanLabel, included: true, note: `${fmtTime(tClean)} (30%)` });
    } else if (tVo2 != null) {
      estFinish = tVo2;
      basis.push(`VO2 max ${vo2Max!.toFixed(0)}`);
      breakdown.push({ src: `VO2 max ${vo2Max!.toFixed(0)}`, included: true, note: `${fmtTime(tVo2)} (100%)` });
      if (netExcluded > 0) {
        breakdown.push({ src: "Tempo / easy pace", included: false, note: `excluded (${netExcluded} walk/run or interval session${netExcluded === 1 ? "" : "s"})` });
      }
    } else if (tClean != null) {
      estFinish = tClean;
      basis.push(cleanLabel);
      breakdown.push({ src: cleanLabel, included: true, note: `${fmtTime(tClean)} (100%)` });
      breakdown.push({ src: "VO2 max", included: false, note: "not available" });
    }

    if (extractedFromCount > 0) {
      const extPaces = extractedRuns.map((r) => r.pace).sort((a, b) => a - b);
      const extMedian = extPaces[Math.floor(extPaces.length / 2)];
      breakdown.push({
        src: "Run intervals extracted",
        included: true,
        note: `${extractedFromCount} walk/run session${extractedFromCount === 1 ? "" : "s"} → run-only pace ${fmtPace(extMedian)} (used in estimate)`,
      });
    }
    if (droppedContaminated > 0) {
      breakdown.push({
        src: "Contaminated continuous runs",
        included: false,
        note: `${droppedContaminated} excluded — pace too slow vs extracted run segments`,
      });
    }


    // Sanity cap: if clean-run estimate is wildly slower than VO2-based fitness, snap to VO2
    if (estFinish != null && tVo2 != null && estFinish > tVo2 * 1.4) {
      estFinish = tVo2;
      warning = "Estimate snapped to VO2 max — recent training pace too slow to reflect race fitness.";
    } else if (!walkRunPhase && netExcluded > 0 && tClean == null && tVo2 != null) {
      warning = "Some walk/run sessions excluded — estimate based on VO2 max only. It will sharpen as continuous running develops.";
    }

    const estPace = estFinish != null ? estFinish / km : null;

    return { km, goalSec, estFinish, estPace, basis, breakdown, warning, excludedCount: netExcluded, recentClean };
  }, [workouts, linkedActivities, raceDistance, goalTime, vo2Max, extractedRuns, extractedFromCount]);



  if (!computed) return null;
  const { km, goalSec, estFinish, estPace, basis, breakdown, warning, excludedCount, recentClean } = computed;

  const ready = estFinish != null;

  // Gauge bounds (relative to goal)
  const slowSec = goalSec * 1.5;
  const fastSec = goalSec * (25 / 30);
  const redToAmber = goalSec * (35 / 30);
  const amberToGreen = goalSec * (31 / 30);

  const toAngle = (sec: number) => {
    const clamped = Math.max(fastSec, Math.min(slowSec, sec));
    const t = (slowSec - clamped) / (slowSec - fastSec);
    return 180 - t * 180;
  };

  const W = 320, H = 180, cx = W / 2, cy = 160, r = 130, rInner = 100;
  const arcPoint = (angleDeg: number, radius: number) => {
    const rad = (Math.PI * angleDeg) / 180;
    return { x: cx - radius * Math.cos(rad), y: cy - radius * Math.sin(rad) };
  };
  const arcPath = (fromAngle: number, toA: number) => {
    const start = arcPoint(fromAngle, r);
    const end = arcPoint(toA, r);
    const startInner = arcPoint(toA, rInner);
    const endInner = arcPoint(fromAngle, rInner);
    const largeArc = Math.abs(fromAngle - toA) > 180 ? 1 : 0;
    const sweepOuter = fromAngle > toA ? 0 : 1;
    const sweepInner = fromAngle > toA ? 1 : 0;
    return [
      `M ${start.x} ${start.y}`,
      `A ${r} ${r} 0 ${largeArc} ${sweepOuter} ${end.x} ${end.y}`,
      `L ${startInner.x} ${startInner.y}`,
      `A ${rInner} ${rInner} 0 ${largeArc} ${sweepInner} ${endInner.x} ${endInner.y}`,
      "Z",
    ].join(" ");
  };

  const angleSlow = toAngle(slowSec);
  const angleRedAmber = toAngle(redToAmber);
  const angleAmberGreen = toAngle(amberToGreen);
  const angleFast = toAngle(fastSec);
  const angleGoal = toAngle(goalSec);

  const needleAngle = estFinish != null ? toAngle(estFinish) : 90;
  const needleEnd = arcPoint(needleAngle, r - 10);
  const goalOuter = arcPoint(angleGoal, r + 8);
  const goalInner = arcPoint(angleGoal, rInner - 6);

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
            <path d={arcPath(angleSlow, angleRedAmber)} fill="hsl(var(--destructive) / 0.85)" />
            <path d={arcPath(angleRedAmber, angleAmberGreen)} fill="hsl(38 92% 55% / 0.9)" />
            <path d={arcPath(angleAmberGreen, angleFast)} fill="hsl(142 70% 45% / 0.9)" />
            <text x={arcPoint(angleSlow, r + 14).x} y={arcPoint(angleSlow, r + 14).y} fontSize="10" fill="hsl(var(--muted-foreground))" textAnchor="middle">{fmtTime(slowSec)}</text>
            <text x={arcPoint(angleFast, r + 14).x} y={arcPoint(angleFast, r + 14).y} fontSize="10" fill="hsl(var(--muted-foreground))" textAnchor="middle">{fmtTime(fastSec)}</text>
            <line x1={goalOuter.x} y1={goalOuter.y} x2={goalInner.x} y2={goalInner.y} stroke="hsl(var(--foreground))" strokeWidth="2.5" />
            <text x={goalOuter.x} y={goalOuter.y - 4} fontSize="10" fill="hsl(var(--foreground))" textAnchor="middle" fontWeight="600">Goal {fmtTime(goalSec)}</text>
            {ready && (
              <>
                <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y} stroke="hsl(var(--foreground))" strokeWidth="3" strokeLinecap="round" />
                <circle cx={cx} cy={cy} r={6} fill="hsl(var(--foreground))" />
              </>
            )}
            {!ready && (
              <text x={cx} y={cy - 30} fontSize="11" fill="hsl(var(--muted-foreground))" textAnchor="middle">
                <tspan x={cx} dy="0">Insufficient data</tspan>
                <tspan x={cx} dy="14">add VO2 max or clean runs</tspan>
              </text>
            )}
          </svg>

          {ready && estPace != null && estFinish != null ? (
            <div className="text-center space-y-1 mt-2 w-full max-w-sm">
              <p className="text-xs text-muted-foreground">
                Estimated pace · <span className="text-foreground font-medium">{fmtPace(estPace)}</span>
              </p>
              <p className="text-base font-bold tracking-tight">{fmtTime(estFinish)}</p>
              <p className={`text-xs ${estFinish <= goalSec + 5 ? "text-green-400" : estFinish <= redToAmber ? "text-amber-400" : "text-red-400"}`}>{deltaText}</p>
              {basis.length > 0 && (
                <p className="text-[10px] text-muted-foreground">Based on {basis.join(" + ")}</p>
              )}
              {warning && (
                <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 text-left">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-200/90 leading-snug">{warning}</p>
                </div>
              )}
              {breakdown.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowBreakdown((v) => !v)}
                  className="mt-2 inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  How we calculated this
                  <ChevronDown className={`w-3 h-3 transition-transform ${showBreakdown ? "rotate-180" : ""}`} />
                </button>
              )}
              {showBreakdown && (
                <ul className="mt-1 space-y-0.5 text-left">
                  {breakdown.map((b, i) => (
                    <li key={i} className={`text-[10px] ${b.included ? "text-foreground/80" : "text-muted-foreground line-through decoration-muted-foreground/50"}`}>
                      <span className="font-medium">{b.src}:</span> {b.note}
                    </li>
                  ))}
                  {excludedCount > 0 && (
                    <li className="text-[10px] text-muted-foreground">
                      {excludedCount} walk/run or interval session{excludedCount === 1 ? "" : "s"} excluded
                    </li>
                  )}
                  {extractionDebug.attempted > 0 && (
                    <li className="text-[10px] text-muted-foreground pt-1 border-t border-border/30 mt-1">
                      <span className="font-medium">Debug:</span> extraction attempted on {extractionDebug.attempted}, succeeded {extractionDebug.succeeded}, failed {extractionDebug.failures.length}
                      {extractionDebug.successes.map((s, i) => (
                        <div key={`s${i}`} className="ml-2 text-foreground/70">✓ {format(s.date, "dd/MM")} — {s.title}: {Math.round(s.minutes)}min @ {fmtPace(s.pace)}</div>
                      ))}
                      {extractionDebug.failures.map((f, i) => (
                        <div key={`f${i}`} className="ml-2">✗ {format(f.date, "dd/MM")} — {f.title}: {f.reason}</div>
                      ))}
                    </li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <div className="text-center mt-2 space-y-1">
              <p className="text-xs text-muted-foreground">
                No VO2 max on file and no clean continuous runs yet.
              </p>
              {excludedCount > 0 && (
                <p className="text-[10px] text-muted-foreground">
                  {excludedCount} walk/run or interval session{excludedCount === 1 ? "" : "s"} excluded from estimate.
                </p>
              )}
              {recentClean.length === 0 && excludedCount === 0 && (
                <p className="text-[10px] text-muted-foreground">No clean continuous runs logged yet.</p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
