import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ── Guardrail: enforce 5-min min Warm-up / Cool-down on every running day. ──
interface PlanCorrection {
  day: string;
  segment: "Warm-up" | "Cool-down";
  from: number;
  to: number;
}
function enforceWarmupCooldownMinimums(markdown: string): { content: string; corrections: PlanCorrection[] } {
  if (!markdown) return { content: markdown, corrections: [] };
  const MIN = 5;
  const lines = markdown.split("\n");
  const corrections: PlanCorrection[] = [];
  let dayHeadingIdx = -1;
  let dayLabel = "";
  let dayDelta = 0;
  const flush = () => {
    if (dayHeadingIdx >= 0 && dayDelta !== 0) {
      lines[dayHeadingIdx] = lines[dayHeadingIdx].replace(/\(Total:\s*(\d+)\s*min\)/i, (_m, n) =>
        `(Total: ${parseInt(n, 10) + dayDelta}min)`
      );
    }
    dayDelta = 0;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^###\s+\*\*([^*]+)\*\*/);
    if (h) { flush(); dayHeadingIdx = i; dayLabel = h[1].trim(); continue; }
    const seg = line.match(/^\|\s*(Warm-up|Cool-down)\s*\|\s*([^|]+)\|/i);
    if (!seg) continue;
    const segment = (seg[1].toLowerCase().startsWith("warm") ? "Warm-up" : "Cool-down") as "Warm-up" | "Cool-down";
    const cell = seg[2];
    const num = cell.match(/(\d+)\s*min/i);
    if (!num) continue;
    const cur = parseInt(num[1], 10);
    if (cur >= MIN) continue;
    const newCell = cell.replace(/(\d+)(\s*min)/i, `${MIN}$2`);
    lines[i] = line.replace(cell, newCell);
    dayDelta += MIN - cur;
    corrections.push({ day: dayLabel, segment, from: cur, to: MIN });
  }
  flush();
  return { content: lines.join("\n"), corrections };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const mode: "down" | "up" = body?.mode === "up" ? "up" : "down";
    const reason: string = String(body?.reason || (mode === "down" ? "readiness_low_2d" : "readiness_high_3d_accepted")).slice(0, 80);

    // Load active plan
    const { data: plan, error: planErr } = await supabase
      .from("training_plans")
      .select("id, content, start_date, race_date, race_distance, last_adapted_at")
      .eq("user_id", user.id)
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!plan?.content) {
      return new Response(JSON.stringify({ ok: false, reason: "no_active_plan" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Guard: already adapted today
    if (plan.last_adapted_at) {
      const last = new Date(plan.last_adapted_at);
      const today = new Date();
      if (last.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) {
        return new Response(JSON.stringify({ ok: false, reason: "already_adapted_today" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // Guard: skip taper / race week (last 14 days of plan)
    if (plan.race_date && plan.race_date !== "ai-recommend") {
      const raceMs = new Date(plan.race_date).getTime();
      const daysToRace = (raceMs - Date.now()) / 86400000;
      if (!isNaN(daysToRace) && daysToRace <= 14) {
        return new Response(JSON.stringify({ ok: false, reason: "in_taper_or_race_week" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }
    }

    // Compute current week range (Mon..Sun) and today
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10);
    const day = now.getDay(); // 0..6 (Sun..Sat)
    const monOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + monOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const weekStart = monday.toISOString().slice(0, 10);
    const weekEnd = sunday.toISOString().slice(0, 10);

    const directionRules = mode === "down"
      ? `DOWNWARD ADAPTATION — the athlete's recovery is poor. For each remaining session from ${todayIso} (inclusive) through ${weekEnd} (Sunday) inside the current week:
- Interval / threshold / tempo / VO2 / hill / fartlek sessions → replace TYPE with "Easy run" at the same day, reduce duration to ~85% of original (round to nearest 5 min). Strip any embedded surges or interval syntax.
- Long run → keep as long run, reduce duration to ~85%, remove any embedded surges/intervals (keep it steady easy).
- Easy / recovery runs → reduce duration to ~85% (minimum 20 min). Keep type.
- Rest days, cross-training and strength days → leave untouched.
- DO NOT touch any day before ${todayIso}.
- DO NOT touch any week other than ${weekStart}..${weekEnd}.`
      : `UPWARD ADAPTATION — the athlete is recovering well and trending strongly. From ${todayIso} (inclusive) through ${weekEnd}:
- Pick ONE quality session this week and add +5–10% duration (round to nearest 5 min).
- Pick ONE easy run this week and upgrade it to "Steady run" OR add a short strides finisher (4–6 x 20s strides). Small bump only.
- Never invent a new VO2 / threshold / interval session that wasn't already there.
- Long run unchanged.
- Rest, cross-training, strength untouched.
- DO NOT touch any day before ${todayIso}.
- DO NOT touch any week other than ${weekStart}..${weekEnd}.`;

    const system = `You are a running-coach editor. You receive a training plan written as markdown with 5-column tables (Date | Day | Workout | Duration | Notes). Your job is to surgically modify ONLY the current week of the plan and return the FULL plan content back with edits applied.

CRITICAL RULES:
- Return the complete plan markdown, not a diff and not just the modified week.
- Preserve all existing structure: headings, week summaries, untouched weeks, Intervals.icu code blocks elsewhere in the plan.
- Keep the 5-column table format intact.
- Workout titles must NEVER start with —, –, or -.
- Use UK date format if the original does.
- Include music BPM targets (170–180 spm) only if the original session included them.
- Do not add commentary, do not wrap in code fences, do not add a preamble. Output the plan markdown only.`;

    const userMsg = `${directionRules}

Here is the full plan. Apply the rules above and return the full updated plan:

${plan.content}`;

    const aiRes = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userMsg },
        ],
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      throw new Error(`AI gateway error ${aiRes.status}: ${txt.slice(0, 200)}`);
    }
    const aiJson = await aiRes.json();
    let newContent: string = aiJson?.choices?.[0]?.message?.content || "";
    // Strip accidental code fences
    newContent = newContent.replace(/^```(?:markdown)?\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    if (newContent.length < 50) throw new Error("AI returned empty/short content");

    // Guardrail: enforce 5-min minimum on Warm-up / Cool-down rows.
    const validated = enforceWarmupCooldownMinimums(newContent);
    newContent = validated.content;
    for (const c of validated.corrections) {
      console.warn(
        `[plan-auto-adapt] bumped ${c.segment} on ${c.day} from ${c.from} min → ${c.to} min (minimum 5)`
      );
    }

    // Persist
    const { error: updErr } = await supabase
      .from("training_plans")
      .update({
        content: newContent,
        last_adapted_at: new Date().toISOString(),
        last_adaptation_reason: reason,
      })
      .eq("id", plan.id);
    if (updErr) throw updErr;

    const summary = mode === "down"
      ? "We've adjusted this week's plan based on your recovery. Get some rest and come back stronger."
      : "Plan bumped — go get it.";

    return new Response(
      JSON.stringify({
        ok: true,
        mode,
        reason,
        summary,
        plan_id: plan.id,
        prev_content: plan.content,
        new_content: newContent,
        week_start: weekStart,
        week_end: weekEnd,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (e) {
    console.error("plan-auto-adapt error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as Error)?.message || e) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
