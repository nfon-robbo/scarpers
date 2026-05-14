import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Algorithm port (kept in sync with src/lib/readiness.ts) ──

interface ReadinessData {
  sleepScore: number | null;
  sleepHours: number | null;
  deepPct: number | null;
  rhr: number | null;
  rhrBaseline: number | null;
  hrv: number | null;
  hrvBaseline: number | null;
  yesterdayLoad: number | null;
  todayLoad: number | null;
  recoveryHoursSinceLastHard: number | null;
  lastWorkoutIntensity: number | null;
  recentSleepAvgHours: number | null;
  baselineSleepAvgHours: number | null;
  weeklyLoadAvg: number | null;
  monthlyLoadAvg: number | null;
  wakeTimeIso: string | null;
  todayActivities: { startIso: string; durationSec: number; intensityLoad: number }[];
}

interface Factor { label: string; status: "good" | "warning" | "poor"; detail: string }

function activityIntensityLoad(act: any): number {
  const mins = (act.duration_seconds || 0) / 60;
  if (mins <= 0) return 0;
  if (act.training_load != null && act.training_load > 0) return act.training_load;
  if (act.training_effect != null && act.training_effect > 0) {
    return mins * (0.25 + (act.training_effect / 5) * 1.75);
  }
  if (act.avg_heart_rate != null && act.avg_heart_rate > 0) {
    return mins * Math.max(0.5, Math.min(2.0, act.avg_heart_rate / 140));
  }
  return mins;
}

function workoutIntensity(act: any): number {
  if (act.training_effect != null && act.training_effect > 0) return Math.min(100, (act.training_effect / 5) * 100);
  if (act.avg_heart_rate != null && act.avg_heart_rate > 0) return Math.min(100, Math.max(10, ((act.avg_heart_rate - 100) / 100) * 80 + 20));
  if (act.training_load != null && act.training_load > 0) return Math.min(100, (act.training_load / 200) * 100);
  const mins = (act.duration_seconds || 0) / 60;
  return Math.min(100, Math.max(10, (mins / 90) * 60 + 20));
}

function bodyBatteryDrain(d: ReadinessData) {
  const now = Date.now();
  let wakeMs = d.wakeTimeIso ? new Date(d.wakeTimeIso).getTime() : (() => { const t = new Date(); t.setHours(7, 0, 0, 0); return t.getTime(); })();
  let hoursAwake = Math.min(20, Math.max(0, (now - wakeMs) / 3600000));
  let passiveDrain = 0;
  for (let h = 0; h < hoursAwake; h++) {
    const slice = Math.min(1, hoursAwake - h);
    passiveDrain += Math.min(3, 1 + h / 8) * slice;
  }
  let activeDrain = 0;
  for (const act of d.todayActivities) activeDrain += act.intensityLoad * 0.1;
  activeDrain = Math.min(10, activeDrain);
  let chargeRate = 2;
  if (d.hrv != null && d.hrvBaseline != null && d.hrvBaseline > 0) {
    if (d.hrv > d.hrvBaseline * 1.05) chargeRate = 3;
    else if (d.hrv < d.hrvBaseline * 0.95) chargeRate = 1;
  }
  let passiveCharge = 0;
  for (let h = 0; h < hoursAwake && passiveCharge < 15; h++) {
    const sliceStart = wakeMs + h * 3600000;
    const sliceEnd = Math.min(now, sliceStart + 3600000);
    const sliceHours = (sliceEnd - sliceStart) / 3600000;
    if (sliceHours <= 0) break;
    const windowStart = sliceStart - 2 * 3600000;
    let recentLoad = 0;
    for (const act of d.todayActivities) {
      const aStart = new Date(act.startIso).getTime();
      const aEnd = aStart + (act.durationSec || 0) * 1000;
      if (aEnd < windowStart || aStart > sliceStart) continue;
      const overlap = Math.max(0, Math.min(aEnd, sliceStart) - Math.max(aStart, windowStart));
      const total = Math.max(1, aEnd - aStart);
      recentLoad += act.intensityLoad * (overlap / total);
    }
    if (recentLoad < 5) passiveCharge = Math.min(15, passiveCharge + chargeRate * sliceHours);
  }
  return { drain: -(passiveDrain + activeDrain - passiveCharge), hoursAwake, passiveDrain, activeDrain, passiveCharge };
}

function scoreLabel(s: number): string {
  if (s >= 90) return "Excellent"; if (s >= 80) return "Great"; if (s >= 70) return "Good";
  if (s >= 60) return "Fair"; if (s >= 50) return "Poor"; return "Bad";
}

function computeReadiness(d: ReadinessData, mode: "morning" | "eod") {
  const factors: Factor[] = [];
  let weightedSum = 0;

  // Sleep Quality 34%
  if (d.sleepScore == null) {
    weightedSum += 30 * 0.34;
    factors.push({ label: "Sleep Quality", status: "poor", detail: "Not synced" });
  } else {
    const s = d.sleepScore;
    const adjusted = s >= 80 ? s : s >= 60 ? s * 0.75 : s * 0.55;
    weightedSum += adjusted * 0.34;
    factors.push({
      label: "Sleep Quality",
      status: s >= 75 ? "good" : s >= 55 ? "warning" : "poor",
      detail: `${s}/100 (${scoreLabel(s)})${d.sleepHours != null ? ` · ${d.sleepHours.toFixed(1)}h` : ""}`,
    });
  }

  // Deep Sleep 15%
  if (d.deepPct != null) {
    const dp = d.deepPct;
    const dr = dp >= 15 ? 90 : dp >= 12 ? 65 : dp >= 10 ? 45 : dp >= 7 ? 25 : 10;
    weightedSum += dr * 0.15;
    factors.push({
      label: "Deep Sleep",
      status: dp >= 13 ? "good" : dp >= 10 ? "warning" : "poor",
      detail: `${Math.round(dp)}% of sleep · ${dp < 10 ? "Critically low" : dp < 13 ? "Low" : "Healthy"}`,
    });
  } else weightedSum += 25 * 0.15;

  // RHR 12%
  if (d.rhr != null && d.rhrBaseline != null) {
    const diff = d.rhr - d.rhrBaseline;
    const rs = diff <= 0 ? 85 : diff <= 2 ? 75 : diff <= 4 ? 55 : diff <= 7 ? 35 : 15;
    weightedSum += rs * 0.12;
    factors.push({
      label: "Resting HR",
      status: diff <= 3 ? "good" : diff <= 7 ? "warning" : "poor",
      detail: `${Math.round(d.rhr)} bpm (${diff > 0 ? "+" : ""}${Math.round(diff)} vs avg)`,
    });
  } else if (d.rhr != null) { weightedSum += 40 * 0.12; factors.push({ label: "Resting HR", status: "warning", detail: `${Math.round(d.rhr)} bpm (no baseline)` }); }
  else weightedSum += 15 * 0.12;

  // HRV 23%
  if (d.hrv != null && d.hrvBaseline != null) {
    const diff = d.hrv - d.hrvBaseline;
    const pct = d.hrvBaseline > 0 ? (diff / d.hrvBaseline) * 100 : 0;
    const hs = pct >= 10 ? 90 : pct >= 0 ? 75 : pct >= -10 ? 55 : pct >= -20 ? 35 : 15;
    weightedSum += hs * 0.23;
    factors.push({
      label: "HRV",
      status: pct >= -5 ? "good" : pct >= -15 ? "warning" : "poor",
      detail: `${Math.round(d.hrv)} ms (${pct >= 0 ? "+" : ""}${Math.round(pct)}% vs avg)`,
    });
  } else { weightedSum += 25 * 0.23; factors.push({ label: "HRV", status: "poor", detail: "No data" }); }

  // Yesterday's Load 16%
  if (d.yesterdayLoad != null) {
    const l = d.yesterdayLoad;
    const ls = l <= 15 ? 85 : l <= 40 ? 70 : l <= 80 ? 45 : l <= 140 ? 25 : 10;
    weightedSum += ls * 0.16;
    factors.push({
      label: "Yesterday's Load",
      status: l <= 40 ? "good" : l <= 80 ? "warning" : "poor",
      detail: `${Math.floor(l / 60)}:${String(Math.round(l % 60)).padStart(2, "0")} training`,
    });
  } else weightedSum += 50 * 0.16;

  const baseScore = weightedSum;

  if (mode === "morning") {
    return { score: Math.round(Math.max(5, Math.min(100, baseScore))), factors };
  }

  // EOD modifiers
  const modifiers: { label: string; adj: number; detail: string }[] = [];
  const lastWorkoutWasToday = d.todayLoad != null && d.todayLoad > 0;
  if (d.recoveryHoursSinceLastHard != null && d.lastWorkoutIntensity != null && !lastWorkoutWasToday) {
    const hrs = d.recoveryHoursSinceLastHard;
    const needed = 8 + (d.lastWorkoutIntensity / 100) * 16;
    if (hrs < needed) {
      const ratio = hrs / needed;
      modifiers.push({ label: "Recovery", adj: -Math.round(4 + (1 - ratio) * 10), detail: `${Math.round(hrs)}h since last session` });
    } else modifiers.push({ label: "Recovery", adj: 0, detail: `${Math.round(hrs)}h since last session` });
  } else if (!lastWorkoutWasToday && d.recoveryHoursSinceLastHard != null) {
    modifiers.push({ label: "Recovery", adj: 0, detail: `${Math.round(d.recoveryHoursSinceLastHard)}h since last session` });
  }
  if (d.recentSleepAvgHours != null && d.baselineSleepAvgHours != null && d.baselineSleepAvgHours > 0) {
    const debt = d.recentSleepAvgHours - d.baselineSleepAvgHours;
    if (debt < -0.3) modifiers.push({ label: "Sleep Debt", adj: Math.round(Math.max(-15, debt * 8)), detail: `${debt.toFixed(1)}h vs avg (3 nights)` });
  }
  if (d.weeklyLoadAvg != null && d.monthlyLoadAvg != null && d.monthlyLoadAvg > 0) {
    const ratio = d.weeklyLoadAvg / d.monthlyLoadAvg;
    if (ratio > 1.4) modifiers.push({ label: "Training Ramp", adj: -Math.round(Math.min(10, (ratio - 1.4) * 10)), detail: `${ratio.toFixed(1)}x vs monthly avg` });
    else if (ratio < 0.5 && d.weeklyLoadAvg > 0) modifiers.push({ label: "Freshness", adj: 3, detail: `${ratio.toFixed(1)}x vs monthly avg` });
  }
  if (d.todayLoad != null && d.todayLoad > 0) {
    modifiers.push({ label: "Today's Effort", adj: -Math.round(Math.min(12, (d.todayLoad / 60) * 8)), detail: `${Math.floor(d.todayLoad / 60)}:${String(Math.round(d.todayLoad % 60)).padStart(2, "0")} (intensity-weighted)` });
  }

  const battery = bodyBatteryDrain(d);
  let totalAdj = battery.drain;
  for (const m of modifiers) totalAdj += m.adj;
  if (battery.hoursAwake > 0.5) {
    const drainTotal = battery.passiveDrain + battery.activeDrain;
    const charged = Math.round(baseScore) + battery.passiveCharge;
    const chargeNote = battery.passiveCharge > 0 ? ` (+${Math.round(battery.passiveCharge)} rest)` : "";
    factors.push({
      label: "Body Battery",
      status: drainTotal - battery.passiveCharge <= 15 ? "good" : drainTotal - battery.passiveCharge <= 30 ? "warning" : "poor",
      detail: `⚡${charged} charged${chargeNote} · 🔋-${Math.round(drainTotal)} drained (${battery.hoursAwake.toFixed(1)}h awake)`,
    });
  }
  for (const m of modifiers) {
    if (Math.abs(m.adj) >= 3 || (m.label === "Recovery" && m.adj === 0)) {
      factors.push({ label: m.label, status: m.adj >= 0 ? "good" : m.adj >= -5 ? "warning" : "poor", detail: m.detail });
    }
  }
  return { score: Math.round(Math.max(5, Math.min(100, baseScore + totalAdj))), factors };
}

// ── Data assembly per user ──

function calculateSleepScoreFromStages(s: { deep: number; light: number; rem: number }) {
  const total = s.deep + s.light + s.rem;
  if (total <= 0) return null;
  const hours = total / 3600;
  const deepPct = s.deep / total;
  const remPct = s.rem / total;
  const durScore = hours >= 7 ? 100 : hours >= 6 ? 80 : hours >= 5 ? 60 : 40;
  const deepScore = deepPct >= 0.13 ? 100 : deepPct >= 0.10 ? 75 : 50;
  const remScore = remPct >= 0.20 ? 100 : remPct >= 0.15 ? 75 : 50;
  return Math.round(durScore * 0.5 + deepScore * 0.3 + remScore * 0.2);
}

async function assembleData(supabase: any, userId: string): Promise<ReadinessData | null> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const yest = new Date(today.getTime() - 86400000).toISOString().split("T")[0];
  const back30 = new Date(today.getTime() - 30 * 86400000).toISOString().split("T")[0];
  const back28 = new Date(today.getTime() - 28 * 86400000).toISOString().split("T")[0];
  const back7 = new Date(today.getTime() - 7 * 86400000).toISOString().split("T")[0];
  const back3 = new Date(today.getTime() - 3 * 86400000).toISOString().split("T")[0];

  const [{ data: metrics }, { data: stages }, { data: acts }] = await Promise.all([
    supabase.from("daily_metrics").select("date, resting_heart_rate, hrv, sleep_score, sleep_duration_seconds, stress_score").eq("user_id", userId).gte("date", back30),
    supabase.from("sleep_stages").select("date, stage, duration_seconds, end_time").eq("user_id", userId).gte("date", back7),
    supabase.from("activities").select("start_time, duration_seconds, avg_heart_rate, training_load, training_effect").eq("user_id", userId).gte("start_time", back28 + "T00:00:00Z"),
  ]);

  const mList = (metrics || []).slice().sort((a: any, b: any) => b.date.localeCompare(a.date));
  const todayM = mList.find((m: any) => m.date === todayStr) || mList[0];
  if (!todayM) return null;

  // Baselines (30d avg excluding today)
  const baseline = (key: string) => {
    const vals = mList.filter((m: any) => m.date !== todayStr && m[key] != null).map((m: any) => Number(m[key])).filter((v: number) => isFinite(v));
    if (!vals.length) return null;
    return vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
  };

  // Sleep stages → today's deep%
  const stagesByDate = new Map<string, { deep: number; light: number; rem: number }>();
  (stages || []).forEach((s: any) => {
    const cur = stagesByDate.get(s.date) || { deep: 0, light: 0, rem: 0 };
    const k = (s.stage || "").toLowerCase();
    const dur = s.duration_seconds || 0;
    if (k === "deep") cur.deep += dur;
    else if (k === "light") cur.light += dur;
    else if (k === "rem") cur.rem += dur;
    stagesByDate.set(s.date, cur);
  });
  const todayStages = stagesByDate.get(todayStr);
  const totalSleep = todayStages ? todayStages.deep + todayStages.light + todayStages.rem : 0;
  const deepPct = todayStages && totalSleep > 0 ? (todayStages.deep / totalSleep) * 100 : null;
  const sleepFromStages = todayStages ? calculateSleepScoreFromStages(todayStages) : null;
  const sleepScore = sleepFromStages ?? (todayM.sleep_score != null ? Number(todayM.sleep_score) : null);
  const sleepDurSec = totalSleep > 0 ? totalSleep : (todayM.sleep_duration_seconds != null ? Number(todayM.sleep_duration_seconds) : null);

  // Wake time = end of last sleep stage today
  const todayStageRows = (stages || []).filter((s: any) => s.date === todayStr && s.end_time);
  todayStageRows.sort((a: any, b: any) => (b.end_time || "").localeCompare(a.end_time || ""));
  const wakeTimeIso = todayStageRows[0]?.end_time ?? null;

  // Loads
  const loadByDate = new Map<string, number>();
  const todayActivities: { startIso: string; durationSec: number; intensityLoad: number }[] = [];
  let recentSleepDurations: number[] = [];
  let baselineSleepDurations: number[] = [];

  (acts || []).forEach((a: any) => {
    if (!a.start_time) return;
    const d = a.start_time.split("T")[0];
    const load = activityIntensityLoad(a);
    loadByDate.set(d, (loadByDate.get(d) || 0) + load);
    if (d === todayStr) {
      todayActivities.push({ startIso: a.start_time, durationSec: a.duration_seconds || 0, intensityLoad: load });
    }
  });

  // Sleep averages
  for (const m of mList) {
    if (m.sleep_duration_seconds == null) continue;
    const hours = Number(m.sleep_duration_seconds) / 3600;
    if (m.date >= back3 && m.date < todayStr) recentSleepDurations.push(hours);
    if (m.date < todayStr) baselineSleepDurations.push(hours);
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  // Weekly/monthly load avg
  let week = 0, month = 0;
  loadByDate.forEach((v, d) => { if (d >= back7 && d < todayStr) week += v; if (d >= back28 && d < todayStr) month += v; });

  // Recovery hours since last hard session (intensity > 50, before today)
  let recoveryHours: number | null = null, lastIntensity: number | null = null;
  const sortedActs = (acts || []).slice().sort((a: any, b: any) => (b.start_time || "").localeCompare(a.start_time || ""));
  for (const a of sortedActs) {
    const intensity = workoutIntensity(a);
    if (intensity >= 50) {
      const ageH = (Date.now() - new Date(a.start_time).getTime()) / 3600000;
      if (ageH > 1) { recoveryHours = ageH; lastIntensity = intensity; break; }
    }
  }

  return {
    sleepScore,
    sleepHours: sleepDurSec ? sleepDurSec / 3600 : null,
    deepPct,
    rhr: todayM.resting_heart_rate != null ? Number(todayM.resting_heart_rate) : null,
    rhrBaseline: baseline("resting_heart_rate"),
    hrv: todayM.hrv != null ? Number(todayM.hrv) : null,
    hrvBaseline: baseline("hrv"),
    yesterdayLoad: loadByDate.get(yest) ?? null,
    todayLoad: loadByDate.get(todayStr) ?? null,
    recoveryHoursSinceLastHard: recoveryHours,
    lastWorkoutIntensity: lastIntensity,
    recentSleepAvgHours: avg(recentSleepDurations),
    baselineSleepAvgHours: avg(baselineSleepDurations),
    weeklyLoadAvg: week > 0 ? week / 7 : null,
    monthlyLoadAvg: month > 0 ? month / 28 : null,
    wakeTimeIso,
    todayActivities,
  };
}

// ── Handler ──

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Cron-only — require service role bearer
  const auth = req.headers.get("Authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!provided || provided !== SERVICE_KEY) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Trigger upstream syncs first (best-effort, don't block on failure)
  for (const type of ["intervals-wellness", "google-fit-sleep"]) {
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/auto-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ type }),
      });
    } catch (e) {
      console.error(`auto-sync ${type} trigger failed:`, e);
    }
  }

  // Active users = anyone with a recent activity, sleep stage or daily metric (last 14d)
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString();
  const cutoffDate = cutoff.split("T")[0];
  const [{ data: a1 }, { data: a2 }, { data: a3 }] = await Promise.all([
    supabase.from("activities").select("user_id").gte("start_time", cutoff),
    supabase.from("daily_metrics").select("user_id").gte("date", cutoffDate),
    supabase.from("sleep_stages").select("user_id").gte("date", cutoffDate),
  ]);
  const userIds = new Set<string>();
  (a1 || []).forEach((r: any) => userIds.add(r.user_id));
  (a2 || []).forEach((r: any) => userIds.add(r.user_id));
  (a3 || []).forEach((r: any) => userIds.add(r.user_id));

  const recordedAt = new Date();
  const hour = recordedAt.getUTCHours();
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);

  const results: { user_id: string; status: string; detail?: string }[] = [];

  for (const userId of userIds) {
    try {
      const data = await assembleData(supabase, userId);
      if (!data) { results.push({ user_id: userId, status: "skipped", detail: "no data" }); continue; }

      const eod = computeReadiness(data, "eod");
      await supabase.from("readiness_snapshots").insert({
        user_id: userId, score: eod.score, hour, factors: eod.factors,
        recorded_at: recordedAt.toISOString(), kind: "eod",
      });

      // Morning snapshot — only one per day
      const { data: existingMorning } = await supabase
        .from("readiness_snapshots")
        .select("id").eq("user_id", userId).eq("kind", "morning")
        .gte("recorded_at", todayStart.toISOString()).limit(1).maybeSingle();
      if (!existingMorning) {
        const morning = computeReadiness(data, "morning");
        const forbidden = ["Body Battery", "Today's Effort", "Sleep Debt"];
        const bad = (morning.factors as Array<{ label: string }>).find((f) => forbidden.includes(f.label));
        if (bad) {
          console.error(`[hourly] rejected mislabeled morning snapshot for ${userId}: contains "${bad.label}"`, morning.factors);
          results.push({ user_id: userId, status: "rejected", detail: `morning had EOD modifier "${bad.label}"` });
        } else {
          await supabase.from("readiness_snapshots").insert({
            user_id: userId, score: morning.score, hour, factors: morning.factors,
            recorded_at: recordedAt.toISOString(), kind: "morning",
          });
          results.push({ user_id: userId, status: "ok", detail: `morning=${morning.score} eod=${eod.score}` });
        }
      } else {
        results.push({ user_id: userId, status: "ok", detail: `eod=${eod.score} (morning exists)` });
      }
    } catch (e) {
      console.error(`hourly snapshot error for ${userId}:`, e);
      results.push({ user_id: userId, status: "error", detail: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ count: userIds.size, results }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
