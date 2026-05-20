import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function distanceKm(rd: string): number {
  const d = String(rd || "").toLowerCase();
  if (d.includes("marathon") && !d.includes("half")) return 42.195;
  if (d.includes("half")) return 21.0975;
  if (d.includes("10")) return 10;
  if (d.includes("5")) return 5;
  return 10;
}
function normaliseDist(rd: string): string {
  const d = String(rd || "").toLowerCase();
  if (d.includes("marathon") && !d.includes("half")) return "Marathon";
  if (d.includes("half")) return "Half Marathon";
  if (d.includes("10")) return "10K";
  return "5K";
}
function vo2to5k(vo2: number): number {
  const a: Array<[number, number]> = [[30,2700],[35,2220],[42,1770],[50,1410],[55,1260],[60,1140]];
  if (vo2 <= a[0][0]) return a[0][1];
  if (vo2 >= a[a.length-1][0]) return a[a.length-1][1];
  for (let i = 0; i < a.length-1; i++) {
    if (vo2 >= a[i][0] && vo2 <= a[i+1][0])
      return a[i][1] + ((vo2-a[i][0])/(a[i+1][0]-a[i][0]))*(a[i+1][1]-a[i][1]);
  }
  return 1800;
}
const riegel = (t: number, d1: number, d2: number) => t * Math.pow(d2/d1, 1.06);
function parseGoalSec(g: string | null | undefined): number | null {
  if (!g) return null;
  const m = String(g).match(/(\d+):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return m[3] ? +m[1]*3600 + +m[2]*60 + +m[3] : +m[1]*60 + +m[2];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const requestedDist = normaliseDist(body.race_distance || "");

    const [{ data: plan }, { data: profile }] = await Promise.all([
      supabase.from("training_plans").select("content, start_date, race_date, race_distance, goal_time, training_days")
        .eq("user_id", user.id).eq("archived", false).order("created_at",{ ascending: false }).limit(1).maybeSingle(),
      supabase.from("profiles").select("athlete_context").eq("user_id", user.id).maybeSingle(),
    ]);

    const raceDistance = body.race_distance ? requestedDist : (normaliseDist(plan?.race_distance || "10K"));
    const dKm = distanceKm(raceDistance);

    const since = new Date(); since.setDate(since.getDate() - 56);
    const [{ data: activities }, { data: metrics }, { data: readiness }] = await Promise.all([
      supabase.from("activities").select("activity_type,distance_meters,duration_seconds,avg_heart_rate,start_time,created_at")
        .eq("user_id", user.id).gte("start_time", since.toISOString()).order("start_time",{ ascending:false }),
      supabase.from("daily_metrics").select("vo2_max,date").eq("user_id", user.id).order("date",{ ascending:false }).limit(14),
      supabase.from("readiness_snapshots").select("score,recorded_at").eq("user_id", user.id).order("recorded_at",{ ascending:false }).limit(7),
    ]);

    const now = Date.now();
    const within = (a: any, days: number) => a.start_time && now - new Date(a.start_time).getTime() <= days*86400000;
    const runs = (activities||[]).filter((a) => /run/i.test(a.activity_type||"") && +a.distance_meters > 800 && +a.duration_seconds > 300);
    const last21 = runs.filter((a) => within(a, 21));

    // Sessions completed/planned (counts non-rest plan day-headings vs runs since start_date)
    let completedSessions = 0, plannedSessions = 0;
    if (plan?.start_date) {
      const startDate = new Date(plan.start_date);
      const todayStr = new Date().toISOString().slice(0,10);
      const re = /^#{2,4}\s+.*?\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b.*$/gm;
      const matches = Array.from(String(plan.content||"").matchAll(re));
      for (const m of matches) {
        const dateIso = `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
        if (dateIso > todayStr) continue;
        const idx = m.index ?? 0;
        const blockEnd = String(plan.content).indexOf("\n##", idx + 1);
        const block = String(plan.content).slice(idx, blockEnd === -1 ? undefined : blockEnd);
        if (/\brest\b/i.test(block.split("\n")[0])) continue;
        plannedSessions++;
      }
      completedSessions = runs.filter((a) => new Date(a.start_time) >= startDate).length;
    }

    const goalSec = parseGoalSec(plan?.goal_time);

    if (last21.length < 3) {
      return new Response(JSON.stringify({
        insufficient: true,
        race_distance: raceDistance,
        distance_km: dKm,
        goal_time_sec: goalSec,
        goal_time: plan?.goal_time || null,
        completed_sessions: completedSessions,
        planned_sessions: plannedSessions,
        runs_in_last_21d: last21.length,
        message: `Need at least 3 completed runs in the last 21 days. You have ${last21.length}.`,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const paceOf = (a: any) => +a.duration_seconds / (+a.distance_meters / 1000);
    const easyCandidates = last21
      .filter((a) => !a.avg_heart_rate || +a.avg_heart_rate <= 150)
      .map(paceOf).filter((p) => isFinite(p) && p > 240 && p < 900).sort((a,b)=>a-b);
    const easyPace = easyCandidates.length ? easyCandidates[Math.floor(easyCandidates.length/2)] : null;

    const tempoCandidates = runs.filter((a) => within(a,14) && +a.duration_seconds >= 900)
      .map(paceOf).filter((p)=>isFinite(p) && p > 180 && p < 600).sort((a,b)=>a-b);
    const tempoPace = tempoCandidates.length ? tempoCandidates[0] : null;

    const vo2 = (metrics||[]).find((m:any)=>m.vo2_max!=null)?.vo2_max;
    const vo2Num = vo2 != null ? +vo2 : null;

    const estimates: Array<{src:string;time:number;w:number}> = [];
    if (tempoPace) {
      const off: Record<string,number> = { "5K":-15,"10K":-8,"Half Marathon":5,"Marathon":20 };
      estimates.push({ src:"tempo", time:(tempoPace + (off[raceDistance]??0))*dKm, w:0.5 });
    }
    if (vo2Num) {
      const t5 = vo2to5k(vo2Num);
      estimates.push({ src:"vo2max", time: dKm===5 ? t5 : riegel(t5,5,dKm), w:0.3 });
    }
    if (easyPace) {
      const off: Record<string,number> = { "5K":-75,"10K":-75,"Half Marathon":-90,"Marathon":-90 };
      estimates.push({ src:"easy", time:(easyPace + (off[raceDistance]??-75))*dKm, w:0.2 });
    }
    if (!estimates.length) {
      return new Response(JSON.stringify({
        insufficient: true, race_distance: raceDistance, distance_km: dKm,
        goal_time_sec: goalSec, goal_time: plan?.goal_time || null,
        completed_sessions: completedSessions, planned_sessions: plannedSessions,
        runs_in_last_21d: last21.length,
        message: "Not enough pace data yet.",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const totalW = estimates.reduce((s,e)=>s+e.w,0);
    let T = estimates.reduce((s,e)=>s+e.time*e.w,0)/totalW;

    let weeksCompleted = 0;
    if (plan?.start_date) {
      weeksCompleted = Math.max(0, (Date.now() - new Date(plan.start_date).getTime())/(7*86400000));
      T *= 1 - Math.min(weeksCompleted*0.0125, 0.08);
    }
    let adherence = 1;
    if (plannedSessions > 0) {
      adherence = Math.min(1, completedSessions / plannedSessions);
      if (adherence < 0.7) T *= 1 + (0.7 - adherence) * 0.33;
    }
    const meanReadiness = (readiness||[]).length ? (readiness||[]).reduce((s:number,r:any)=>s+ +r.score,0)/(readiness||[]).length : null;
    if (meanReadiness != null) {
      if (meanReadiness < 55) T *= 1.02;
      else if (meanReadiness > 80) T *= 0.99;
    }

    const conservative = T * 1.04;
    const stretch = T * 0.97;
    const paceSecPerKm = T / dKm;

    const hasIntensity = tempoCandidates.length > 0 && runs.some((a)=>within(a,14) && +a.avg_heart_rate >= 160);
    let confidence: "HIGH"|"MEDIUM"|"LOW" = "LOW";
    if (hasIntensity && last21.length >= 6) confidence = "HIGH";
    else if (last21.length >= 4 || vo2Num) confidence = "MEDIUM";
    if (weeksCompleted < 3 && !vo2Num) confidence = "LOW";

    const basis: string[] = [];
    if (tempoPace) basis.push(`tempo ${Math.floor(tempoPace/60)}:${String(Math.round(tempoPace%60)).padStart(2,"0")}/km`);
    if (vo2Num) basis.push(`VO2max ${Math.round(vo2Num)}`);
    if (easyPace) basis.push(`easy ${Math.floor(easyPace/60)}:${String(Math.round(easyPace%60)).padStart(2,"0")}/km`);

    return new Response(JSON.stringify({
      insufficient: false,
      race_distance: raceDistance, distance_km: dKm,
      target_sec: T, conservative_sec: conservative, stretch_sec: stretch,
      pace_sec_per_km: paceSecPerKm,
      confidence, basis,
      goal_time_sec: goalSec, goal_time: plan?.goal_time || null,
      completed_sessions: completedSessions, planned_sessions: plannedSessions,
      runs_in_last_21d: last21.length,
      weeks_completed: Math.round(weeksCompleted),
      adherence,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message || "predict failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
