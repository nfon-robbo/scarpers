import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  classifyTodayActivities,
  isExtremeAccumulatedVolume,
  type TodayActivityInput,
} from "./day-adjust-logic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ============================================================
// Race Time Predictor — chatbot-only feature
// ============================================================
const RACE_PREDICTION_INTENT = /\b(predict|prediction|estimate|forecast|finish time|target time|race time|on track for|sub-?\d|how fast|what time can i|will i (?:run|finish|hit)|can i (?:do|hit|run|break))\b/i;

function distanceKm(raceDistance: string | null | undefined): number {
  const d = String(raceDistance || "").toLowerCase();
  if (d.includes("marathon") && !d.includes("half")) return 42.195;
  if (d.includes("half")) return 21.0975;
  if (d.includes("10")) return 10;
  if (d.includes("5")) return 5;
  return 10;
}
function fmtTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPace(secPerKm: number): string {
  if (!isFinite(secPerKm) || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
// ── Walk/run & contamination filtering helpers ──
const WALK_RUN_TITLE_RE = /walk|w\/r|w\+r|run\/walk|run-walk|interval|fartlek|rep(?:s|eats)?/i;

function activityName(a: any): string {
  return String(a?.raw_data?.name || a?.raw_data?.workout_name || a?.activity_type || "");
}

function hrSamplesWalkShare(a: any): number | null {
  const samples: number[] | undefined =
    a?.raw_data?.hr_samples || a?.raw_data?.heart_rate_samples || a?.raw_data?.hrSeries;
  if (!Array.isArray(samples) || samples.length < 20) return null;
  const lo = samples.filter((s) => Number(s) > 0 && Number(s) < 100).length;
  return lo / samples.length;
}

function lapPaceCV(a: any): number | null {
  const laps: any[] | undefined = a?.raw_data?.laps;
  if (!Array.isArray(laps) || laps.length < 3) return null;
  const paces = laps
    .map((l) => {
      const d = Number(l?.distance_meters ?? l?.distance ?? 0);
      const t = Number(l?.duration_seconds ?? l?.moving_time ?? l?.elapsed_time ?? 0);
      return d > 50 && t > 10 ? t / (d / 1000) : null;
    })
    .filter((p): p is number => p != null && isFinite(p) && p > 120 && p < 1200);
  if (paces.length < 3) return null;
  const mean = paces.reduce((s, n) => s + n, 0) / paces.length;
  const variance = paces.reduce((s, n) => s + (n - mean) ** 2, 0) / paces.length;
  return Math.sqrt(variance) / mean;
}

function isCleanContinuousRun(a: any): { ok: boolean; reason?: string } {
  if (WALK_RUN_TITLE_RE.test(activityName(a))) return { ok: false, reason: "walk/run title" };
  const d = Number(a.distance_meters || 0), t = Number(a.duration_seconds || 0);
  if (d < 800 || t < 300) return { ok: false, reason: "too short" };
  const pace = t / (d / 1000);
  if (pace > 510) return { ok: false, reason: "avg pace >8:30/km (walk-heavy)" };
  const walkShare = hrSamplesWalkShare(a);
  if (walkShare != null && walkShare > 0.10) return { ok: false, reason: ">10% HR <100bpm" };
  const cv = lapPaceCV(a);
  if (cv != null && cv > 0.30) return { ok: false, reason: "lap pace variance >30%" };
  return { ok: true };
}

function tempoPaceFromActivity(a: any): number {
  const laps: any[] | undefined = a?.raw_data?.laps;
  if (Array.isArray(laps) && laps.length >= 3) {
    const lapPaces = laps.map((l) => {
      const d = Number(l?.distance_meters ?? l?.distance ?? 0);
      const t = Number(l?.duration_seconds ?? l?.moving_time ?? l?.elapsed_time ?? 0);
      return d > 50 && t > 10 ? { pace: t / (d / 1000), d, t } : null;
    }).filter((x): x is { pace: number; d: number; t: number } => !!x);
    if (lapPaces.length >= 3) {
      const middle = lapPaces.slice(1, -1).map((l) => l.pace).sort((a, b) => a - b);
      const median = middle[Math.floor(middle.length / 2)];
      const trimmed = lapPaces.filter((l, i) => {
        if (i === 0 || i === lapPaces.length - 1) return l.pace - median < 120;
        return true;
      });
      const td = trimmed.reduce((s, l) => s + l.d, 0);
      const tt = trimmed.reduce((s, l) => s + l.t, 0);
      if (td > 800 && tt > 300) return tt / (td / 1000);
    }
  }
  return Number(a.duration_seconds) / (Number(a.distance_meters) / 1000);
}

function vo2maxTo5kSeconds(vo2: number): number {
  const anchors: Array<[number, number]> = [
    [30, 45 * 60], [35, 37 * 60], [42, 29 * 60 + 30],
    [50, 23 * 60 + 30], [55, 21 * 60], [60, 19 * 60],
  ];
  if (vo2 <= anchors[0][0]) return anchors[0][1];
  if (vo2 >= anchors[anchors.length - 1][0]) return anchors[anchors.length - 1][1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [v1, t1] = anchors[i]; const [v2, t2] = anchors[i + 1];
    if (vo2 >= v1 && vo2 <= v2) return t1 + ((vo2 - v1) / (v2 - v1)) * (t2 - t1);
  }
  return 30 * 60;
}
function riegel(t1Sec: number, d1Km: number, d2Km: number): number {
  return t1Sec * Math.pow(d2Km / d1Km, 1.06);
}

interface PredictionResult {
  raceDistance: string;
  distanceKm: number;
  conservative: number; target: number; stretch: number;
  paceSecPerKm: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  basis: string[];
  caveats: string[];
  breakdown: Array<{ src: string; included: boolean; note: string }>;
  warning?: string;
  validationDate?: string;
  block: string;
}

function buildPrediction(opts: {
  activities: any[];
  metrics: any[];
  plan: any | null;
  readinessScores: number[];
  athleteContext: string;
}): PredictionResult | { insufficient: true; raceDistance: string; goalTime: string | null; block: string } {
  const { activities, metrics, plan, readinessScores, athleteContext } = opts;
  const raceDistance = plan?.race_distance || "10K";
  const dKm = distanceKm(raceDistance);
  const goalTime = plan?.goal_time || null;

  const now = Date.now();
  const within = (a: any, days: number) =>
    a.start_time && now - new Date(a.start_time).getTime() <= days * 86400000;

  const allRuns = (activities || []).filter((a) =>
    /run/i.test(a.activity_type || "") && Number(a.distance_meters || 0) > 800 && Number(a.duration_seconds || 0) > 300
  );
  const last21 = allRuns.filter((a) => within(a, 21));

  if (last21.length < 3) {
    return {
      insufficient: true, raceDistance, goalTime,
      block:
        `RACE_TIME_PREDICTION (insufficient data):\n` +
        `The user has only ${last21.length} completed run(s) in the last 21 days. ` +
        `Tell them: "I need at least 2-3 completed workouts to give you a reliable estimate. ` +
        `Your plan targets ${goalTime || `a ${raceDistance} finish`} — let's see how the first few sessions feel."`,
    };
  }

  // Partition into clean continuous runs vs contaminated (walk/run, intervals, etc.)
  const cleanLast21 = last21.filter((a) => isCleanContinuousRun(a).ok);
  const cleanLast14 = cleanLast21.filter((a) => within(a, 14));

  const paceOf = (a: any) => Number(a.duration_seconds) / (Number(a.distance_meters) / 1000);
  const easyCandidates = cleanLast21
    .filter((a) => !a.avg_heart_rate || Number(a.avg_heart_rate) <= 150)
    .map(paceOf).filter((p) => isFinite(p) && p > 240 && p < 510)
    .sort((a, b) => a - b);
  const easyPace = easyCandidates.length
    ? easyCandidates[Math.floor(easyCandidates.length / 2)] : null;

  const tempoCandidates = cleanLast14
    .filter((a) => Number(a.duration_seconds) >= 900)
    .map(tempoPaceFromActivity)
    .filter((p) => isFinite(p) && p > 180 && p < 510)
    .sort((a, b) => a - b);
  const tempoPace = tempoCandidates.length ? tempoCandidates[0] : null;

  const vo2 = (metrics || []).find((m) => m.vo2_max != null)?.vo2_max;
  const vo2Num = vo2 != null ? Number(vo2) : null;

  const breakdown: Array<{ src: string; included: boolean; note: string }> = [];
  const excludedCount = last21.length - cleanLast21.length;
  if (excludedCount > 0) {
    breakdown.push({
      src: "filter", included: false,
      note: `${excludedCount}/${last21.length} runs excluded as walk/run or interval sessions`,
    });
  }

  const hasCleanTempo = tempoPace != null;
  const walkRunPhase = cleanLast14.length === 0;
  let wTempo = 0, wVo2 = 0, wEasy = 0;
  if (walkRunPhase && vo2Num) {
    wVo2 = easyPace != null ? 0.7 : 1.0;
    wEasy = easyPace != null ? 0.3 : 0;
  } else if (hasCleanTempo && vo2Num) {
    wVo2 = 0.6; wTempo = 0.3; wEasy = easyPace != null ? 0.1 : 0;
  } else if (vo2Num) {
    wVo2 = 1.0;
  } else {
    if (hasCleanTempo) wTempo = 0.7;
    if (easyPace != null) wEasy = hasCleanTempo ? 0.3 : 1.0;
  }

  const estimates: Array<{ src: string; time: number; weight: number }> = [];
  if (wTempo > 0 && tempoPace) {
    const offsets: Record<string, number> = { "5K": -15, "10K": -8, "Half Marathon": 5, "Marathon": 20 };
    const off = offsets[raceDistance] ?? 0;
    estimates.push({ src: "tempo", time: (tempoPace + off) * dKm, weight: wTempo });
    breakdown.push({ src: "tempo", included: true, note: `${fmtPace(tempoPace)} (weight ${Math.round(wTempo*100)}%)` });
  } else if (tempoPace) {
    breakdown.push({ src: "tempo", included: false, note: `${fmtPace(tempoPace)} — excluded (walk/run phase or low weight)` });
  } else {
    breakdown.push({ src: "tempo", included: false, note: "no clean tempo run in last 14d" });
  }
  if (wVo2 > 0 && vo2Num) {
    const t5k = vo2maxTo5kSeconds(vo2Num);
    const tDist = dKm === 5 ? t5k : riegel(t5k, 5, dKm);
    estimates.push({ src: "vo2max", time: tDist, weight: wVo2 });
    breakdown.push({ src: "vo2max", included: true, note: `VO2max ${Math.round(vo2Num)} → ${fmtTime(tDist)} (weight ${Math.round(wVo2*100)}%)` });
  } else if (!vo2Num) {
    breakdown.push({ src: "vo2max", included: false, note: "no VO2max data" });
  }
  if (wEasy > 0 && easyPace) {
    const offsets: Record<string, number> = { "5K": -75, "10K": -75, "Half Marathon": -90, "Marathon": -90 };
    const off = offsets[raceDistance] ?? -75;
    estimates.push({ src: "easy", time: (easyPace + off) * dKm, weight: wEasy });
    breakdown.push({ src: "easy", included: true, note: `${fmtPace(easyPace)} (weight ${Math.round(wEasy*100)}%)` });
  } else if (easyPace) {
    breakdown.push({ src: "easy", included: false, note: `${fmtPace(easyPace)} — excluded` });
  } else {
    breakdown.push({ src: "easy", included: false, note: "no clean easy pace data" });
  }

  if (estimates.length === 0) {
    return {
      insufficient: true, raceDistance, goalTime,
      block: `RACE_TIME_PREDICTION (insufficient data): No usable clean pace or VO2max data. Goal: ${goalTime || "n/a"}.`,
    };
  }

  const totalWeight = estimates.reduce((s, e) => s + e.weight, 0);
  let T = estimates.reduce((s, e) => s + e.time * e.weight, 0) / totalWeight;

  // VO2-max sanity cap — fall back to VO2-only if blended estimate is >40% slower
  let warning: string | undefined;
  if (vo2Num) {
    const t5k = vo2maxTo5kSeconds(vo2Num);
    const tVo2 = dKm === 5 ? t5k : riegel(t5k, 5, dKm);
    if (T > tVo2 * 1.40) {
      warning = `Prediction looked unusually slow for VO2max ${Math.round(vo2Num)} — likely walk/run training data. Falling back to VO2-max-only estimate.`;
      T = tVo2;
      breakdown.push({ src: "sanity-cap", included: true, note: warning });
    }
  }

  let weeksCompleted = 0;
  if (plan?.start_date) {
    weeksCompleted = Math.max(0, (Date.now() - new Date(plan.start_date).getTime()) / (7 * 86400000));
    T *= 1 - Math.min(weeksCompleted * 0.0125, 0.08);
  }

  let adherence = 1;
  if (plan?.training_days && Array.isArray(plan.training_days) && weeksCompleted > 0) {
    const expected = Math.max(1, Math.round(weeksCompleted) * plan.training_days.length);
    const completed = allRuns.filter((a) => plan.start_date && new Date(a.start_time) >= new Date(plan.start_date)).length;
    adherence = Math.min(1, completed / expected);
    if (adherence < 0.7) T *= 1 + (0.7 - adherence) * 0.33;
  }

  const meanReadiness = readinessScores.length
    ? readinessScores.reduce((s, n) => s + n, 0) / readinessScores.length : null;
  if (meanReadiness != null) {
    if (meanReadiness < 55) T *= 1.02;
    else if (meanReadiness > 80) T *= 0.99;
  }

  const conservative = T * 1.04;
  const stretch = T * 0.97;
  const paceSecPerKm = T / dKm;

  const hasIntensitySession = tempoCandidates.length > 0 && cleanLast14.some((a) => Number(a.avg_heart_rate || 0) >= 160);
  let confidence: "HIGH" | "MEDIUM" | "LOW" = "LOW";
  if (hasIntensitySession && cleanLast21.length >= 6) confidence = "HIGH";
  else if (cleanLast21.length >= 4 || vo2Num) confidence = "MEDIUM";
  if (weeksCompleted < 3 && !vo2Num) confidence = "LOW";
  if (warning) confidence = "LOW";

  let validationDate: string | undefined;
  if (plan?.content) {
    const re = /^#{2,4}\s+.*?\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/gm;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const matches = Array.from(String(plan.content).matchAll(re));
    for (const m of matches) {
      const idx = m.index ?? 0;
      const block = String(plan.content).slice(idx, idx + 600);
      if (/tempo|race pace|threshold|interval|time trial/i.test(block)) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        if (d.getTime() >= today.getTime()) {
          validationDate = `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`;
          break;
        }
      }
    }
  }

  const basis: string[] = [];
  if (estimates.find((e) => e.src === "tempo")) basis.push(`tempo pace ${fmtPace(tempoPace!)}`);
  if (vo2Num) basis.push(`VO2max ${Math.round(vo2Num)}`);
  if (estimates.find((e) => e.src === "easy")) basis.push(`easy pace ${fmtPace(easyPace!)}`);
  if (weeksCompleted >= 1) basis.push(`week ${Math.round(weeksCompleted)} of plan`);
  if (adherence < 1) basis.push(`${Math.round(adherence * 100)}% adherence`);
  if (walkRunPhase) basis.push("walk/run phase — VO2max-led estimate");

  const caveats: string[] = [];
  if (warning) caveats.push(warning);
  if (walkRunPhase) caveats.push("No continuous tempo runs in last 14 days — estimate will sharpen as continuous running develops");
  if (meanReadiness != null && meanReadiness < 50) caveats.push("recent readiness is low — assumes healthy race-day execution");
  if (/injur|pain|sore/i.test(athleteContext || "")) caveats.push("injury flagged in profile — prediction assumes healthy execution");

  const breakdownLines = breakdown.map((b) => `  • ${b.src}: ${b.note}`).join("\n");
  const block =
    `RACE_TIME_PREDICTION (use this VERBATIM if the user asked about race time / predicted finish / "on track for"; lead the reply with this block, then ONE short coaching sentence):\n` +
    (warning ? `⚠️ ${warning}\n` : "") +
    `🎯 Target: ${fmtTime(T)} (${fmtPace(paceSecPerKm)})\n` +
    `💪 Stretch: ${fmtTime(stretch)} (if everything clicks${validationDate ? ` — validate on ${validationDate}` : ""})\n` +
    `✅ Conservative: ${fmtTime(conservative)} (safe finish)\n\n` +
    `Based on: ${basis.join(" · ") || "limited data"}\n` +
    `Confidence: ${confidence}${confidence === "LOW" ? " — limited data" : confidence === "MEDIUM" ? " — need more intensity data" : ""}\n` +
    `How we calculated this:\n${breakdownLines}\n` +
    (validationDate ? `Key validation: planned intensity session on ${validationDate}\n` : "") +
    (caveats.length ? `⚠️ ${caveats.join("; ")}\n` : "") +
    (goalTime ? `Plan goal: ${goalTime}\n` : "");

  return {
    raceDistance, distanceKm: dKm,
    conservative, target: T, stretch, paceSecPerKm,
    confidence, basis, caveats, breakdown, warning, validationDate, block,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const reqBody = await req.json();
    const { type, race_distance, goal_time, current_pace_min, current_pace_max, training_days, start_date, race_date, current_plan, adjustment, review_text, messages: chatMessages, history: chatHistory, target_date, today_workout, activity_summary, planned_workout, timezone, preserve_past, plan_start_from_date, today_date_uk, target_is_not_today, geo } = reqBody;
    const tz = typeof timezone === "string" && timezone ? timezone : "UTC";
    const fmtLocal = (iso: string) => {
      try {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short", day: "2-digit", month: "2-digit",
        }).formatToParts(new Date(iso));
        const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
        return `${get("weekday")} ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
      } catch { return iso; }
    };
    // type: "analysis" | "training-plan" | "plan-review" | "plan-adjust" | "day-adjust" | "workout-review"

    // Fetch user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // For plan-review: fetch the current plan's ID and only use linked activities
    // For AI-decide: fetch ALL activities for full fitness picture
    // Otherwise: fetch last 56 days for the 4-week plan
    const isAIDecide = race_date === "ai-recommend";
    const isPlanReview = type === "plan-review";

    let activitiesQuery = supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .order("start_time", { ascending: false });

    if (isPlanReview) {
      // Get the user's current plan ID to filter linked activities
      const { data: currentPlanData } = await supabase
        .from("training_plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (currentPlanData) {
        activitiesQuery = activitiesQuery.eq("training_plan_id", currentPlanData.id);
      }
    } else if (!isAIDecide) {
      const since = new Date();
      since.setDate(since.getDate() - 56);
      activitiesQuery = activitiesQuery.gte("start_time", since.toISOString());
    }

    const { data: activities } = await activitiesQuery;

    if (isPlanReview && (!activities || activities.length === 0)) {
      return new Response(
        JSON.stringify({ error: "No activities linked to your plan. Go to Activities and tick the 'Plan' checkbox on workouts you've completed for this plan." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!activities || activities.length === 0) {
      return new Response(
        JSON.stringify({ error: "No activities found. Please upload FIT files first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch daily metrics for health/readiness context (always, not just AI-decide)
    let metricsContext = "";
    const { data: metrics } = await supabase
      .from("daily_metrics")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(90);

    if (metrics && metrics.length > 0) {
      const metricsSummary = metrics.map((m: any) => ({
        date: m.date,
        resting_hr: m.resting_heart_rate ? Math.round(m.resting_heart_rate) : null,
        hrv: m.hrv ? Math.round(m.hrv) : null,
        sleep_hours: m.sleep_duration_seconds ? (m.sleep_duration_seconds / 3600).toFixed(1) : null,
        stress: m.stress_score,
        steps: m.steps,
        weight: m.weight,
        // Advanced sleep metrics (Phase 3) — null when not provided
        spo2_avg: m.spo2_avg ?? null,
        spo2_lowest: m.spo2_lowest ?? null,
        respiration_avg: m.respiration_avg ?? null,
        breathing_pattern: m.breathing_pattern ?? null,
        skin_temp_deviation: m.skin_temp_deviation ?? null,
        restless_count: m.restless_count ?? null,
        hrv_7d_trend: m.hrv_7d_trend ?? null,
        body_battery_change: m.body_battery_change ?? null,
      }));
      metricsContext = `\nDAILY HEALTH METRICS (last ${metrics.length} days):\n${JSON.stringify(metricsSummary, null, 2)}\n`;

      // Compact human-readable Advanced Sleep Health block (only nights with at least one advanced field)
      const advRows = metrics.filter((m: any) =>
        m.spo2_avg != null || m.spo2_lowest != null || m.respiration_avg != null ||
        m.breathing_pattern || m.skin_temp_deviation != null || m.restless_count != null ||
        m.hrv_7d_trend || m.body_battery_change != null
      );
      if (advRows.length > 0) {
        const lines = advRows.map((m: any) => {
          const parts: string[] = [];
          if (m.spo2_avg != null) parts.push(`SpO₂ ${m.spo2_avg}%${m.spo2_lowest != null ? ` (low ${m.spo2_lowest}%)` : ""}`);
          if (m.breathing_pattern) parts.push(`breathing ${String(m.breathing_pattern).toLowerCase()}`);
          if (m.respiration_avg != null) parts.push(`${m.respiration_avg} brpm`);
          if (m.restless_count != null) parts.push(`${m.restless_count} restless`);
          if (m.skin_temp_deviation != null) parts.push(`skin ${m.skin_temp_deviation > 0 ? "+" : ""}${m.skin_temp_deviation}°C`);
          if (m.hrv_7d_trend) parts.push(`HRV trend ${String(m.hrv_7d_trend).toLowerCase()}`);
          if (m.body_battery_change != null) parts.push(`battery ${m.body_battery_change > 0 ? "+" : ""}${m.body_battery_change}`);
          return `${m.date}: ${parts.join(", ")}`;
        });
        metricsContext += `\nADVANCED SLEEP HEALTH (nights with respiratory/restlessness/skin-temp data):\n${lines.join("\n")}\n`;
      }
    }


    // Fetch Google Fit sleep stages and compute sleep scores
    // PERF: bound to last 60 days to avoid full-table scans for users with
    // months/years of stage history. Previous unbounded query was the prime
    // suspect for the 140s gateway timeout on Day Ahead.
    let sleepContext = "";
    const _sleepStart = performance.now();
    const sleepSince = new Date();
    sleepSince.setDate(sleepSince.getDate() - 60);
    const sleepSinceStr = sleepSince.toISOString().split("T")[0];
    const { data: sleepStages } = await supabase
      .from("sleep_stages")
      .select("date, stage, duration_seconds, start_time, end_time")
      .eq("user_id", user.id)
      .gte("date", sleepSinceStr)
      .order("date", { ascending: false })
      .limit(500);
    console.log(`[PERF] sleep_stages query: ${(performance.now() - _sleepStart).toFixed(0)}ms (${sleepStages?.length ?? 0} rows)`);


    if (sleepStages && sleepStages.length > 0) {
      // Aggregate by date
      const byDate: Record<string, { deep: number; light: number; rem: number; awake: number; earliest?: string; latest?: string }> = {};
      for (const r of sleepStages) {
        if (!byDate[r.date]) byDate[r.date] = { deep: 0, light: 0, rem: 0, awake: 0 };
        const key = r.stage as "deep" | "light" | "rem" | "awake";
        if (key in byDate[r.date]) byDate[r.date][key] += r.duration_seconds;
        if (r.start_time && (!byDate[r.date].earliest || r.start_time < byDate[r.date].earliest!)) byDate[r.date].earliest = r.start_time;
        if (r.end_time && (!byDate[r.date].latest || r.end_time > byDate[r.date].latest!)) byDate[r.date].latest = r.end_time;
      }

      // Compute sleep scores using the same algorithm as the frontend
      const sleepSummary = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 30)
        .map(([date, stages]) => {
          const total = stages.deep + stages.light + stages.rem + stages.awake;
          const sleepTime = stages.deep + stages.light + stages.rem;
          const totalH = total / 3600;
          const deepPct = sleepTime > 0 ? (stages.deep / sleepTime) * 100 : 0;
          const remPct = sleepTime > 0 ? (stages.rem / sleepTime) * 100 : 0;
          const efficiency = total > 0 ? (sleepTime / total) * 100 : 0;

          // Sleep score calculation (same as frontend)
          let durationScore = totalH >= 7 && totalH <= 9 ? 30
            : totalH >= 6 ? 30 * ((totalH - 5) / 2)
            : totalH > 9 && totalH <= 10 ? 30 * (10 - totalH)
            : Math.max(0, 30 * (totalH / 6) * 0.5);
          let deepScore = deepPct >= 15 && deepPct <= 25 ? 25
            : deepPct >= 10 ? 25 * ((deepPct - 5) / 10)
            : Math.max(0, 25 * (deepPct / 15) * 0.6);
          let remScore = remPct >= 20 && remPct <= 30 ? 25
            : remPct >= 10 ? 25 * ((remPct - 5) / 15)
            : Math.max(0, 25 * (remPct / 20) * 0.5);
          let effScore = efficiency >= 90 ? 20
            : efficiency >= 75 ? 20 * ((efficiency - 60) / 30)
            : Math.max(0, 20 * (efficiency / 90) * 0.5);
          const score = Math.round(Math.min(100, durationScore + deepScore + remScore + effScore));

          const fmtHM = (s: number) => {
            const m = Math.round(s / 60);
            return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
          };
          return {
            date,
            sleep_score: score,
            bedtime_local: stages.earliest ? fmtLocal(stages.earliest) : null,
            wake_time_local: stages.latest ? fmtLocal(stages.latest) : null,
            total_sleep: fmtHM(sleepTime),
            time_in_bed: fmtHM(total),
            deep: fmtHM(stages.deep),
            rem: fmtHM(stages.rem),
            light: fmtHM(stages.light),
            awake: fmtHM(stages.awake),
            deep_pct: Math.round(deepPct),
            rem_pct: Math.round(remPct),
            efficiency: Math.round(efficiency),
          };
        });

      sleepContext = `\nSLEEP STAGES & SCORES (last ${sleepSummary.length} nights). All durations are HH:MM strings — quote them EXACTLY as given (e.g. "7:31"), NEVER convert to decimal hours like "7.5h". bedtime_local and wake_time_local are ALREADY in the user's local timezone (${tz}) — use as-is, NEVER call them UTC. total_sleep = ACTUAL ASLEEP time (deep+light+REM, EXCLUDES awake). time_in_bed = total session length. When the user asks "how much sleep" or "total sleep", quote total_sleep:\n${JSON.stringify(sleepSummary, null, 2)}\n`;
    }

    // Build activity summary for the AI
    const activitySummary = (activities || []).map((a: any) => ({
      date: a.start_time?.split("T")[0],
      type: a.activity_type || "unknown",
      duration_min: a.duration_seconds ? Math.round(a.duration_seconds / 60) : null,
      distance_km: a.distance_meters ? (a.distance_meters / 1000).toFixed(1) : null,
      avg_hr: a.avg_heart_rate ? Math.round(a.avg_heart_rate) : null,
      max_hr: a.max_heart_rate ? Math.round(a.max_heart_rate) : null,
      avg_speed: a.avg_speed ? Number(a.avg_speed).toFixed(1) : null,
      avg_power: a.avg_power ? Math.round(a.avg_power) : null,
      calories: a.calories ? Math.round(a.calories) : null,
      total_ascent: a.total_ascent ? Math.round(a.total_ascent) : null,
      cadence: a.avg_cadence ? Math.round(a.avg_cadence) : null,
      training_effect: a.training_effect,
    }));

    const athleteContext = `
Athlete: ${profile?.name || "Unknown"}
Primary Sport: ${profile?.primary_sport || "running"}
Experience: ${profile?.experience_level || "intermediate"}
Goals: ${profile?.training_goals || "general fitness"}
Additional Context: ${profile?.athlete_context || "none"}
`;

    const dataContext = `
TRAINING DATA (${activities.length} activities${isAIDecide ? " - full history" : " over ~8 weeks"}):
${JSON.stringify(activitySummary, null, 2)}
${metricsContext}
${sleepContext}`;

    let systemPrompt = "";
    let userPrompt = "";
    // Optional preamble streamed to the client BEFORE LLM tokens (e.g. a hidden
    // marker the UI parses for the "Detected activity" chip).
    let streamPreamble = "";

    const isPlanAdjust = type === "plan-adjust";

    if (type === "day-adjust") {
      // Fetch last night's sleep for the target date
      const targetDateStr = target_date || new Date().toISOString().split("T")[0];

      // Get yesterday's activity (fatigue indicator)
      const yesterday = new Date(targetDateStr);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      
      const _yStart = performance.now();
      const { data: yesterdayActivities } = await supabase
        .from("activities")
        .select("activity_type, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, training_load")
        .eq("user_id", user.id)
        .gte("start_time", yesterdayStr + "T00:00:00")
        .lt("start_time", targetDateStr + "T00:00:00");
      console.log(`[PERF] yesterday_activities query: ${(performance.now() - _yStart).toFixed(0)}ms (${yesterdayActivities?.length ?? 0} rows)`);

      // Explicit "hard"/"long" classification of yesterday's session
      let yesterdayLoad = { hard: false, long: false, reason: "" as string };
      if (yesterdayActivities && yesterdayActivities.length > 0) {
        for (const a of yesterdayActivities) {
          const dur = Number(a.duration_seconds || 0);
          const avgHr = Number(a.avg_heart_rate || 0);
          const maxHr = Number(a.max_heart_rate || 0) || 190; // fallback estimate
          const load = Number(a.training_load || 0);
          if (dur > 5400) { yesterdayLoad.long = true; yesterdayLoad.reason += `duration ${(dur/60).toFixed(0)}min; `; }
          if ((dur > 3600 && avgHr >= 0.85 * maxHr) || load > 150) {
            yesterdayLoad.hard = true;
            yesterdayLoad.reason += load > 150 ? `training load ${load.toFixed(0)}; ` : `${(dur/60).toFixed(0)}min @ ${avgHr.toFixed(0)}bpm (≥85% max); `;
          }
        }
      }

      let yesterdayContext = "";
      if (yesterdayActivities && yesterdayActivities.length > 0) {
        yesterdayContext = `\nYESTERDAY'S ACTIVITIES:\n${JSON.stringify(yesterdayActivities, null, 2)}\nYESTERDAY LOAD: hard=${yesterdayLoad.hard}, long=${yesterdayLoad.long}${yesterdayLoad.reason ? ` (${yesterdayLoad.reason.trim()})` : ""}\n`;
      }

      // ── TODAY'S ACTIVITIES (already-completed work on the target date) ──
      // Bucket by start_time on the target ISO day. UK-DST drift is acceptable
      // (matches how yesterday's activities are bucketed above).
      const targetNext = new Date(targetDateStr);
      targetNext.setDate(targetNext.getDate() + 1);
      const targetNextStr = targetNext.toISOString().split("T")[0];
      const _tStart = performance.now();
      const { data: todayActivitiesRaw } = await supabase
        .from("activities")
        .select("id, activity_type, distance_meters, duration_seconds, avg_heart_rate, start_time, raw_data")
        .eq("user_id", user.id)
        .gte("start_time", targetDateStr + "T00:00:00")
        .lt("start_time", targetNextStr + "T00:00:00")
        .gte("distance_meters", 500)
        .gte("duration_seconds", 60)
        .order("start_time", { ascending: false })
        .limit(5);
      console.log(`[PERF] today_activities query: ${(performance.now() - _tStart).toFixed(0)}ms (${todayActivitiesRaw?.length ?? 0} rows)`);


      const todayActivities: TodayActivityInput[] = (todayActivitiesRaw || []).map((a: any) => ({
        id: a.id,
        activity_type: a.activity_type,
        distance_meters: a.distance_meters,
        duration_seconds: a.duration_seconds,
        avg_heart_rate: a.avg_heart_rate,
        start_time: a.start_time,
        raw_data: a.raw_data,
      }));

      const todayClassification = classifyTodayActivities(todayActivities, today_workout);
      const extremeVolume = isExtremeAccumulatedVolume(todayClassification.totals);

      const fmtHHMM = (iso: string | null | undefined): string => {
        if (!iso) return "—";
        try {
          return new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit", minute: "2-digit", timeZone: timezone || "Europe/London", hour12: false,
          }).format(new Date(iso));
        } catch { return "—"; }
      };
      const actName = (a: TodayActivityInput): string => {
        const rd = (a.raw_data || {}) as any;
        return String(rd.name || rd.title || rd.activity_name || a.activity_type || "Activity");
      };

      // SHORT-CIRCUIT: scheduled workout already completed → don't call LLM,
      // stream a fixed Markdown block as SSE and return.
      if (todayClassification.status === "SCHEDULED_WORKOUT_COMPLETED" && todayClassification.matchedActivity) {
        const a = todayClassification.matchedActivity;
        const distKm = Number(a.distance_meters || 0) / 1000;
        const durSec = Number(a.duration_seconds || 0);
        const mm = Math.floor(durSec / 60);
        const ss = Math.round(durSec % 60);
        const hr = a.avg_heart_rate != null ? Math.round(Number(a.avg_heart_rate)) : null;

        const markdown =
`✅ Today's workout already completed

You completed **${actName(a)}** at ${fmtHHMM(a.start_time)}:
- Distance: ${distKm.toFixed(1)} km
- Duration: ${mm}:${String(ss).padStart(2, "0")}
- Avg HR: ${hr != null ? hr + " bpm" : "n/a"}

Great work — no adjustment needed. See you tomorrow.

<!-- DAY_ADJUST_STATUS: WORKOUT_ALREADY_COMPLETED activity_id=${a.id || ""} -->
`;

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            const chunk = { choices: [{ delta: { content: markdown } }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
          },
        });
      }

      // Build prompt context for EXTRA_ACTIVITY (single / multiple) and accumulated-volume override.
      let todayActivityContext = "";
      let todayActivityRules = "";
      if (todayClassification.status === "EXTRA_ACTIVITY") {
        const lines = todayActivities.map((a, i) => {
          const distKm = (Number(a.distance_meters || 0) / 1000).toFixed(1);
          const durMin = Math.round(Number(a.duration_seconds || 0) / 60);
          const hr = a.avg_heart_rate != null ? Math.round(Number(a.avg_heart_rate)) + "bpm" : "n/a";
          return `- Activity ${i + 1}: ${a.activity_type || "run"} ${distKm}km / ${durMin}min @ ${hr} (started ${fmtHHMM(a.start_time)})`;
        }).join("\n");
        const totDist = todayClassification.totals.totalDistanceKm.toFixed(1);
        const totMin = Math.round(todayClassification.totals.totalDurationMin);

        // Emit detected-activity marker BEFORE LLM tokens so the UI chip can
        // render immediately (improvement #4). Quotes escaped for HTML-comment safety.
        const lead = todayActivities[0];
        if (lead) {
          const leadDist = (Number(lead.distance_meters || 0) / 1000).toFixed(1);
          const leadMin = Math.round(Number(lead.duration_seconds || 0) / 60);
          const safeType = String(lead.activity_type || "run").replace(/[<>"\n\r]/g, "");
          const label = `${leadDist}km ${safeType} (${leadMin}min)`;
          streamPreamble = `<!-- DAY_ADJUST_DETECTED: name="${label}" started="${fmtHHMM(lead.start_time)}" count=${todayClassification.totals.count} totalKm=${totDist} totalMin=${totMin} -->\n`;
        }

        todayActivityContext = `\nTODAY'S TRAINING (already completed before this assessment):
${lines}
- Totals: ${todayClassification.totals.count} activit${todayClassification.totals.count === 1 ? "y" : "ies"}, ${totDist}km / ${totMin}min
- Status: EXTRA_ACTIVITY (not the scheduled workout)
`;

        if (extremeVolume) {
          todayActivityRules = `\nTODAY VOLUME OVERRIDE (MANDATORY):
The athlete has already trained ${totDist}km / ${totMin}min today, exceeding the safe threshold (>15km or >90min).
Decision MUST be ADJUSTED. Replace the recommended workout with a Rest Day table.
Coach's Note MUST include verbatim: "⚠️ OVERRIDE: You've already trained ${totDist}km / ${totMin}min today. Replacing tonight's workout with Rest Day to prevent overtraining."
`;
        } else {
          const lead = todayActivities[0];
          const leadDist = (Number(lead?.distance_meters || 0) / 1000).toFixed(1);
          todayActivityRules = `\nTODAY EXTRA-ACTIVITY RULE (MANDATORY):
The athlete already ran ${leadDist}km today before this assessment (NOT the scheduled session). Factor accumulated fatigue into the decision.
Coach's Note MUST include verbatim: "⚠️ You've already run ${leadDist}km today. If tonight's session feels too hard, skip it — you've already done significant training."
`;
        }
      }


      const _tmStart = performance.now();
      const { data: todayMetrics } = await supabase
        .from("daily_metrics")
        .select("resting_heart_rate, hrv, stress_score, steps")
        .eq("user_id", user.id)
        .eq("date", targetDateStr)
        .maybeSingle();
      console.log(`[PERF] today_metrics query: ${(performance.now() - _tmStart).toFixed(0)}ms`);


      let metricsToday = "";
      if (todayMetrics) {
        metricsToday = `\nTODAY'S METRICS:\nResting HR: ${todayMetrics.resting_heart_rate ? Math.round(todayMetrics.resting_heart_rate) + " bpm" : "N/A"}\nHRV: ${todayMetrics.hrv ? Math.round(todayMetrics.hrv) + " ms" : "N/A"}\nStress: ${todayMetrics.stress_score ?? "N/A"}\n`;
      }

      // ── Trend context for trend-based ADJUSTED gating ──
      // Pull last 14 days of metrics to compute baselines + count consecutive
      // poor nights. Enforces "2+ consecutive poor nights + 1 corroborating
      // metric" rule so a single bad night doesn't trigger ADJUSTED.
      const trendStart = new Date(targetDateStr);
      trendStart.setDate(trendStart.getDate() - 14);
      const trendStartStr = trendStart.toISOString().split("T")[0];
      const _trStart = performance.now();
      const { data: trendMetrics } = await supabase
        .from("daily_metrics")
        .select("date, sleep_score, sleep_duration_seconds, deep_sleep_minutes, rem_sleep_minutes, awake_during_night_minutes, hrv, resting_heart_rate")
        .eq("user_id", user.id)
        .gte("date", trendStartStr)
        .lte("date", targetDateStr)
        .order("date", { ascending: false });
      console.log(`[PERF] trend_metrics query: ${(performance.now() - _trStart).toFixed(0)}ms (${trendMetrics?.length ?? 0} rows)`);


      let trendContext = "";
      let consecutivePoorOut = 0;
      let hrvDeltaPctOut: number | null = null;
      let rhrDeltaOut: number | null = null;
      if (trendMetrics && trendMetrics.length > 0) {
        const nights = trendMetrics.slice(0, 7);
        const nightsLine = nights.map((n: any) => {
          const score = n.sleep_score != null ? Math.round(n.sleep_score) : null;
          const hrs = n.sleep_duration_seconds ? (n.sleep_duration_seconds / 3600).toFixed(1) + "h" : "n/a";
          return `${n.date}: score ${score ?? "n/a"}, ${hrs}`;
        }).join(" | ");

        const median = (arr: number[]): number | null => {
          if (!arr.length) return null;
          const s = [...arr].sort((a, b) => a - b);
          const m = Math.floor(s.length / 2);
          return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        };
        const hrvValues = trendMetrics.map((m: any) => m.hrv).filter((v: any) => v != null && Number.isFinite(v));
        const rhrValues = trendMetrics.map((m: any) => m.resting_heart_rate).filter((v: any) => v != null && Number.isFinite(v));
        const baselineHrv = hrvValues.length ? Math.round(median(hrvValues)!) : null;
        const baselineRhr = rhrValues.length ? Math.round(median(rhrValues)!) : null;

        // Refined POOR: (score<60 AND <7h) OR score<50
        const POOR = (n: any) => {
          const score = n.sleep_score;
          const hours = n.sleep_duration_seconds ? n.sleep_duration_seconds / 3600 : null;
          if (score != null && score < 50) return true;
          if (score != null && score < 60 && hours != null && hours < 7) return true;
          return false;
        };
        let consecutivePoor = 0;
        for (const n of nights) { if (POOR(n)) consecutivePoor++; else break; }
        consecutivePoorOut = consecutivePoor;

        const todayHrv = todayMetrics?.hrv ?? null;
        const todayRhr = todayMetrics?.resting_heart_rate ?? null;
        const hrvDeltaPct = (todayHrv != null && baselineHrv) ? ((todayHrv - baselineHrv) / baselineHrv * 100) : null;
        const rhrDelta = (todayRhr != null && baselineRhr != null) ? (todayRhr - baselineRhr) : null;
        hrvDeltaPctOut = hrvDeltaPct;
        rhrDeltaOut = rhrDelta;

        trendContext = `\nSLEEP TREND (last ${nights.length} nights, most recent first):\n${nightsLine}\nConsecutive poor nights ((score<60 & <7h) or score<50) ending today: ${consecutivePoor}\n\nBASELINES (last 14d median):\nHRV: ${baselineHrv ?? "n/a"} ms (today ${todayHrv != null ? Math.round(todayHrv) + " ms" : "n/a"}${hrvDeltaPct != null ? `, ${hrvDeltaPct >= 0 ? "+" : ""}${hrvDeltaPct.toFixed(0)}% vs baseline` : ""})\nResting HR: ${baselineRhr ?? "n/a"} bpm (today ${todayRhr != null ? Math.round(todayRhr) + " bpm" : "n/a"}${rhrDelta != null ? `, ${rhrDelta >= 0 ? "+" : ""}${rhrDelta.toFixed(0)} bpm vs baseline` : ""})\n`;
      }

      // Escalation message based on chronic poor sleep
      let escalationContext = "";
      if (consecutivePoorOut >= 7) {
        escalationContext = `\nESCALATION: ⚠️ MANDATORY REST — seven consecutive poor nights indicates you need medical attention, not training.\n`;
      } else if (consecutivePoorOut >= 5) {
        escalationContext = `\nESCALATION: ⚠️ Sleep has been poor for 5+ nights. Prioritise rest and recovery — training is secondary right now. Consider consulting a doctor if this continues.\n`;
      } else if (consecutivePoorOut >= 3) {
        escalationContext = `\nESCALATION: Third poor night in a row — identify what's disrupting your sleep (stress, caffeine, screen time).\n`;
      }

      // Detect today's planned intensity from the workout markdown
      const todayWorkoutText = (today_workout || "").toLowerCase();
      let plannedIntensity: "hard" | "easy" | "rest" = "easy";
      if (!todayWorkoutText.trim() || /\brest\b/.test(todayWorkoutText)) plannedIntensity = "rest";
      else if (/tempo|interval|threshold|race pace|vo2|hill repeat|hill repeats/.test(todayWorkoutText)) plannedIntensity = "hard";
      const intensityContext = `\nTODAY PLANNED INTENSITY: ${plannedIntensity}\n`;

      // Fetch recent cadence data from running activities (last 30 days)
      const cadenceSince = new Date(targetDateStr);
      cadenceSince.setDate(cadenceSince.getDate() - 30);
      const _cStart = performance.now();
      const { data: recentRuns } = await supabase
        .from("activities")
        .select("start_time, avg_cadence, avg_speed, distance_meters, duration_seconds")
        .eq("user_id", user.id)
        .gte("start_time", cadenceSince.toISOString())
        .not("avg_cadence", "is", null)
        .order("start_time", { ascending: false })
        .limit(20);
      console.log(`[PERF] cadence query: ${(performance.now() - _cStart).toFixed(0)}ms (${recentRuns?.length ?? 0} rows)`);


      const CADENCE_CUES = [
        "Try a 170 BPM metronome playlist today (search 'running 170 bpm' on Spotify).",
        "Focus on quicker foot turnover — imagine running on hot coals.",
        "Shorten your stride 10% while maintaining the same speed — your feet should feel lighter.",
        "Count three footfalls per second out loud for the first kilometre to lock in the rhythm.",
        "Cue 'quick, light feet' — land softly directly under your hips, not out in front.",
        "Run alongside a song at 170 BPM (e.g. 'Stayin' Alive') for the warm-up to set the pace.",
      ];
      let cadenceContext = "";
      if (recentRuns && recentRuns.length > 0) {
        const cadences = recentRuns.map(r => r.avg_cadence!);
        const avgCadence = Math.round(cadences.reduce((a, b) => a + b, 0) / cadences.length);
        const latestCadence = Math.round(cadences[0]);
        const trend = cadences.length >= 3 
          ? (cadences[0] > cadences[cadences.length - 1] ? "improving" : cadences[0] < cadences[cadences.length - 1] ? "declining" : "stable")
          : "insufficient data";
        const cueLine = avgCadence < 160
          ? `\nCADENCE CUE FOR TODAY (use this exact cue verbatim in the Coach's Note): "${CADENCE_CUES[Math.floor(Math.random() * CADENCE_CUES.length)]}"\n`
          : "";
        cadenceContext = `\nCADENCE DATA (last ${recentRuns.length} runs):\nAverage cadence: ${avgCadence} spm\nMost recent: ${latestCadence} spm\nTrend: ${trend}\nTarget range: 170-180 spm for joint protection\n${avgCadence < 160 ? "⚠️ Cadence is LOW — prioritize quick, light steps to reduce impact on knee/ankle.\n" : avgCadence >= 170 ? "✅ Cadence is in target range — great for joint health.\n" : "Cadence improving but still below target — continue cueing 'quick feet'.\n"}${cueLine}`;
      }

      systemPrompt = `You are an elite endurance coach making a real-time daily adjustment decision for an athlete's workout.

🚨 SURGICAL EDIT MODE (HIGHEST PRIORITY) 🚨
If the user prompt contains a "COACH RECOMMENDATION TO APPLY" block, you are NOT doing a readiness assessment — you are applying ONE specific edit to the workout that follows. Rules:
- Make the SMALLEST POSSIBLE change. Do not redesign the session.
- "Add a rep" / "add another rep" → duplicate the existing interval pair (work + recovery) ONE more time. Keep the same duration, pace, walk recovery, cadence, BPM, notes. Do NOT change pace. Do NOT change duration. Do NOT change session type. Do NOT change the title. Do NOT add warnings.
- "Remove a rep" → delete the LAST work+recovery pair only.
- "Make it shorter / longer" → only adjust what was asked.
- NEVER replace a run/walk interval session with stretching, mobility, yoga, rest, or any other session type unless the user explicitly asked for that.
- 🚫 NEVER add mobility, stretching, static stretching, foam rolling, yoga, or any non-running auxiliary segment as a row inside a workout's segment table. Workout tables contain ONLY warm-up, run/walk intervals, main running blocks, and cool-down. If recovery work is relevant, mention it in the notes column or in your prose recommendation — NEVER as its own segment row.
- NEVER change the workout title unless the structural type changed.
- Preserve every other segment exactly as written, including warm-up, cool-down, paces, BPM, notes.
- Output the COMPLETE modified workout under "## 📝 Recommended Workout" using the same table format. Skip the readiness assessment fluff — go straight to Decision (always "ADJUSTED") and the workout.
- 🔥 EXCEPTION — FULL REPLACEMENT: If the recommendation block begins with "FULL REPLACEMENT:" then the user has explicitly confirmed a complete session swap. In that case IGNORE the "preserve session type / title / segments" rules above and output the new workout verbatim as described — new title, new segments, new pace, new everything. Do NOT keep any of the original session's structure.



You have:
1. The athlete's PLANNED WORKOUT for today
2. Their LAST NIGHT'S SLEEP data (stages, score, quality)
3. Yesterday's training (fatigue carry-over)
4. Today's biometrics (resting HR, HRV, stress)

🚨 DECISION GATING (TREND-BASED — MUST FOLLOW) 🚨
The default decision is **KEEP AS-IS**. There are now THREE possible decisions: KEEP AS-IS, SOFT ADJUSTED, ADJUSTED.

Definitions used below:
- "Poor night" = (sleep_score < 60 AND duration < 7h) OR sleep_score < 50
- "Hard yesterday" = the YESTERDAY LOAD line reports hard=true (duration >60min at ≥85% max HR, OR training_load >150)
- "Long yesterday" = YESTERDAY LOAD reports long=true (duration >90min)
- "Today is hard" = TODAY PLANNED INTENSITY = hard (tempo / intervals / threshold / race pace / VO2 / hill repeats)

Choose **ADJUSTED** when ANY of these triggers fires:
  A. Consecutive poor nights ≥ 2 AND at least one corroborating signal:
     - Today's HRV is **>15% below** the 14-day median baseline, OR
     - Today's resting HR is **≥3 bpm above** the 14-day median baseline, OR
     - Yesterday was hard or long AND last night was also poor.
  B. TRAINING-LOAD VELOCITY: yesterday was hard AND today is hard AND last night was poor — even if HRV/RHR are only mildly off. Swap the hard session for an easy Z2 run. State reason: "Two consecutive hard sessions on suboptimal recovery risks overtraining."
  C. CHRONIC SLEEP (consecutive poor nights ≥ 7): force ADJUSTED with the Recommended Workout replaced by a Rest Day table, and include the ESCALATION line verbatim in the Coach's Note.

Choose **SOFT ADJUSTED** when:
  - Exactly 1 poor night ending today AND (HRV is 10–15% below median baseline OR RHR is +2 bpm above median baseline).
  - Keep the workout STRUCTURE and title. Either reduce target pace by 10–15 sec/km, OR add an extra 5 min warm-up with a "scale back if it doesn't ease" note. Output exactly: "## ✅ Decision: SOFT ADJUSTED — one suboptimal night with slightly elevated fatigue markers".

Otherwise choose **KEEP AS-IS**.

A single night of poor sleep with HRV and RHR in normal range and no velocity/escalation trigger is NOT enough to ADJUST — the correct decision is KEEP AS-IS (or SOFT ADJUSTED if the mild-deviation criteria above are met).

When the decision is **KEEP AS-IS** but last night was sub-average (score < 70 or noticeably shorter than usual), the Coach's Note MUST include this exact sentence verbatim:
> Sleep was a little below your average last night. Listen to your body during the warmup and ease off if needed.

When the decision is **ADJUSTED**, the Decision section must briefly state the trigger AND the corroborating metric (e.g. "2 poor nights + HRV 22% below baseline", or "Velocity trigger: hard yesterday + hard today + poor sleep").

If the context includes an ESCALATION line (3, 5 or 7+ consecutive poor nights), include that line VERBATIM in the Coach's Note section.

If the user prompt contains "TARGET IS NOT TODAY: true", prepend the response with these two lines BEFORE the "## 🌙 Sleep & Recovery Assessment" heading:
🛌 Today ({today_date_uk}) is a scheduled rest day.
Assessing tomorrow's workout ({target_date_uk})...

Sleep-science reference (use to shape adjustment magnitude, NOT to bypass the gating above):
- Deep sleep < 15%: impaired physical recovery → reduce high-intensity work
- REM < 20%: impaired cognitive/motor recovery → keep drills simple
- High awake time (>10%): fragmented sleep → reduce overall volume

Also consider:
- CADENCE is critical for joint health: target 170-180 spm. If recent cadence is below 160 spm, emphasize "quick, light feet" cues in your coaching note. If a "CADENCE CUE FOR TODAY" line is provided, use that EXACT cue verbatim in the Coach's Note. If cadence is trending up, praise the improvement. Always include a cadence recommendation in adjusted workouts.

Your response MUST follow this exact format. Use the literal phrase "the target session" or refer to the target date — do NOT say "today" or "today's" if the target date in the user prompt is not actually today's calendar date.

## 🌙 Sleep & Recovery Assessment
Brief summary of last night's sleep quality and what it means for the target session.

## 📋 Planned Workout — {TARGET_DATE_FORMATTED}
Replace {TARGET_DATE_FORMATTED} with the target date written in UK long format (e.g. "Thursday 15 May 2026") based on the target date provided in the user prompt. Then show the original planned workout for that date.

## ✅ Decision: [KEEP AS-IS / SOFT ADJUSTED / ADJUSTED]
State clearly whether you're modifying the workout or not, and why.

## 📝 Recommended Workout — {TARGET_DATE_FORMATTED}
Replace {TARGET_DATE_FORMATTED} with the same UK long-format target date used above.
If adjusted, provide the COMPLETE modified workout in the EXACT same markdown table format (Segment | Duration/Distance | Target | Notes). Include the workout title with "(Total: Xmin)". When a segment has a distance target, include both distance and estimated duration.
If kept as-is, restate the original workout.

## 💡 Coach's Note
1-2 sentences max. One practical tip (hydration, warm-up, mental cue).

## 🔄 Sync Reminder
One sentence: "If adjusted, sync your plan to intervals.icu to update your watch."

BREVITY RULES:
- Sleep & Recovery Assessment: 2-3 bullet points max, no prose paragraphs
- Decision section: 1-2 sentences explaining why
- Coach's Note: 1-2 sentences only
- Total response should be as short as possible while remaining actionable

${athleteContext}`;

      const targetIsNotTodayLine = target_is_not_today
        ? `\nTARGET IS NOT TODAY: true\ntoday_date_uk: ${today_date_uk || "today"}\ntarget_date_uk: (format ${targetDateStr} in UK long form, e.g. "Tuesday 22 May 2026")\n`
        : "";

      userPrompt = `Date: ${targetDateStr}
${targetIsNotTodayLine}
LAST NIGHT'S SLEEP DATA:
${sleepContext || "No sleep data available for last night."}

${metricsToday}
${trendContext}
${escalationContext}
${intensityContext}
${yesterdayContext}
${todayActivityContext}
${todayActivityRules}
${cadenceContext}

PLANNED WORKOUT FOR ${targetDateStr}:
${today_workout || "No workout found for the target date."}

Analyze the athlete's readiness and decide whether to adjust the planned workout for ${targetDateStr}. Apply the gating rules strictly (KEEP AS-IS / SOFT ADJUSTED / ADJUSTED). Be specific and data-driven. Include cadence recommendations if cadence data is available.`;



    } else if (type === "chat") {
      // Fetch the user's active training plan so chat answers reference real scheduled sessions
      let chatPlanContext = "";
      try {
        const { data: activePlan } = await supabase
          .from("training_plans")
          .select("content, start_date, race_date, race_distance, goal_time, training_days")
          .eq("user_id", user.id)
          .eq("archived", false)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (activePlan?.content) {
          const today = new Date();
          const dateInTz = (offsetDays = 0) => {
            const d = new Date(today);
            d.setDate(today.getDate() + offsetDays);
            const parts = new Intl.DateTimeFormat("en-GB", {
              timeZone: tz,
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
              weekday: "long",
            }).formatToParts(d);
            const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
            return { date: `${get("day")}/${get("month")}/${get("year")}`, weekday: get("weekday") };
          };
          const todayInfo = dateInTz(0);
          const tomorrowInfo = dateInTz(1);
          const planEntries = String(activePlan.content)
            .split(/(?=^#{2,4}\s+.*?\b\d{1,2}\/\d{1,2}\/\d{4}\b.*$)/gmi)
            .filter((entry) => /^#{2,4}\s+.*?\b\d{1,2}\/\d{1,2}\/\d{4}\b/m.test(entry.split("\n")[0] || ""));
          const findPlanEntry = (date: string) => planEntries.find((entry) => {
            const match = entry.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
            if (!match) return false;
            return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[3]}` === date;
          });
          const summariseEntry = (date: string) => {
            const entry = findPlanEntry(date);
            if (!entry) return `${date}: NO SESSION SCHEDULED — rest day / blank diary day.`;
            const heading = entry.split("\n")[0]?.replace(/[#*_`]/g, "").trim() || date;
            const title = entry.split("\n").find((line) => /total:|run|walk|interval|easy|long|rest|race/i.test(line) && !/^\s*\|/.test(line))?.replace(/[#*_`]/g, "").trim();
            return `${date}: ${heading}${title && title !== heading ? ` — ${title}` : ""}`;
          };
          const diaryLookup = Array.from({ length: 14 }, (_, i) => {
            const info = dateInTz(i);
            return `- ${i === 0 ? "Today" : i === 1 ? "Tomorrow" : `+${i}d`} (${info.weekday} ${info.date}): ${summariseEntry(info.date)}`;
          }).join("\n");
          const todayStr = todayInfo.date;
          chatPlanContext = `\nACTIVE TRAINING PLAN (today is ${todayStr}, UK format DD/MM/YYYY):
- Start date: ${activePlan.start_date || "n/a"}
- Race date: ${activePlan.race_date || "n/a"}
- Race distance: ${activePlan.race_distance || "n/a"}
- Goal time: ${activePlan.goal_time || "n/a"}
- Training days: ${(activePlan.training_days || []).join(", ") || "n/a"}

PLAN CONTENT (markdown):
${activePlan.content}

AUTHORITATIVE PLAN DIARY LOOKUP (exact dated entries only; this overrides prior chat messages and weekday assumptions):
${diaryLookup}

TODAY/TOMORROW STATUS:
- Today is ${todayInfo.weekday} ${todayInfo.date}: ${summariseEntry(todayInfo.date)}
- Tomorrow is ${tomorrowInfo.weekday} ${tomorrowInfo.date}: ${summariseEntry(tomorrowInfo.date)}

When the user asks about a future or past session (e.g. "next Friday", "this Wednesday", "16/05/2026"), look it up in the plan content above and answer with the actual scheduled workout. Never claim you don't have access to the plan — it is provided here.`;
        } else {
          chatPlanContext = `\nACTIVE TRAINING PLAN: none (the user has no active training plan). If they ask about a scheduled session, tell them they don't have an active plan yet.`;
        }
      } catch (e) {
        console.error("chat plan fetch error:", e);
      }

      const immediateDiaryCorrection = chatPlanContext && /\b(today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i.test(chatMessages || "")
        ? `${chatPlanContext.match(/TODAY\/TOMORROW STATUS:[\s\S]*?(?=\n\nWhen the user asks|$)/)?.[0] || ""}\n\nUse the status above as the source of truth for this reply. If tomorrow says NO SESSION SCHEDULED, correct the prior mistake and do not propose replacing tomorrow's workout.\n\n`
        : "";

      // Fetch latest readiness, Running IQ, recent analyses, and uploads so every model sees the full app picture
      let chatExtraContext = "";
      try {
        const [readinessRes, runningIqRes, analysesRes, uploadsRes] = await Promise.all([
          supabase.from("readiness_snapshots")
            .select("score, factors, recorded_at, hour")
            .eq("user_id", user.id)
            .order("recorded_at", { ascending: false })
            .limit(14),
          supabase.from("running_iq_snapshots")
            .select("score, adjusted_score, label, lowest_pillar, coaching_tip, pillars, recorded_at")
            .eq("user_id", user.id)
            .order("recorded_at", { ascending: false })
            .limit(7),
          supabase.from("analyses")
            .select("content, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(3),
          supabase.from("uploads")
            .select("file_name, file_type, status, record_count, created_at")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        const unitsBlock = `\nUSER UNIT PREFERENCES: distance=${profile?.unit_distance || "km"}, speed=${profile?.unit_speed || "km/h"}, elevation=${profile?.unit_elevation || "m"}, temperature=${profile?.unit_temperature || "C"}, height=${profile?.unit_height || "cm"}, weight=${profile?.unit_weight || "kg"}. Always present numbers in these units.`;
        const profileBlock = `\nPROFILE EXTRA: sex=${profile?.sex || "n/a"}, dob=${profile?.date_of_birth || "n/a"}, height_cm=${profile?.height_cm || "n/a"}, weight_kg=${profile?.weight_kg || "n/a"}.`;
        const readinessBlock = readinessRes.data?.length
          ? `\nREADINESS SNAPSHOTS (last ${readinessRes.data.length}):\n${JSON.stringify(readinessRes.data, null, 2)}`
          : "";
        const runningIqBlock = runningIqRes.data?.length
          ? `\nRUNNING IQ SNAPSHOTS (last ${runningIqRes.data.length}, 0-200 scale, 5 pillars):\n${JSON.stringify(runningIqRes.data, null, 2)}`
          : "";
        const analysesBlock = analysesRes.data?.length
          ? `\nRECENT AI ANALYSES (most recent first):\n${analysesRes.data.map((a: any) => `- ${a.created_at}: ${String(a.content).slice(0, 600)}`).join("\n")}`
          : "";
        const uploadsBlock = uploadsRes.data?.length
          ? `\nRECENT UPLOADS / IMPORTS:\n${JSON.stringify(uploadsRes.data, null, 2)}`
          : "";

        chatExtraContext = unitsBlock + profileBlock + readinessBlock + runningIqBlock + analysesBlock + uploadsBlock;

        // ── Weather context (Open-Meteo, free, no API key) ──
        try {
          const lat = Number(geo?.lat);
          const lon = Number(geo?.lon);
          if (isFinite(lat) && isFinite(lon)) {
            const tempUnit = (profile?.unit_temperature || "C").toLowerCase() === "f" ? "fahrenheit" : "celsius";
            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
              `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index,is_day` +
              `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,relative_humidity_2m` +
              `&daily=sunrise,sunset,uv_index_max,precipitation_sum,temperature_2m_max,temperature_2m_min` +
              `&forecast_days=2&timezone=auto&temperature_unit=${tempUnit}&wind_speed_unit=kmh`;
            const wRes = await fetch(url, { signal: AbortSignal.timeout(4000) });
            if (wRes.ok) {
              const w = await wRes.json();
              const wmoCode: Record<number, string> = {
                0:"clear sky",1:"mainly clear",2:"partly cloudy",3:"overcast",
                45:"fog",48:"depositing rime fog",
                51:"light drizzle",53:"moderate drizzle",55:"dense drizzle",
                56:"light freezing drizzle",57:"dense freezing drizzle",
                61:"light rain",63:"moderate rain",65:"heavy rain",
                66:"light freezing rain",67:"heavy freezing rain",
                71:"light snow",73:"moderate snow",75:"heavy snow",77:"snow grains",
                80:"light rain showers",81:"moderate rain showers",82:"violent rain showers",
                85:"light snow showers",86:"heavy snow showers",
                95:"thunderstorm",96:"thunderstorm w/ light hail",99:"thunderstorm w/ heavy hail",
              };
              const cur = w.current || {};
              const hourly = w.hourly || {};
              const daily = w.daily || {};
              const tu = w.current_units?.temperature_2m || "°C";
              // Build next-24h hourly slice starting from current hour
              const times: string[] = hourly.time || [];
              const nowIdx = Math.max(0, times.findIndex((t: string) => new Date(t).getTime() >= Date.now()) - 1);
              const slice = (arr: any[]) => (arr || []).slice(nowIdx, nowIdx + 24);
              const hours = slice(times).map((t: string, i: number) => ({
                time: t.slice(11, 16) + " " + t.slice(5, 10),
                tempC: slice(hourly.temperature_2m)[i],
                feelsLike: slice(hourly.apparent_temperature)[i],
                precipProb: slice(hourly.precipitation_probability)[i],
                precipMm: slice(hourly.precipitation)[i],
                conditions: wmoCode[slice(hourly.weather_code)[i]] ?? "unknown",
                windKmh: slice(hourly.wind_speed_10m)[i],
                gustKmh: slice(hourly.wind_gusts_10m)[i],
                uv: slice(hourly.uv_index)[i],
                humidity: slice(hourly.relative_humidity_2m)[i],
              }));
              const weatherBlock = `\n\nCURRENT WEATHER (live, from Open-Meteo, location ${lat.toFixed(2)},${lon.toFixed(2)}, timezone ${w.timezone || tz}):
- Now: ${cur.temperature_2m}${tu}, feels like ${cur.apparent_temperature}${tu}, ${wmoCode[cur.weather_code] ?? "unknown"}, humidity ${cur.relative_humidity_2m}%, wind ${cur.wind_speed_10m} km/h (gusts ${cur.wind_gusts_10m} km/h), UV ${cur.uv_index ?? "n/a"}, precipitation ${cur.precipitation} mm, cloud ${cur.cloud_cover}%, ${cur.is_day ? "daytime" : "night"}.
- Today: high ${daily.temperature_2m_max?.[0]}${tu} / low ${daily.temperature_2m_min?.[0]}${tu}, max UV ${daily.uv_index_max?.[0]}, total precip ${daily.precipitation_sum?.[0]} mm, sunrise ${daily.sunrise?.[0]?.slice(11,16)}, sunset ${daily.sunset?.[0]?.slice(11,16)}.
- Tomorrow: high ${daily.temperature_2m_max?.[1]}${tu} / low ${daily.temperature_2m_min?.[1]}${tu}, max UV ${daily.uv_index_max?.[1]}, total precip ${daily.precipitation_sum?.[1]} mm, sunrise ${daily.sunrise?.[1]?.slice(11,16)}, sunset ${daily.sunset?.[1]?.slice(11,16)}.
- Next 24h hourly: ${JSON.stringify(hours)}

When the user asks about the best time to run, USE THIS DATA. Recommend a specific clock time window based on a balance of: cooler apparent temperature, low precipitation probability, lower UV (prefer <6 for long sessions), manageable wind/gusts, and daylight (between sunrise and sunset unless they prefer night). Mention the key trade-offs briefly (heat, rain, UV, wind). Convert temperatures to the user's preferred unit.`;
              chatExtraContext += weatherBlock;
            } else {
              chatExtraContext += `\n\nWEATHER: lookup failed (status ${wRes.status}). Tell the user weather data was unavailable.`;
            }
          } else {
            chatExtraContext += `\n\nWEATHER: no location available. If the user asks about weather or best time to run, ask them to allow location access in their browser (the chatbot requests it on open) or to share their city.`;
          }
        } catch (e) {
          console.error("weather fetch error:", e);
          chatExtraContext += `\n\nWEATHER: lookup error. Tell the user weather data was temporarily unavailable.`;
        }

        // ── Race Time Predictor — only when the latest user message asks for a prediction ──
        try {
          if (RACE_PREDICTION_INTENT.test(String(chatMessages || ""))) {
            const { data: activePlanForPred } = await supabase
              .from("training_plans")
              .select("content, start_date, race_date, race_distance, goal_time, training_days")
              .eq("user_id", user.id).eq("archived", false)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();

            const raceDist = activePlanForPred?.race_distance || "10K";
            const { data: cached } = await supabase
              .from("race_time_predictions")
              .select("*").eq("user_id", user.id).eq("race_distance", raceDist).maybeSingle();

            const { data: newestActivity } = await supabase
              .from("activities").select("created_at")
              .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();

            let predictionBlock: string | null = null;
            const cacheAgeDays = cached
              ? (Date.now() - new Date(cached.computed_at).getTime()) / 86400000 : Infinity;
            const cacheStillValid = cached && cacheAgeDays < 7 &&
              (!newestActivity || new Date(newestActivity.created_at) <= new Date(cached.computed_at));

            if (cacheStillValid && cached.prediction?.block) {
              predictionBlock = cached.prediction.block;
            } else {
              const result = buildPrediction({
                activities: activities || [],
                metrics: metrics || [],
                plan: activePlanForPred,
                readinessScores: (readinessRes.data || []).map((r: any) => Number(r.score)).filter((n: number) => isFinite(n)).slice(0, 7),
                athleteContext: profile?.athlete_context || "",
              });
              predictionBlock = result.block;
              await supabase.from("race_time_predictions").upsert({
                user_id: user.id, race_distance: raceDist,
                prediction: result, computed_at: new Date().toISOString(),
              }, { onConflict: "user_id,race_distance" });
            }
            if (predictionBlock) chatExtraContext += `\n\n${predictionBlock}`;
          }
        } catch (e) {
          console.error("race time predictor error:", e);
        }
      } catch (e) {
        console.error("chat extra context fetch error:", e);
      }

      systemPrompt = `You are an elite RUNNING coach AI assistant. This is a running-only application.

You have access to the athlete's complete training data. Use it to give personalized, data-driven answers.

🚫 ABSOLUTE BANS — NEVER suggest, recommend, or even mention any of the following as alternatives, substitutes, or cross-training:
- Swimming
- Cycling / biking / spin
- Rowing
- Elliptical
- Yoga, pilates, or any non-running aerobic activity
If joint load is a concern, the only permitted adjustments are: reduce intensity, reduce volume/duration, swap to easy run, swap to walk/run intervals, swap to walk-only recovery, add a rest day, change cadence, or change surface (road/trail/treadmill). NEVER recommend a non-running aerobic substitute under ANY circumstance, even for injury, illness, or recovery. NEVER insert mobility, stretching, static stretching, foam rolling, or yoga rows into a workout's segment table — workouts contain only warm-up, running/walking blocks, and cool-down.

BREVITY RULES (strict):
- Maximum 3-5 bullet points per answer
- NO long paragraphs — bullet points only
- Lead with the answer, then supporting data
- Total response UNDER 150 words
- Only use headers if the user asks a complex multi-part question
- Reference specific data points (dates, paces, HR, sleep scores) but keep each bullet to one line
- Be practical and actionable — no filler or preamble

PLAN LOOKUP (MANDATORY BEFORE ANY DATE-BASED ADVICE):
- The AUTHORITATIVE PLAN DIARY LOOKUP is precomputed from exact dated plan headings. Use it first for today/tomorrow. It overrides all previous assistant messages, conversation history, weekday assumptions, and training_days metadata.
- BEFORE you suggest changing, replacing, or commenting on a session for ANY specific date (today, tomorrow, "Wednesday", "13/05", etc.), you MUST first locate that EXACT DD/MM/YYYY date as a heading in the PLAN CONTENT block above.
- DATE ≠ WEEKDAY. Do not assume "tomorrow is Wednesday so it must have a workout" or "the next Wednesday session = tomorrow's session". The plan only contains sessions on the specific dates printed in its headings (e.g. "### **Wednesday 14/05/2026**"). If tomorrow's date is not printed as a heading, there is NO session tomorrow — say so.
- Quote the planned workout for that exact date verbatim (or explicitly say "you have no session scheduled on DD/MM/YYYY — it's a rest day") before proposing any change.
- NEVER invent, infer, or borrow a workout from a different date. NEVER call a session "high-impact", "long run", "intervals", etc. unless the plan content for that exact date says so.
- NEVER attach a workout from one date (e.g. 14/05) to a different date (e.g. 13/05) just because they share a weekday name or are nearby.
- If the user has rearranged sessions, the plan content reflects that — trust the plan content over weekday assumptions.
- If the date you're advising on is a rest day, do NOT suggest "replacing" it with something lighter — there's nothing to replace. Acknowledge it's already a rest day.
- If you can't find a workout for the requested date in the plan content, say "You don't have a workout scheduled on DD/MM/YYYY" — do NOT guess or substitute another day's session and DO NOT emit an action marker for that date.

SESSION VALUE FIDELITY (MANDATORY — applies whenever you describe a specific session):
- STEP-LEVEL DETAIL FIRST: Before answering, parse the session's segment table row-by-row. Describe the actual intervals, paces, and durations from those individual rows — never summarise a session from the title or heading alone when the segment table is present. The title is a shorthand; the rows are authoritative for what the athlete actually does.
- EXPAND REP COUNTS: When a row says "4 x 3 min" or "8 × 1 min", describe the rep count, each rep's duration, the pace/effort column, and the recovery row that follows it. Distinguish between work reps and recovery reps as the table presents them.
- DURATION: Use the duration printed in that session's heading or its session-total line VERBATIM. NEVER recompute duration by summing the time or distance of individual segment rows in the workout table — segment sums almost always disagree with the stated total, and the stated total is the source of truth.
- PACE TARGETS: Only quote pace values that are printed in that session's own segment table. If a segment has no pace column or no pace value, describe effort using the HR zone, RPE, or notes column from that same row instead. NEVER invent, estimate, average, or extrapolate a pace figure that is not written in that session's table.
- NO CONTRADICTIONS: Never state a duration, distance, pace, or HR zone for a session that disagrees with the plan markdown for that exact date. If the title and the segment rows disagree, trust the rows for the workout structure and quote the heading total only for the overall duration. Flag the discrepancy to the user.
- MISSING VALUES: If the plan markdown does not specify a duration or pace for the session, say "the plan doesn't specify a [duration/pace] for this session" — do NOT fill the gap with a guess.

RECOMMENDATION ACTIONS:
- WHENEVER your reply suggests changing, scaling, swapping, postponing, or modifying any workout in the plan, you MUST end the message with one of these markers on its own line:
  • [[ACTION:day:DD/MM/YYYY]]   ← use this when the change affects ONE specific day only (e.g. "today's session", "Wednesday 17 June", a single workout the user just asked about). Replace DD/MM/YYYY with that exact date in UK format.
  • [[ACTION:plan]]              ← use this ONLY when the change requires rewriting multiple weeks/sessions of the plan (e.g. "reduce overall volume across the next 4 weeks").
- Default to [[ACTION:day:...]] whenever possible. Only use [[ACTION:plan]] when a single-day edit cannot capture the change.
- Do NOT include any marker for general advice, education, or questions that don't change the plan.
- CRITICAL: Only emit a marker if you are PROPOSING A CONCRETE EDIT to a workout using explicit edit wording such as "swap", "replace", "cut", "reduce", "shorten", "postpone", "move", "skip", "add", or "change".
- If your reply only ANALYSES, REASSURES, or CONCLUDES the workout was fine/appropriate/well-managed/no change needed, DO NOT emit any marker — even if you give advice such as softer surfaces, cadence cues, recovery, fuelling, hydration, or monitoring symptoms.
- For questions like "Is it too intense?", "Was that okay?", "How did my workout go?", or any post-hoc review of a completed workout, NEVER emit an action marker unless you explicitly tell the user a future planned workout should be changed.
- Examples that must NOT have a marker: "The intensity was appropriate", "This looks well-managed", "You're on track", "No change needed", "continue prioritising soft surfaces", "monitor your knee", "keep cadence light".
- Never wrap the marker in code fences. Always plain text on the last line.

CONVERSATION CONTEXT (CRITICAL):
- The earlier messages in this conversation are real prior turns. Use them.
- 🚨 LATEST-MESSAGE DATE WINS: If the user's MOST RECENT message contains an explicit DD/MM/YYYY (or DD/MM) date, that date is the ONLY date this reply may act on. Ignore any dates from earlier turns. Do NOT substitute, "correct", or roll the date back to one previously discussed. Quote that exact date back to the user in the first line of your reply, and use it verbatim in any [[ACTION:day:DD/MM/YYYY]] marker.
- Before writing your reply, extract every DD/MM/YYYY from the CURRENT user message. If there is one, your reply MUST be about that date and no other. If that date is not in the plan, say "you have no workout scheduled on DD/MM/YYYY" — do NOT silently pick a nearby date or a date from earlier in the conversation.
- If the user gives a follow-up like "add another rep", "remove a rep", "make it shorter", "swap it for an easy run", or any modification WITHOUT naming a date, it refers to the SAME workout that was last discussed in this conversation (the most recent [[ACTION:day:DD/MM/YYYY]] you produced, or the workout date the user explicitly named most recently).
- In that case, reuse that exact same DD/MM/YYYY in your [[ACTION:day:...]] marker. Do NOT pick a different date and do NOT say "couldn't find a workout" — just apply the change to the remembered session.
- Only switch to a different date if the user explicitly names a new date or session.

${(() => {
  const today = new Date();
  const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  const todayName = dayNames[today.getDay()];
  const lines = dayNames.map((name, idx) => {
    const diff = (idx - today.getDay() + 7) % 7 || 7; // next occurrence (not today)
    const next = new Date(today); next.setDate(today.getDate() + diff);
    return `  - Next ${name}: ${fmt(next)}`;
  });
  return `DAY-NAME RESOLUTION (CRITICAL):
- Today is ${todayName}, ${fmt(today)}.
- When the user names a weekday WITHOUT a date (e.g. "my workout on Friday", "what's Wednesday?", "Sunday's run"), use the NEXT upcoming occurrence below — NOT a past one:
${lines.join("\n")}
- If today matches the named weekday AND the user is clearly asking about today, use today's date instead.
- Only treat a weekday as past if the user explicitly says "last <day>", "this past <day>", or names a date that has already happened.
- Use the resolved DD/MM/YYYY in any [[ACTION:day:...]] marker and when looking up the workout in the plan content above.`;
})()}

${athleteContext}

${dataContext}
${chatPlanContext}
${chatExtraContext}`;

      // Resolve bare weekday names in the user's message to explicit dates so
      // the model can't hallucinate (e.g. "Friday" said on Saturday 09/05/2026
      // must mean 15/05/2026, not 10/05/2026 which is Sunday).
      const resolveWeekdays = (text: string): string => {
        if (!text) return text;
        const today = new Date();
        const dayNames = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
        const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
        return text.replace(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, (match) => {
          const idx = dayNames.indexOf(match.toLowerCase());
          if (idx < 0) return match;
          const diff = (idx - today.getDay() + 7) % 7 || 7;
          const next = new Date(today); next.setDate(today.getDate() + diff);
          return `${match} (${fmt(next)})`;
        });
      };
      // Extract explicit DD/MM/YYYY dates from the CURRENT user message so the
      // model can't silently swap to a date discussed in a previous turn.
      const explicitDates = Array.from(
        (chatMessages || "").matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g),
      ).map((m) => `${m[1].padStart(2, "0")}/${m[2].padStart(2, "0")}/${m[3]}`);
      const uniqueDates = Array.from(new Set(explicitDates));
      const datePin = uniqueDates.length
        ? `\n\n🚨 DATES EXPLICITLY NAMED IN THIS USER MESSAGE: ${uniqueDates.join(", ")}. Your reply MUST act on ${uniqueDates.length === 1 ? "this exact date" : "these exact dates"} and no other. Do NOT substitute a date from earlier in the conversation. Quote the date back in your first sentence.\n`
        : "";
      userPrompt = immediateDiaryCorrection + datePin + resolveWeekdays(chatMessages || "Hello, I'd like some coaching advice.");
    } else if (type === "analysis") {
      systemPrompt = `You are an elite endurance coach AI, modeled after the garmin-ai-coach system. You perform multi-domain training analysis.

Your analysis must cover these domains in separate sections:

## 📊 KPI Dashboard Summary
Summarize: training load trends (chronic vs acute), training frequency, volume trends, intensity distribution. Calculate approximate ACWR (Acute:Chronic Workload Ratio) if enough data exists.

## 🏃 Execution Analysis  
Analyze: pace/speed progression, heart rate efficiency (aerobic decoupling indicators), power trends if available, cadence patterns. Provide evidence-based progression tracking.

## 🫀 Physiology & Readiness
Analyze: heart rate trends (resting HR proxy from avg HR patterns), recovery patterns (days between hard sessions), any crash signatures (sudden drops in performance/consistency), fatigue indicators.

## 😴 Sleep & Recovery
Analyze sleep data if available:
- Sleep score trends (recent nights, 7-day average)
- Deep sleep and REM percentages vs recommended ranges (15-20% deep, 20-25% REM)
- Sleep efficiency trends
- Correlation between poor sleep nights and next-day training performance
- Recovery readiness based on sleep quality patterns
Reference National Sleep Foundation guidelines where relevant.

When the ADVANCED SLEEP HEALTH block is present, ALSO analyse:
- **Respiratory health**: SpO₂ avg + lowest, respiration rate, breathing pattern. Flag SpO₂ avg <92% OR lowest <88% with "⚠️ Low blood oxygen — consider sleep apnea screening". Breathing pattern "Many" = "Sleep disruption from breathing abnormalities".
- **Restlessness**: >80 = "High sleep fragmentation — recovery compromised"; <40 with balanced breathing AND SpO₂ ≥95 = "Excellent respiratory recovery".
- **Skin temperature**: |deviation| >1.5°C suggests illness/stress onset; correlate with readiness drops and poor next-day sessions ("early illness warning").
- **HRV 7d trend**: "unbalanced" + high restlessness = declining recovery trajectory; rest is priority.
- **Body battery change**: persistent negative deltas = chronic drain.
- Cross-reference with performance: e.g. skin-temp spike the day before a poor session explains the drop.
- Feed concrete findings into ## 💡 Actionable Recommendations (medical screening for persistent low SpO₂, delay hard sessions while skin temp >±1°C, etc.).


## 💡 Actionable Recommendations
- One bullet per action, no elaboration unless critical
- Group: Load Management | Sport-Specific | Recovery & Sleep | Performance
- Max 3-5 bullets total across all categories

BREVITY RULES (strict):
- Each section above: 3-5 bullet points MAX, no prose paragraphs
- Data points and recommendations only — no filler
- Total analysis should be roughly half the length you'd normally write
- Use specific numbers but keep each bullet to one line`;

      userPrompt = `${athleteContext}

${dataContext}

Analyze this training data and provide a comprehensive multi-domain analysis report. Be specific, reference actual data points, and provide actionable coaching insights.`;
    } else if (type === "plan-review") {
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";

      systemPrompt = `You are an elite endurance coach AI reviewing an athlete's progress against their training plan for a ${raceLabel} race.

You have been given:
1. The athlete's CURRENT TRAINING PLAN (what they were supposed to do)
2. Their ACTUAL ACTIVITY DATA (what they actually did)

Your job is to compare planned vs actual and provide a progress review. Be specific and reference actual dates and numbers.

IMPORTANT: Do NOT generate a revised plan. Only analyse and recommend. The athlete will decide whether to apply changes.

Your response MUST include these sections:

## 📊 Progress Summary
- How many planned sessions were completed vs missed
- Overall adherence percentage
- Volume comparison (planned vs actual km/time)

## ✅ What Went Well
- Sessions that were completed on target or exceeded expectations
- Positive trends in pace, HR efficiency, or consistency

## ⚠️ What Needs Attention
- Missed sessions and their impact
- Sessions done but significantly off target (pace, HR, duration)
- Any concerning patterns (overtraining, undertraining, intensity creep)

## 🔄 Recommended Adjustments
Based on the progress review, clearly state one of these verdicts:
- **ON TRACK**: The plan is working well. No changes needed — continue as written.
- **MAKE EASIER**: The athlete is struggling. Explain specifically what should be scaled back (reduced volume, lower intensity, more recovery days) and why.
- **MAKE HARDER**: The athlete is ahead of schedule. Explain what should be progressed (increased volume, higher intensity, additional quality sessions) and why.

Be specific about WHAT would change and WHY, but do NOT output the revised plan yet.

## 💡 Coach's Notes
2-3 sentences max. Personal advice or technique cues only.

BREVITY RULES (strict):
- Progress Summary: 3-4 bullets max with numbers
- What Went Well / Needs Attention: 2-3 bullets each, one line per bullet
- Recommended Adjustments: state verdict + 2-3 bullet reasons
- No prose paragraphs anywhere — bullets and short sentences only`;

      userPrompt = `${athleteContext}

${dataContext}

CURRENT TRAINING PLAN:
${current_plan || "No plan provided"}

Review this athlete's progress against their training plan. Compare what was planned vs what was actually done. Determine if the plan needs adjusting but do NOT generate a revised plan. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else if (isPlanAdjust) {
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";

      const adjustmentDirection = (adjustment as string) || "apply";
      let adjustInstruction = "";
      if (adjustmentDirection === "easier") {
        adjustInstruction = "The athlete has requested the plan be made EASIER. Reduce volume, lower intensity, add more recovery days, and scale back ambitious targets. Be conservative.";
      } else if (adjustmentDirection === "harder") {
        adjustInstruction = "The athlete has requested the plan be made HARDER. Increase volume, raise intensity, add quality sessions, and push targets up. The athlete is ready for more.";
      } else {
        adjustInstruction = "Apply the recommended adjustments from the review as-is.";
      }

      const preservePast = preserve_past === true;
      const effectiveAdjustStartISO = preservePast && plan_start_from_date
        ? String(plan_start_from_date)
        : (start_date || new Date().toISOString().split("T")[0]);
      const planStartUK = (() => {
        const [y, m, d] = effectiveAdjustStartISO.split("-");
        return y && m && d ? `${d}/${m}/${y}` : "";
      })();
      const raceDayName = race_date && race_date !== "ai-recommend"
        ? new Date(String(race_date) + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" })
        : null;
      const raceDateUKLong = race_date && race_date !== "ai-recommend"
        ? new Date(String(race_date) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : null;
      const planAdjustRaceLine = raceDayName && raceDateUKLong
        ? `RACE DAY ${raceDayName} ${raceDateUKLong}, goal ${raceLabel}${goal_time ? ` in ${goal_time}` : ""}.`
        : "";

      const scopeBlock = preservePast
        ? `SCOPE — FUTURE WORKOUTS ONLY:
- You have been given ONLY the workouts dated ${planStartUK || "today"} onward.
- Generate ONLY workouts dated ${planStartUK || "today"} or later.
- DO NOT output any workouts dated before ${planStartUK || "today"} — past workouts are preserved verbatim from the original plan and will be prepended automatically.
- DO NOT repeat the Season Strategy Overview — it is already preserved.
- Start your response directly with the first weekly heading covering ${planStartUK || "today"}.`
        : `Generate a COMPLETE REVISED training plan for the remaining weeks.`;

      systemPrompt = `You are an elite endurance coach AI adjusting a ${raceLabel} training plan based on a progress review.

${adjustInstruction}

You have been given:
1. The ${preservePast ? "REMAINING TRAINING PLAN (today onward)" : "ORIGINAL TRAINING PLAN"}
2. The PROGRESS REVIEW with analysis
3. The athlete's ACTIVITY DATA

${scopeBlock}

${race_date && race_date !== "ai-recommend" ? `RACE DATE IS MANDATORY:
- Generate continuously from ${effectiveAdjustStartISO} through ${race_date} inclusive.
- ${planAdjustRaceLine}
- The FINAL entry MUST be the race itself on ${race_date} (${raceDayName}, ${raceDateUKLong}), labelled "🏁 RACE DAY — ${raceLabel}".
- Do NOT stop at a week boundary, do NOT stop after a fixed number of sessions, and do NOT omit the final race day.` : ""}

CRITICAL FORMAT RULES: 
1. EVERY workout MUST have a full markdown table with Segment/Duration/Target/Notes columns (NO HR Zone column).
2. Use UK date format (DD/MM/YYYY) for all dates.
3. Only schedule workouts on: ${daysStr}.
4. EVERY workout title MUST include the total duration as "(Total: Xmin)".
5. For interval segments, ALWAYS express durations in MINUTES (e.g., "4 x 3 min", "6 x 2 min") — NEVER use zone labels as the duration.
6. When a segment has a specific distance target (e.g., long run of 10km, intervals of 800m), include BOTH the distance AND the estimated duration in the Duration column (e.g., "10km (~55 min)" or "4 x 800m (~3.5 min each)").
7. EVERY running segment MUST include a music BPM target in the Notes column (🎵 150-175 BPM range based on intensity).
${preservePast ? "" : "8. Include the Season Strategy Overview section before the weekly plan.\n"}${preservePast ? "8" : "9"}. Start from the next upcoming week based on today's date.`;

      userPrompt = `${athleteContext}

${dataContext}

${preservePast ? "REMAINING TRAINING PLAN (today onward — past workouts are NOT shown and must NOT be regenerated):" : "ORIGINAL TRAINING PLAN:"}
${current_plan || "No plan provided"}

PROGRESS REVIEW:
${review_text || "No review provided"}

Generate the ${preservePast ? "revised future-only portion of the" : "complete revised"} ${raceLabel} training plan based on the review and the ${adjustmentDirection} adjustment requested. ${race_date && race_date !== "ai-recommend" ? `It must run through to ${race_date} and end with ${planAdjustRaceLine}` : ""} Today's date is ${new Date().toISOString().split("T")[0]}.`;

    } else if (type === "training-plan") {
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";
      const planStart = start_date || new Date().toISOString().split("T")[0];
      // Convert to UK format for display
      const [y, m, d] = planStart.split("-");
      const planStartUK = `${d}/${m}/${y}`;
      let raceDateInstruction: string;
      if (race_date === "ai-recommend") {
        raceDateInstruction = `The athlete has NOT set a race date. You MUST:
1. Thoroughly analyze ALL their activity history, health metrics, average paces, cadence, heart rate patterns, training consistency, longest runs, and overall fitness level.
2. Determine how many weeks of training they realistically need before they can race a ${raceLabel} at their best — this could be anywhere from 4 to 24+ weeks depending on their current fitness.
3. Recommend a specific race date based on your analysis and explain your reasoning clearly.
4. Generate the COMPLETE training plan from the start date to the race date — NOT just 4 weeks. Every single week must be detailed with daily workouts.`;
      } else if (race_date) {
        const [ry, rm, rd] = (race_date as string).split("-");
        const raceDateUK = `${rd}/${rm}/${ry}`;
        raceDateInstruction = `The athlete's target race date is ${raceDateUK}. Plan the training to peak for this date, including appropriate taper.`;
      } else {
        raceDateInstruction = `No race date specified. Suggest a realistic timeline.`;
      }

      // ===== Compute athlete physiological summary for prompt placeholders =====
      const recentMetrics = (metrics || []).slice(0, 7);
      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const restingHrVals = recentMetrics.map((m: any) => m.resting_heart_rate).filter((v: any) => v != null);
      const hrvVals = recentMetrics.map((m: any) => m.hrv).filter((v: any) => v != null);
      const sleepVals = recentMetrics.map((m: any) => m.sleep_duration_seconds).filter((v: any) => v != null);
      const restingHr = restingHrVals.length ? Math.round(avg(restingHrVals)!) : null;
      const hrv = hrvVals.length ? Math.round(avg(hrvVals)!) : null;
      const avgSleepH = sleepVals.length ? (avg(sleepVals)! / 3600).toFixed(1) : null;

      // HRV trend: compare last 3 days vs previous 7
      let hrvTrend = "stable";
      const recent3 = hrvVals.slice(0, 3);
      const prior7 = hrvVals.slice(3, 10);
      if (recent3.length >= 2 && prior7.length >= 3) {
        const r = avg(recent3)!;
        const p = avg(prior7)!;
        const diff = ((r - p) / p) * 100;
        if (diff < -10) hrvTrend = "declining (>10% drop)";
        else if (diff > 5) hrvTrend = "improving";
      }

      // HR zones from estimated max HR (220 - age fallback) or from activity max
      const ageMax = profile?.date_of_birth
        ? 220 - (new Date().getFullYear() - new Date(profile.date_of_birth).getFullYear())
        : null;
      const observedMax = Math.max(...(activities || []).map((a: any) => a.max_heart_rate || 0));
      const maxHr = ageMax || (observedMax > 0 ? observedMax : 190);
      const z1Max = Math.round(maxHr * 0.65);
      const z2Range = `${Math.round(maxHr * 0.65)}-${Math.round(maxHr * 0.75)}`;
      const z3Range = `${Math.round(maxHr * 0.75)}-${Math.round(maxHr * 0.85)}`;
      const z4Range = `${Math.round(maxHr * 0.85)}-${Math.round(maxHr * 0.92)}`;
      const z5Min = Math.round(maxHr * 0.92);

      // Recent run stats
      const runs = (activities || []).filter((a: any) => /run/i.test(a.activity_type || ""));
      const longestRun = runs.length ? Math.max(...runs.map((a: any) => (a.distance_meters || 0) / 1000)).toFixed(1) : "N/A";
      // ===== Pace anchors derived from THIS user's actual runs =====
      const fmtPace = (secPerKm: number): string => {
        const m = Math.floor(secPerKm / 60);
        const s = Math.round(secPerKm % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
      };
      // NOTE: activities.avg_speed is stored in km/h (not m/s). 60 / kmh = min/km.
      const paceFromMps = (kmh: number) => (60 / kmh) * 60; // returns seconds per km
      // Z2 (HR-filtered) pace if we have it
      const z2Runs = runs.filter((a: any) => a.avg_heart_rate && a.avg_heart_rate >= maxHr * 0.65 && a.avg_heart_rate <= maxHr * 0.75 && a.avg_speed);
      const z2PaceMps = z2Runs.length ? avg(z2Runs.map((a: any) => Number(a.avg_speed))) : null;
      // Average pace across ALL runs with speed (fallback when HR data is sparse)
      const allPacedRuns = runs.filter((a: any) => a.avg_speed && Number(a.avg_speed) > 0);
      const avgRunMps = allPacedRuns.length ? avg(allPacedRuns.map((a: any) => Number(a.avg_speed))) : null;
      // Slowest 25% (a proxy for true easy pace) across all runs
      const sortedSlow = [...allPacedRuns].sort((a: any, b: any) => Number(a.avg_speed) - Number(b.avg_speed));
      const slowSlice = sortedSlow.slice(0, Math.max(1, Math.floor(sortedSlow.length / 4)));
      const easyMps = slowSlice.length ? avg(slowSlice.map((a: any) => Number(a.avg_speed))) : null;

      // Map experience level to a safe default easy pace when we have ZERO run data.
      const expLevelLower = (profile?.experience_level || "intermediate").toLowerCase();
      const fallbackByLevel = (lvl: string): { easy: string; label: string } => {
        if (/begin|novice|new/.test(lvl)) return { easy: "7:30", label: "Beginner default (no run history)" };
        if (/elite|advanced|expert/.test(lvl)) return { easy: "5:00", label: "Elite default (no run history)" };
        return { easy: "6:30", label: "Intermediate default (no run history)" };
      };

      // User-supplied pace range takes priority over everything else.
      const userPaceMin = typeof current_pace_min === "string" && /^\d{1,2}:\d{2}$/.test(current_pace_min.trim()) ? current_pace_min.trim() : null;
      const userPaceMax = typeof current_pace_max === "string" && /^\d{1,2}:\d{2}$/.test(current_pace_max.trim()) ? current_pace_max.trim() : null;
      const userPaceRange = userPaceMin && userPaceMax ? `${userPaceMin}-${userPaceMax}` : (userPaceMin || userPaceMax);

      // Choose the authoritative easy/Z2 pace: user-supplied → HR-filtered Z2 → slowest-25% → overall avg → experience fallback.
      let z2Pace: string;
      let z2PaceSource: string;
      if (userPaceRange) {
        z2Pace = userPaceRange + (userPaceMin && userPaceMax ? "" : "");
        z2PaceSource = `user-supplied current easy pace (HARD ANCHOR — use this exact range for week 1, then progress gradually toward goal pace)`;
      } else if (z2PaceMps) {
        z2Pace = fmtPace(paceFromMps(z2PaceMps));
        z2PaceSource = `derived from ${z2Runs.length} HR-Z2 runs`;
      } else if (easyMps) {
        z2Pace = fmtPace(paceFromMps(easyMps));
        z2PaceSource = `slowest-25% of ${allPacedRuns.length} recent runs (HR data sparse, used as easy-pace proxy)`;
      } else if (avgRunMps) {
        z2Pace = fmtPace(paceFromMps(avgRunMps) + 30);
        z2PaceSource = `avg of ${allPacedRuns.length} runs + 30s/km cushion`;
      } else {
        const fb = fallbackByLevel(expLevelLower);
        z2Pace = fb.easy;
        z2PaceSource = fb.label;
      }
      // When user supplies their current pace, ignore the historical average so the AI is not tempted to use it.
      const avgRunPace = userPaceRange
        ? `IGNORED — user supplied current easy pace (${userPaceRange}/km); use that instead`
        : (avgRunMps ? fmtPace(paceFromMps(avgRunMps)) : "N/A");
      const userAnchorBlock = userPaceRange
        ? `\n🚨 USER-SUPPLIED PACE OVERRIDE 🚨\nThe athlete has explicitly told us their current easy run pace is ${userPaceRange}/km.\nWeek 1 EVERY easy/Z2/recovery/long run MUST be prescribed at ${userPaceRange}/km — no faster, no slower.\nDo NOT fall back to historical averages, textbook paces, or goal-derived paces for week 1.\nProgress this anchor by no more than ~5-10 seconds/km per week toward the goal pace as fitness builds.\n`
        : "";

      // ACWR (acute:chronic workload ratio) from training load
      const today = new Date();
      const acuteLoad = runs.filter((a: any) => {
        const d = new Date(a.start_time);
        return (today.getTime() - d.getTime()) / 86400000 <= 7;
      }).reduce((s: number, a: any) => s + (a.duration_seconds || 0) / 60, 0);
      const chronicLoad = runs.filter((a: any) => {
        const d = new Date(a.start_time);
        return (today.getTime() - d.getTime()) / 86400000 <= 28;
      }).reduce((s: number, a: any) => s + (a.duration_seconds || 0) / 60, 0) / 4;
      const acwr = chronicLoad > 0 ? (acuteLoad / chronicLoad).toFixed(2) : "N/A";

      // Weeks calculation
      let weeks = "TBD (ai-recommend)";
      let baseWeeks = "?", buildWeeks = "?", sharpenWeeks = "?", taperWeeks = "2";
      if (race_date && race_date !== "ai-recommend") {
        const start = new Date(planStart);
        const race = new Date(race_date);
        const w = Math.max(1, Math.round((race.getTime() - start.getTime()) / (7 * 86400000)));
        weeks = String(w);
        taperWeeks = String(Math.min(2, Math.max(1, Math.round(w * 0.15))));
        sharpenWeeks = String(Math.max(1, Math.round(w * 0.20)));
        buildWeeks = String(Math.max(1, Math.round(w * 0.30)));
        baseWeeks = String(w - Number(taperWeeks) - Number(sharpenWeeks) - Number(buildWeeks));
      }

      // Day name of the start date so we can force the first workout to land on it
      const startDayName = new Date(planStart + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" });
      const startDayShort = startDayName.slice(0, 3);
      const trainingDaysList = (training_days as string[] | undefined) || [];
      const includesStartDay = trainingDaysList.some((d) => d.toLowerCase().startsWith(startDayShort.toLowerCase()));
      const firstWorkoutRule = includesStartDay
        ? `The first workout MUST be on ${planStart} (${startDayName}).`
        : `IMPORTANT: The first workout MUST be on ${planStart} (${startDayName}) — even though ${startDayName} is NOT in the regular training days list. Treat the start date as a one-off extra session. From the day AFTER ${planStart} onwards, only schedule workouts on: ${daysStr}.`;

      const raceDateUKFmt = race_date && race_date !== "ai-recommend"
        ? (() => { const [ry, rm, rd] = (race_date as string).split("-"); return `${rd}/${rm}/${ry}`; })()
        : null;
      const raceDayName = race_date && race_date !== "ai-recommend"
        ? new Date(race_date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" })
        : null;
      const raceDateUKLong = race_date && race_date !== "ai-recommend"
        ? new Date(race_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        : null;
      // Compute goal race pace string (e.g. "6:00/km") for the explicit RACE DAY line.
      const racePaceStr = (() => {
        if (!goal_time) return null;
        const parts = String(goal_time).trim().split(":").map((x: string) => parseInt(x, 10));
        let totalSec = 0;
        if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) totalSec = parts[0] * 60 + parts[1];
        const distKm = ({ "5k": 5, "10k": 10, "half-marathon": 21.0975, "marathon": 42.195 } as Record<string, number>)[race_distance as string] || 0;
        if (!totalSec || !distKm) return null;
        const paceSec = Math.round(totalSec / distKm);
        return `${Math.floor(paceSec / 60)}:${(paceSec % 60).toString().padStart(2, "0")}/km`;
      })();
      const explicitRaceDayLine = (raceDayName && raceDateUKLong)
        ? `RACE DAY ${raceDayName} ${raceDateUKLong}, goal ${raceLabel}${goal_time ? ` in ${goal_time}` : ""}${racePaceStr ? ` at ${racePaceStr}` : ""}.`
        : "";

      // Build the EXACT list of required workout dates so the model cannot stop early
      // or round to a week boundary. Includes every training-day-of-week between
      // start and race, the start date itself, and the race date itself.
      const dayShortToFull: Record<string, string> = {
        mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
        fri: "Friday", sat: "Saturday", sun: "Sunday",
      };
      const trainingDayNames = (training_days as string[] | undefined || []).map((d) => {
        const k = d.slice(0, 3).toLowerCase();
        return dayShortToFull[k] || d;
      });
      const requiredDates: string[] = [];
      if (race_date && race_date !== "ai-recommend") {
        const start = new Date(planStart + "T00:00:00");
        const end = new Date(race_date + "T00:00:00");
        for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
          const iso = d.toISOString().slice(0, 10);
          const dayName = d.toLocaleDateString("en-GB", { weekday: "long" });
          const isStart = iso === planStart;
          const isRace = iso === race_date;
          const isTrainingDay = trainingDayNames.includes(dayName);
          if (isStart || isRace || isTrainingDay) {
            const tag = isRace ? " ← 🏁 RACE DAY" : isStart ? " ← FIRST WORKOUT" : "";
            requiredDates.push(`- ${iso} (${dayName})${tag}`);
          }
        }
      }
      const requiredDatesBlock = requiredDates.length
        ? `\n\n══ MANDATORY WORKOUT DATES — EVERY ONE OF THESE MUST APPEAR IN THE PLAN ══\n${requiredDates.join("\n")}\n\nThe plan is INCOMPLETE and INVALID if any of the dates above is missing. Do not stop until you have written a workout entry for every single date in this list. The very last entry in the plan MUST be ${race_date} (race day).`
        : "";

      const planLengthInstruction = isAIDecide
        ? `Generate the FULL training plan from start date to race date. Every week must have detailed daily workouts. Do NOT limit to 4 weeks — output the complete plan for however many weeks are needed. ${firstWorkoutRule}`
        : `${explicitRaceDayLine}

Generate the COMPLETE plan starting from ${planStart} and ending on ${race_date} (${raceDayName}, ${raceDateUKLong}).
${firstWorkoutRule}
After the start date, only schedule workouts on: ${daysStr}. All other days are rest/recovery.

⚠️ CRITICAL — RACE DAY IS MANDATORY:
${explicitRaceDayLine}
The FINAL entry in the plan MUST be the race itself on ${race_date} (${raceDayName}, ${raceDateUKLong}). Label it "🏁 RACE DAY — ${raceLabel}".
RACE DAY IS THE RACE ONLY — it is a single continuous effort over the full race distance (${raceLabel}) at goal pace${goal_time ? ` to hit ${goal_time}` : ""}. Do NOT prescribe walk/run intervals, do NOT split it into sets, do NOT add training intervals on race day. A short pre-race routine (light jog warm-up + strides + fuelling/pacing notes) may be described in the notes column, but the workout itself must be ONE entry: the race. Do NOT stop the plan before this date. The final week must extend all the way through to ${race_date} inclusive — do NOT round down to a clean week boundary. There is NO session-count cap and NO week-count cap — keep emitting weeks until you have written the race day entry. If you feel the response is getting long, KEEP GOING anyway — truncation is a failure.${requiredDatesBlock}`;

      const ageYears = profile?.date_of_birth
        ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000))
        : null;

      // ===== Detect beginner / injury / returning runner =====
      const expLevel = (profile?.experience_level || "intermediate").toLowerCase();
      const ctxText = `${profile?.athlete_context || ""} ${profile?.training_goals || ""}`.toLowerCase();
      const isBeginner = expLevel === "beginner" || /beginner|novice|new\s+to\s+run|just\s+start|first[- ]time/.test(ctxText);
      const hasInjury = /injur|niggle|pain|surgery|physio|rehab|tendon|fracture|strain|sprain/i.test(ctxText);
      const mostRecentRunMs = runs.length
        ? Math.max(...runs.map((a: any) => new Date(a.start_time).getTime()))
        : 0;
      const daysSinceLastRun = mostRecentRunMs ? Math.floor((Date.now() - mostRecentRunMs) / 86400000) : 999;
      const isReturning = /return|coming\s+back|comeback|time\s+off|break\s+from\s+run/i.test(ctxText) || daysSinceLastRun > 56;
      const needsWalkRunRamp = isBeginner || hasInjury || isReturning;

      const walkRunFlags = [
        isBeginner ? "Beginner" : null,
        hasInjury ? "Injured/Recovering" : null,
        isReturning ? `Returning (${daysSinceLastRun >= 999 ? "no recent runs" : daysSinceLastRun + "d since last run"})` : null,
      ].filter(Boolean).join(", ");

      const walkRunBlock = needsWalkRunRamp
        ? `

══ MANDATORY WALK/RUN RAMP (athlete flagged as ${walkRunFlags}) ══
HARD RULE — DO NOT DEVIATE:
The FIRST 10 scheduled workouts in this plan MUST be WALK/RUN INTERVAL sessions. No continuous easy runs, no tempo, no long runs in those 10 slots. Each session must be a structured walk/run interval workout, individually tailored to THIS athlete using their profile, recent activity history, HR zones, and any injury/niggle context above.

Progressive structure across the 10 sessions (adapt run/walk durations and rep counts to the athlete's current capacity — use longest recent run (${longestRun} km), Z2 pace (${z2Pace}/km), resting HR ${restingHr ?? "N/A"}, HRV trend ${hrvTrend}, and injury notes to set the right starting point):
  Sessions 1-2: shortest run intervals (e.g. 30-60s run / 60-90s walk) × 8-12 reps
  Sessions 3-4: 60-90s run / 60s walk × 8-12 reps
  Sessions 5-6: 2 min run / 60s walk × 6-10 reps
  Sessions 7-8: 3-4 min run / 60-90s walk × 5-8 reps
  Sessions 9-10: 5 min run / 60s walk × 4-6 reps (transition toward continuous)

For EACH of the 10 sessions:
- Title MUST start with "Walk/Run Intervals:" e.g. "Walk/Run Intervals: 10 × 1min (Total: 30min)"
- Markdown table with a warm-up walk row, the structured interval rep block row(s), and a cool-down walk row
- The interval row's Duration column MUST use the format "N × Xmin run / Ymin walk" (ASCII "x" is also fine) so the watch can expand the reps. Example: "10 × 1min run / 1min walk"
- Run intensity stays in Z1-Z2 (HR < ${Math.round(maxHr * 0.75)} bpm). NO Z3+ work in these 10 sessions
- Walk recoveries in Z1
- Target column MUST include BOTH the HR range AND an explicit pace range in min/km, based on the athlete's actual Z2 pace (${z2Pace}/km). Run pace target: roughly Z2 pace ± 30s (e.g. if Z2 is 7:00/km use "7:00-7:30/km"). Walk pace: 9:00-10:00/km. NEVER omit the pace — without it the watch defaults to a generic 6:27/km which is too fast for a beginner.
- ⚠️ DO NOT use race-pace-derived paces (threshold, VO2max, race pace) for these 10 walk/run sessions. The athlete is ramping up — paces MUST be conversational easy paces only (Z2 ± 30s, i.e. roughly ${z2Pace}/km). Any run pace faster than 5:30/km in these 10 sessions is FORBIDDEN regardless of goal time.
- Music BPM target on every running segment (🎵 150 BPM walking, 🎵 155 BPM easy run)
- Notes column must briefly reference WHY this fits THIS athlete (their injury, layoff length, or beginner status)
- If athlete has an injury, add a short form/safety cue tied to that injury

After session 10, transition into the normal periodised plan (Z2 continuous, then tempo, then quality work) per the rules below.
`
        : "";

      systemPrompt = `══ ATHLETE ══
Name: ${profile?.name || "Athlete"}
Sex: ${profile?.sex || "not specified"}
Age: ${ageYears ?? "not specified"}
Height: ${profile?.height_cm ? `${profile.height_cm} cm` : "not specified"}
Weight: ${profile?.weight_kg ? `${profile.weight_kg} kg` : "not specified"}
Experience: ${profile?.experience_level || "intermediate"}
Goal: ${profile?.training_goals || "complete the race strong"}
Race: ${raceLabel} on ${race_date && race_date !== "ai-recommend" ? race_date : "TBD (you decide)"}
${(() => {
  if (!goal_time) return "Goal Time: not specified — train for general improvement at this distance";
  // Compute target race pace per km from goal_time + race distance
  const parts = String(goal_time).trim().split(":").map((x: string) => parseInt(x, 10));
  let totalSec = 0;
  if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) totalSec = parts[0] * 60 + parts[1];
  const distKm = ({ "5k": 5, "10k": 10, "half-marathon": 21.0975, "marathon": 42.195 } as Record<string, number>)[race_distance as string] || 0;
  if (!totalSec || !distKm) return `Goal Time: ${goal_time} — build the plan around hitting this finish time`;
  const paceSec = Math.round(totalSec / distKm);
  const pm = Math.floor(paceSec / 60), ps = paceSec % 60;
  const racePace = `${pm}:${ps.toString().padStart(2, "0")}/km`;
  // Derive training paces from race pace
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}/km`;
  return `Goal Time: ${goal_time} → Required race pace: ${racePace}
Derived training paces (use these as anchors when prescribing intervals/tempo/easy):
- Race pace: ${racePace}
- Threshold/Tempo: ${fmt(paceSec + 15)} (race pace + 15s/km)
- VO2max (3-5min reps): ${fmt(Math.max(180, paceSec - 15))} (race pace - 15s/km)
- Easy/Z2: ${fmt(paceSec + 75)} - ${fmt(paceSec + 105)} (race pace + 75-105s/km)
- Long run: ${fmt(paceSec + 60)} - ${fmt(paceSec + 90)}
CRITICAL: Every interval/tempo/race-pace workout MUST prescribe paces tied to this goal time. Do NOT default to generic paces. The whole plan must progressively prepare the athlete to sustain ${racePace} on race day.`;
})()}
Plan: ${weeks} weeks starting ${planStart}
Training Days: ${(training_days as string[] | undefined)?.length || 4} (${daysStr})

══ PHYSIOLOGICAL DATA ══
HR Zones (estimated from max HR ${maxHr}): Z1<${z1Max}, Z2:${z2Range}, Z3:${z3Range}, Z4:${z4Range}, Z5>${z5Min} bpm
VO2max: derive from activity history above
Resting HR: ${restingHr ?? "N/A"} bpm (7-day avg)
HRV: ${hrv ?? "N/A"} ms (trend: ${hrvTrend})
Sleep: ${avgSleepH ?? "N/A"}h/night (see sleep scores in data above)
ACWR: ${acwr} (acute:chronic workload ratio, last 7d vs 28d running minutes)
Injury History: ${profile?.athlete_context || "none reported"}
Current Niggles: ${profile?.athlete_context || "none reported"}

══ RECENT PERFORMANCE ══
Avg pace across recent runs: ${avgRunPace}/km
🔒 ANCHOR EASY PACE (Z2): ${z2Pace}/km — source: ${z2PaceSource}
Long Run: ${longestRun} km
(Recent 5K time and tempo pace: derive from activity history above)
${userAnchorBlock}
══ MANDATORY PACE RULES ══
EVERY pace you prescribe MUST be derived from the ANCHOR EASY PACE above (${z2Pace}/km), NOT from generic textbook values, NOT from a fixed 6:00/km default, and NOT from the historical average pace.
Use these offsets relative to the anchor:
- Easy / Recovery / Z2 continuous: ${z2Pace}/km (± 15s)
- Long run: ${z2Pace}/km to ${z2Pace}/km + 30s
- Steady / Z3 tempo: anchor − 30 to 45s/km
- Threshold / Z4: anchor − 60 to 75s/km
- VO2max / Z5 reps: anchor − 90 to 110s/km
- Walk recovery: 12:30-13:30/km
${userPaceRange ? `WEEK 1 RUN PACE IS LOCKED TO ${userPaceRange}/km. Do not use ${avgRunMps ? fmtPace(paceFromMps(avgRunMps)) + "/km" : "any other pace"} for week 1 easy runs under any circumstance.` : ""}
Across the plan the easy-pace anchor should gradually improve toward the goal race pace as fitness builds, but NEVER prescribe an easy run faster than the current anchor in week 1. Forbidden: prescribing a 6:00/km easy run when the anchor is 7:30/km. Forbidden: ignoring the anchor and using race-pace-derived numbers for easy runs.

══ COACHING TASK ══
You are an elite running coach with 35 years of experience, training beginners to olympic gold medalists to be the best runner they can be. Generate a ${weeks}-week periodized training plan. Be concise, specific, coach-like.${walkRunBlock}

INTERVAL INTRODUCTION BY EXPERIENCE:
IF Beginner OR Injured OR Returning (>8 weeks off):
  - Weeks 1-2: Walk/run intervals ONLY (progressive: 30s run/30s walk → 5min run/1min walk over 10 sessions)
  - Week 3: Introduce tempo (10min Z3)
  - Week 5+: Race pace intervals
IF Intermediate AND No Injury:
  - Weeks 1-2: Easy continuous running Z2
  - Week 2: Add strides (6×20sec)
  - Week 3: Tempo introduction
  - Week 4+: Intervals (race pace, VO2max)
IF Advanced:
  - Week 1: Easy base week Z2
  - Week 2+: Quality sessions with recovery weeks

TRAINING PRINCIPLES:
- 80% volume in Z2 (easy), 20% in Z3-Z5 (hard)
- Increase weekly volume max 10%
- Recovery week every 3-4 weeks (reduce volume 40-50%)
- Taper: Final 10-14 days reduce volume 50-60%, maintain intensity
- Include 2x/week strength/band circuits (glute bridges, single-leg deadlifts, planks, clamshells)
- If ACWR>1.5 OR HRV drops >10% OR RHR elevated >5bpm for 3+ days: force recovery week

PERIODIZATION:
Phase 1 — Base (${baseWeeks} weeks): Z2 volume, aerobic foundation, injury prevention
Phase 2 — Build (${buildWeeks} weeks): Tempo + threshold, maintain volume
Phase 3 — Sharpen (${sharpenWeeks} weeks): Race pace + VO2max, reduce volume 10%
Phase 4 — Taper (${taperWeeks} weeks): -50% volume, maintain intensity

WORKOUT TYPES:
- Easy: Z2, conversational, 30-60min
- Long: Z2, progressive finish, 60-120min
- Tempo: Z3, comfortably hard, 20-40min sustained
- Race Pace: Z3-Z4, 3-10min blocks with 2-3min recovery
- VO2max: Z4-Z5, 400m-1200m reps with equal rest
- Strides: 6×20sec @ 5K pace (neuromuscular)

══ OUTPUT FORMAT ══

**SEASON OVERVIEW** (max 150 words)
- Phase breakdown with weeks
- Weekly volume progression by phase
- Intensity distribution (% time in each zone)
- Key milestone sessions

**WEEK-BY-WEEK PLAN**
${planLengthInstruction}

CRITICAL FORMAT RULES (required for watch sync — do not deviate):
1. Use UK date format (DD/MM/YYYY) for every date.
2. EVERY workout day MUST be presented as a markdown table with columns: Segment | Duration/Distance | Target | Notes. No compact one-liners.
3. EVERY workout title MUST include "(Total: Xmin)" — sum all segments including warm-up, recoveries, cool-down.
4. Interval durations in MINUTES (e.g., "4 x 3 min"), never bare zone labels.
5. When a segment has a distance target, include BOTH distance AND estimated duration (e.g., "10km (~55 min)").
6. EVERY running segment in Notes MUST include music BPM target:
   - Walking/easy: 🎵 150 BPM
   - Easy run: 🎵 155 BPM
   - Steady/intervals: 🎵 165 BPM
   - Tempo/threshold: 🎵 170 BPM
   - Race pace/VO2max: 🎵 175 BPM
7. Include HR target ranges from the zones above in the Target column.
8. Warm-up and cool-down segments MUST be exactly 5 minutes — NEVER shorter than 5 (no 1-min, 2-min, 3-min cool-downs) and never 10+ minutes.

Example workout format:
### Week 1: Base Building
**Monday ${planStart}** - Easy Run (Total: 30min)
| Segment | Duration/Distance | Target | Notes |
|---------|-------------------|--------|-------|
| Warm-up | 5 min walk | Z1 (<${z1Max} bpm) | 🎵 150 BPM (target cadence) |
| Main | 20 min easy run | Z2 (${z2Range} bpm) | 🎵 155 BPM (target cadence); walk breaks OK if HR spikes |
| Cool-down | 5 min walk | Z1 (<${z1Max} bpm) | 🎵 150 BPM (target cadence) |
- Strength: Band circuit after (glute bridges, clamshells, planks)

After all weekly sessions, append:

**RACE DAY STRATEGY**
- Mile-by-mile splits (conservative start, build, finish strong)
- HR targets per mile
- Warm-up protocol (5min jog Z2 + 4×20sec strides)
- Fueling (if race >60min)

**STRENGTH CIRCUIT** (2x/week)
- Single-leg deadlifts: 3×10 each leg
- Glute bridges: 3×15
- Clamshells: 3×20 each side
- Planks: 3×30-60sec
- Calf raises: 3×20

Generate the complete plan now. Be specific with paces, HR zones, and workout structures. Base all targets on the athlete's actual performance data above.`;

      userPrompt = `${athleteContext}

${dataContext}

Generate a comprehensive ${raceLabel} ${isAIDecide ? 'fitness assessment, recommended timeline, and complete' : 'season strategy and detailed 4-week'} training plan starting ${planStart}. Schedule workouts only on ${daysStr}. Base all targets on the actual performance data above. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else if (type === "post-plan-analysis") {
      // After initial plan generation, analyse existing activities to see if plan needs amending
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      systemPrompt = `You are an elite endurance coach AI. A new ${raceLabel} training plan has just been generated for the athlete. Your job is to compare the plan against the athlete's RECENT ACTIVITY HISTORY to see if any amendments are warranted.

Look for:
1. **Pacing mismatch**: Are plan targets significantly faster or slower than recent performances?
2. **Volume mismatch**: Is the planned weekly volume a big jump (>10-15%) from recent training?
3. **Intensity distribution**: Does the plan match the athlete's current 80/20 easy-hard balance?
4. **Recovery concerns**: Does sleep/HRV data suggest the athlete needs more recovery than planned?
5. **Injury/limitation flags**: Are there activity patterns suggesting an injury that the plan doesn't account for?

Your response MUST follow this format:

## 🔍 Activity vs Plan Analysis
3-5 bullet points comparing key metrics from recent activities to plan targets.

## ✅ Verdict: [NO CHANGES NEEDED / CHANGES RECOMMENDED]
State clearly whether you recommend amendments.

If CHANGES RECOMMENDED:
## 📝 Recommended Changes
- List specific changes with reasons (3-5 bullets max)
- Be precise: "Reduce Week 1 long run from 15km to 12km because longest recent run was 10km"

If NO CHANGES NEEDED:
## 👍 Plan Looks Good
Brief 1-2 sentence confirmation that the plan aligns well with current fitness.

BREVITY RULES:
- Maximum 150 words total
- Bullet points only, no paragraphs
- Reference specific numbers from the data

${athleteContext}`;

      userPrompt = `${dataContext}

NEW TRAINING PLAN:
${current_plan || "No plan provided"}

Analyse whether the new plan aligns with the athlete's recent activity history, or if amendments are needed. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else if (type === "workout-review") {
      const reviewSystemPrompt = [
        "You are an incredibly supportive and encouraging running coach reviewing an athlete's completed workout vs their plan. Be warm, positive, celebratory. Keep it concise (150-200 words). Use emojis sparingly.",
        "",
        "Format:",
        "## Workout Review",
        "**Performance Summary**: Brief planned vs actual comparison",
        "**What Went Well**: 2-3 specific positives",
        "**Areas to Build On**: 1-2 gentle suggestions (only if relevant)",
        "**Coach's Note**: Encouraging closing message",
      ].join("\n");
      systemPrompt = reviewSystemPrompt;

      const pw = planned_workout || "N/A";
      const as = activity_summary || "N/A";
      userPrompt = "## Planned Workout\n" + pw + "\n\n## Actual Activity\n" + as + "\n\nReview this workout with encouraging, supportive feedback.";
    } else if (type === "plan-continuation" || type === "plan-easier" || type === "plan-harder" || type === "plan-apply") {
      // Tail-extension / aliased plan-rewrite. The client sends the existing
      // (possibly truncated) plan and asks us to emit ONLY the missing days
      // through race_date so the final saved plan always reaches 🏁 RACE DAY.
      const raceLabel = ({
        "5k": "5K", "10k": "10K", "half-marathon": "Half Marathon", "marathon": "Marathon",
      } as Record<string, string>)[race_distance as string] || "Half Marathon";
      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";
      const raceLine = race_date && race_date !== "ai-recommend"
        ? `"🏁 RACE DAY — ${raceLabel}"${goal_time ? `, goal ${goal_time}` : ""} on ${race_date}`
        : `"🏁 RACE DAY — ${raceLabel}"`;
      systemPrompt = `You are an elite running coach extending an existing training plan to race day.
The plan below stops short of the race. Output ONLY the missing days in the SAME markdown format the plan already uses (## Week N headers, ### day headers in DD/MM/YYYY, 5-column workout tables with music BPM in the Notes column). Continue the periodisation seamlessly — do NOT restart Week 1, do NOT repeat earlier weeks, do NOT add a preamble or commentary. The FINAL entry MUST be ${raceLine}. RACE DAY is a single continuous race effort over the full race distance — no walk/run intervals, no training sets. Workout segment tables must never contain mobility/stretching/foam-rolling/yoga rows.`;
      userPrompt = `Training days: ${daysStr}
Race: ${raceLabel}${race_date && race_date !== "ai-recommend" ? ` on ${race_date}` : ""}${goal_time ? ` (goal ${goal_time})` : ""}

EXISTING PLAN (already saved — do NOT repeat any of it, output only what comes AFTER the last date below):
${current_plan || "No plan provided"}

Today's date is ${new Date().toISOString().split("T")[0]}. Continue from the day after the last dated entry above through race day inclusive.`;
    }

    const { callAI } = await import("../_shared/ai.ts");
    const isChat = type === "chat";
    const priorTurns = isChat && Array.isArray(chatHistory)
      ? chatHistory
          .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-20)
          // Drop the trailing user turn — we send it as the final userPrompt below.
          .slice(0, -1)
      : [];
    // Universal date/time prelude — every AI call (chat, analysis, plan
    // generation, day-ahead, review) gets the current date, time, weekday,
    // and a forward-looking 14-day calendar so it can never hallucinate dates.
    const nowPrelude = (() => {
      const now = new Date();
      const dayNames = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const fmt = (d: Date) => `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
      const ukTime = now.toLocaleString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
      const upcoming: string[] = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(now); d.setDate(now.getDate() + i);
        upcoming.push(`  - ${i === 0 ? "Today" : i === 1 ? "Tomorrow" : `+${i}d`}: ${dayNames[d.getDay()]} ${fmt(d)}`);
      }
      return `CURRENT DATE & TIME (authoritative — never contradict this):
- Now: ${dayNames[now.getDay()]} ${fmt(now)} ${ukTime} (Europe/London, UK format DD/MM/YYYY)
- Upcoming 14 days:
${upcoming.join("\n")}
- When the user names a weekday without a date, resolve it against this calendar. Never guess a date.

`;
    })();
    const planRewriteTypes = new Set(["training-plan", "plan-adjust", "plan-easier", "plan-harder", "plan-apply", "plan-continuation"]);
    const needsRaceDateContinuation = planRewriteTypes.has(type) && !!race_date && race_date !== "ai-recommend";
    // Route full plan generation/adjustment to a higher-capacity model (Gemini Flash preview caps
    // output at ~8-16k tokens which truncates long multi-month plans before they
    // reach race day). Other types keep the gateway default.
    const planLovableModel = "google/gemini-2.5-pro";

    const initialMessages = [
      { role: "system" as const, content: nowPrelude + systemPrompt },
      ...priorTurns,
      { role: "user" as const, content: userPrompt },
    ];

    const response = await callAI({
      stream: true,
      maxTokens: 64000,
      label: `ai-coach:${type || "chat"}`,
      lovableModel: needsRaceDateContinuation ? planLovableModel : undefined,
      messages: initialMessages,
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI gateway error");
    }

    const sseHeaders = {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    };

    // Non-full-plan types: zero-buffer pass-through (latency-sensitive).
    if (!needsRaceDateContinuation) {
      // IMPORTANT: do not await a TransformStream write before returning the
      // Response. With no browser reader attached yet, that write can backpressure
      // forever, which made Day Ahead time out whenever streamPreamble was set.
      if (!streamPreamble) {
        return new Response(response.body, { headers: sseHeaders });
      }

      const encoder = new TextEncoder();
      const readable = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const chunk = { choices: [{ delta: { content: streamPreamble } }] };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));

            const reader = response.body!.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } catch (e) {
            console.error("stream preamble pipe error:", e);
            controller.error(e);
            return;
          }
          controller.close();
        },
      });
      return new Response(readable, { headers: sseHeaders });
    }

    // Plan generation: buffered streaming. Re-emit upstream deltas live AND
    // capture the full text so we can detect early truncation and run
    // continuation passes until the plan reaches race_date.
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();

    (async () => {
      const writer = writable.getWriter();
      let fullText = "";

      // Recompute plan-context locals (they live inside the plan branches above
      // and aren't in scope here).
      const _planStart = preserve_past && plan_start_from_date
        ? String(plan_start_from_date)
        : (start_date || new Date().toISOString().split("T")[0]);
      const _daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";
      const _raceLabel = ({
        "5k": "5K", "10k": "10K", "half-marathon": "Half Marathon", "marathon": "Marathon",
      } as Record<string, string>)[race_distance as string] || "Half Marathon";
      const _raceDayName = new Date((race_date as string) + "T00:00:00")
        .toLocaleDateString("en-GB", { weekday: "long" });
      const _raceDateUKLong = new Date((race_date as string) + "T00:00:00")
        .toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const _racePaceStr = (() => {
        if (!goal_time) return null;
        const parts = String(goal_time).trim().split(":").map((x: string) => parseInt(x, 10));
        let totalSec = 0;
        if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) totalSec = parts[0] * 60 + parts[1];
        const distKm = ({ "5k": 5, "10k": 10, "half-marathon": 21.0975, "marathon": 42.195 } as Record<string, number>)[race_distance as string] || 0;
        if (!totalSec || !distKm) return null;
        const paceSec = Math.round(totalSec / distKm);
        return `${Math.floor(paceSec / 60)}:${(paceSec % 60).toString().padStart(2, "0")}/km`;
      })();

      const emitDelta = async (delta: string) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`));
      };

      const consumeStream = async (body: ReadableStream<Uint8Array>) => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let sawDone = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).replace(/\r$/, "");
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;
            if (json === "[DONE]") { sawDone = true; continue; }
            try {
              const evt = JSON.parse(json);
              const delta = evt?.choices?.[0]?.delta?.content;
              if (typeof delta === "string") {
                fullText += delta;
                await emitDelta(delta);
              }
            } catch { /* ignore */ }
          }
        }
        return sawDone;
      };

      // Pull the last date from the accumulated plan text, accepting both ISO
      // and UK markdown headings so continuation works for generated/adjusted plans.
      const lastIsoDate = (txt: string): string | null => {
        const matches = [...txt.matchAll(/\b(?:(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])|([0-3]?\d)\/(0?\d)\/(20\d{2}))\b/g)];
        if (!matches.length) return null;
        const m = matches[matches.length - 1];
        if (m[1] && m[2] && m[3]) return `${m[1]}-${m[2]}-${m[3]}`;
        const dd = String(m[4]).padStart(2, "0");
        const mm = String(m[5]).padStart(2, "0");
        return `${m[6]}-${mm}-${dd}`;
      };
      const hasRaceDayEntry = (txt: string, targetIso: string): boolean => {
        const [y, m, d] = targetIso.split("-");
        const targetUk = `${d}/${m}/${y}`;
        const lines = txt.split("\n").filter((line) => /race\s*day/i.test(line));
        return lines.some((line) => line.includes(targetIso) || line.includes(targetUk));
      };

      try {
        await consumeStream(response.body!);

        const targetIso = race_date as string;
        const MAX_CONTINUATIONS = 3;
        let attempts = 0;
        let assistantSoFar = fullText;

        while (attempts < MAX_CONTINUATIONS) {
          const last = lastIsoDate(assistantSoFar);
          const raceDayPresent = hasRaceDayEntry(assistantSoFar, targetIso);
          if (last && last >= targetIso && raceDayPresent) break;
          attempts++;

          const resumeFrom = (() => {
            if (!last) return _planStart;
            if (last >= targetIso) return targetIso;
            const d = new Date(last + "T00:00:00");
            d.setDate(d.getDate() + 1);
            return d.toISOString().slice(0, 10);
          })();

          console.log(`[${type}] continuation pass ${attempts}: last=${last} → resume ${resumeFrom} → target ${targetIso}`);

          const continuationUser = `The plan above stopped at ${last || "the start"}. Continue the plan from ${resumeFrom} through ${targetIso} (${_raceDayName}, ${_raceDateUKLong}) inclusive.

Use the EXACT same markdown format (week headings, day headings in DD/MM/YYYY, 4-column workout tables with music BPM in Notes), the same training-day schedule (${_daysStr}), and the same pace/HR anchors as the plan above. Continue the periodisation seamlessly (do NOT restart Week 1).

Output ONLY the new days from ${resumeFrom} onwards — do NOT repeat earlier weeks, do NOT include the season overview again, and do NOT add a preamble.

The FINAL entry MUST be the race itself on ${targetIso}: "🏁 RACE DAY — ${_raceLabel}"${goal_time ? `, goal ${goal_time}` : ""}${_racePaceStr ? ` at ${_racePaceStr}` : ""}.`;

          const contResp = await callAI({
            stream: true,
            maxTokens: 64000,
            label: `ai-coach:${type}:cont${attempts}`,
            lovableModel: planLovableModel,
            messages: [
              { role: "system", content: nowPrelude + systemPrompt },
              { role: "user", content: userPrompt },
              { role: "assistant", content: assistantSoFar },
              { role: "user", content: continuationUser },
            ],
          });

          if (!contResp.ok || !contResp.body) {
            console.error(`[training-plan] continuation ${attempts} failed: ${contResp.status}`);
            break;
          }

          const beforeLen = fullText.length;
          await consumeStream(contResp.body);
          const added = fullText.slice(beforeLen);
          assistantSoFar = assistantSoFar + "\n" + added;
        }

        // ── Final mandatory validation pass ──
        // If after 3 normal continuations the plan still doesn't contain the
        // race day entry on race_date, force ONE extra pass (separate budget)
        // with a stronger directive. This guarantees no streamed plan ever
        // ends short of race day, regardless of model truncation.
        {
          const targetIso = race_date as string;
          const last = lastIsoDate(assistantSoFar);
          const raceDayPresent = hasRaceDayEntry(assistantSoFar, targetIso);
          if (!last || last < targetIso || !raceDayPresent) {
            console.log(`[${type}] final validation pass: last=${last} raceDayPresent=${raceDayPresent} → forcing one extra continuation`);
            const resumeFrom = (() => {
              if (!last) return _planStart;
              if (last >= targetIso) return targetIso;
              const d = new Date(last + "T00:00:00");
              d.setDate(d.getDate() + 1);
              return d.toISOString().slice(0, 10);
            })();
            const finalUser = `VALIDATION FAILURE: the plan above does NOT contain a "🏁 RACE DAY" entry on ${targetIso}. This is INVALID and unsaveable. Output ONLY the missing days from ${resumeFrom} through ${targetIso} (${_raceDayName}, ${_raceDateUKLong}) inclusive, in the same markdown format. The very last entry MUST be "🏁 RACE DAY — ${_raceLabel}"${goal_time ? `, goal ${goal_time}` : ""}${_racePaceStr ? ` at ${_racePaceStr}` : ""} on ${targetIso}. No preamble, no commentary — just the missing markdown.`;
            try {
              const finalResp = await callAI({
                stream: true,
                maxTokens: 64000,
                label: `ai-coach:${type}:final-validation`,
                lovableModel: planLovableModel,
                messages: [
                  { role: "system", content: nowPrelude + systemPrompt },
                  { role: "user", content: userPrompt },
                  { role: "assistant", content: assistantSoFar },
                  { role: "user", content: finalUser },
                ],
              });
              if (finalResp.ok && finalResp.body) {
                const beforeLen = fullText.length;
                await consumeStream(finalResp.body);
                assistantSoFar = assistantSoFar + "\n" + fullText.slice(beforeLen);
              } else {
                console.error(`[${type}] final validation pass failed: ${finalResp.status}`);
              }
            } catch (e) {
              console.error(`[${type}] final validation pass exception:`, e);
            }
          }
        }

        // Always emit a final [DONE] so the client unblocks even if upstream
        // didn't send one or we appended continuations.
        await writer.write(encoder.encode("data: [DONE]\n\n"));
      } catch (e) {
        console.error("[training-plan] buffered stream error:", e);
      } finally {
        try { await writer.close(); } catch { /* ignore */ }
      }
    })();

    return new Response(readable, { headers: sseHeaders });
  } catch (e) {
    console.error("ai-coach error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
