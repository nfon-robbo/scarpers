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

// Recompute each session's `(Total: Nmin)` heading from the sum of its
// segment-table Duration cells. Mirrors src/lib/plan-validation.ts.
const parseDurSecs = (text: string): number => {
  const cleaned = text.replace(/[()]/g, " ").trim();
  const colon = cleaned.match(/(\d{1,3}):(\d{2})/);
  if (colon) return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  const hour = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hour)s?\b/i);
  const min = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:m|min|minute)s?\b/i);
  const sec = cleaned.match(/(\d+(?:\.\d+)?)\s*(?:s|sec|second)s?\b/i);
  let total = 0;
  if (hour) total += parseFloat(hour[1]) * 3600;
  if (min) total += parseFloat(min[1]) * 60;
  if (sec) total += parseFloat(sec[1]);
  return Math.round(total);
};
const parseSegmentSeconds = (cell: string): number => {
  const c = cell.replace(/×/g, "x");
  const repeat = c.match(/(\d+)\s*x\s*(.+)$/i);
  if (repeat) {
    const reps = parseInt(repeat[1], 10);
    const [w, r] = repeat[2].split(/\s*\/\s*/);
    const ws = parseDurSecs(w || "");
    const rs = parseDurSecs(r || "");
    if (reps && ws) return reps * (ws + rs);
  }
  return parseDurSecs(c);
};
function recomputeSessionTotals(markdown: string): { content: string; corrections: Array<{ day: string; from: number; to: number }> } {
  if (!markdown) return { content: markdown, corrections: [] };
  const lines = markdown.split("\n");
  const corrections: Array<{ day: string; from: number; to: number }> = [];
  let dayIdx = -1, dayLabel = "", daySecs = 0;
  const flush = () => {
    if (dayIdx < 0 || daySecs <= 0) return;
    const heading = lines[dayIdx];
    const m = heading.match(/\(Total:\s*(\d+)\s*min\)/i);
    const newTotal = Math.round(daySecs / 60);
    if (m) {
      const cur = parseInt(m[1], 10);
      if (cur !== newTotal) {
        lines[dayIdx] = heading.replace(/\(Total:\s*\d+\s*min\)/i, `(Total: ${newTotal}min)`);
        corrections.push({ day: dayLabel, from: cur, to: newTotal });
      }
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^###\s+\*\*([^*]+)\*\*/);
    if (h) { flush(); dayIdx = i; dayLabel = h[1].trim(); daySecs = 0; continue; }
    const row = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|/);
    if (!row) continue;
    const seg = row[1], dur = row[2];
    if (/^segment$/i.test(seg) || /^[-:\s]+$/.test(seg)) continue;
    if (/mobility|stretch|foam|yoga/i.test(seg)) continue;
    const secs = parseSegmentSeconds(dur);
    if (secs > 0) daySecs += secs;
  }
  flush();
  return { content: lines.join("\n"), corrections };
}

// Rule 1 — drop duplicate `### **WEEK N**` headings (same week range) and
// duplicate day blocks (same date). Mirrors src/lib/plan-validation.ts.
const MARKDOWN_DAY_HEADING_RE = /^###\s+\*\*([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\*\*/;
const PLAIN_DAY_HEADING_RE = /^([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:[—–-]|:)\s*\S+/;
function matchDayHeading(line: string): { weekday: string; date: string } | null {
  const markdown = line.match(MARKDOWN_DAY_HEADING_RE);
  if (markdown) return { weekday: markdown[1], date: markdown[2] };
  const plain = line.match(PLAIN_DAY_HEADING_RE);
  if (plain) return { weekday: plain[1], date: plain[2] };
  return null;
}

function dedupePlan(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  const dropMask = new Array<boolean>(lines.length).fill(false);
  const seenWeeks = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!/^###\s+\*\*WEEK\s+\d+/i.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    const sub = lines[j]?.match(/^\*Week of\s+(.+?)\*\s*$/i);
    if (!sub) continue;
    const key = sub[1].trim();
    if (seenWeeks.has(key)) {
      dropMask[i] = true; dropMask[j] = true;
      let k = j + 1;
      while (k < lines.length && (lines[k].trim() === "" || lines[k].trim() === "---")) {
        dropMask[k] = true; k++;
        if (lines[k - 1].trim() === "---") break;
      }
    } else seenWeeks.add(key);
  }
  const liveLines = lines.filter((_, i) => !dropMask[i]);
  const seenDates = new Set<string>();
  const out: string[] = [];
  let i = 0;
  while (i < liveLines.length) {
    const m = matchDayHeading(liveLines[i]);
    if (m && seenDates.has(m.date)) {
      // Skip this block until next markdown section heading or date heading.
      i++;
      while (i < liveLines.length && !/^##\s+/.test(liveLines[i]) && !matchDayHeading(liveLines[i])) i++;
      continue;
    }
    if (m) seenDates.add(m.date);
    out.push(liveLines[i]); i++;
  }
  return out.join("\n");
}

// Rule 2 — inject Warm-up/Cool-down rows into running blocks that lack them.
function injectWarmupCooldown(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split("\n");
  const MAIN_RE = /\|\s*(Main\s*Set|Interval(?:\s*Set)?|Threshold|Tempo|Steady|VO2|Hill|Fartlek|Strides|Long\s*Run|Race\s*Pace|Race|Easy\s*Run|Cruise|Sharpening|Repeats?|Reps?|Pre-?Race)\b/i;
  // Find day blocks (reverse to keep indices stable)
  const heads: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^###\s+\*\*[A-Za-z]+\s+\d{1,2}\/\d{1,2}\/\d{4}\*\*/.test(lines[i])) heads.push(i);
  }
  for (let h = heads.length - 1; h >= 0; h--) {
    const s = heads[h];
    const e = h + 1 < heads.length ? heads[h + 1] : lines.length;
    const heading = lines[s];
    if (/race\s*day|rest\s*day/i.test(heading)) continue;
    let firstRow = -1, lastRow = -1, hasMain = false;
    for (let i = s + 1; i < e; i++) {
      const ln = lines[i];
      if (!/^\|/.test(ln)) continue;
      if (/^\|\s*Segment\s*\|/i.test(ln)) continue;
      if (/^\|\s*[-:\s|]+\|\s*$/.test(ln)) continue;
      if (firstRow === -1) firstRow = i;
      lastRow = i;
      if (MAIN_RE.test(ln)) hasMain = true;
    }
    if (firstRow === -1 || !hasMain) continue;
    const hasWU = /^\|\s*Warm-?up\s*\|/i.test(lines[firstRow]);
    const hasCD = /^\|\s*Cool-?down\s*\|/i.test(lines[lastRow]);
    if (hasWU && hasCD) continue;
    let added = 0;
    if (!hasCD) { lines.splice(lastRow + 1, 0, "| Cool-down | 5 min | Walk | 🎵 150 BPM |"); added += 5; }
    if (!hasWU) { lines.splice(firstRow, 0, "| Warm-up | 5 min | Easy walk | 🎵 150 BPM |"); added += 5; }
    if (added > 0) {
      lines[s] = lines[s].replace(/\(Total:\s*(\d+)\s*min\)/i, (_m, n) => `(Total: ${parseInt(n, 10) + added}min)`);
    }
  }
  return lines.join("\n");
}

// Rule 3 — drop sessions on non-scheduled weekdays (unless rest/race day).
const WEEKDAY_SHORT_AA: Record<string, string> = {
  Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday",
  Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
};
const WEEKDAY_LIST_AA = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
function weekdayFromDateAA(dmy: string): string {
  const [d, m, y] = dmy.split("/").map((s) => parseInt(s, 10));
  if (!d || !m || !y) return "";
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (isNaN(dt.getTime())) return "";
  return WEEKDAY_LIST_AA[(dt.getUTCDay() + 6) % 7];
}
function enforceSchedule(markdown: string, trainingDays: string[] | null | undefined): string {
  if (!markdown || !trainingDays?.length) return markdown;
  const allowed = new Set(trainingDays.map((d) => WEEKDAY_SHORT_AA[d] || d));
  const lines = markdown.split("\n");
  const heads: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^###\s+\*\*[A-Za-z]+\s+\d{1,2}\/\d{1,2}\/\d{4}\*\*/.test(lines[i])) heads.push(i);
  }
  const dropMask = new Array<boolean>(lines.length).fill(false);
  for (let h = 0; h < heads.length; h++) {
    const s = heads[h];
    const e = h + 1 < heads.length ? heads[h + 1] : lines.length;
    const m = lines[s].match(/^###\s+\*\*([A-Za-z]+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\*\*/);
    if (!m) continue;
    // Trust the actual calendar weekday, not the label.
    const actual = weekdayFromDateAA(m[2]) || m[1];
    if (allowed.has(actual)) continue;
    if (/race\s*day|rest\s*day/i.test(lines[s])) continue;
    if (actual !== m[1]) {
      console.warn(`[plan-auto-adapt] dropped off-schedule session: label says ${m[1]} but ${m[2]} is ${actual}`);
    }
    for (let k = s; k < e; k++) dropMask[k] = true;
  }
  return lines.filter((_, i) => !dropMask[i]).join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
      .select("id, content, start_date, race_date, race_distance, last_adapted_at, training_days")
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

    // ── Validation pipeline (rules 1–4) ──
    // Rule 1: dedupe duplicate week headings / date blocks
    const beforeDedupe = newContent;
    newContent = dedupePlan(newContent);
    if (newContent !== beforeDedupe) {
      console.warn("[plan-auto-adapt] rule1: deduped duplicate week/date headings");
    }

    // Rule 3: drop sessions on non-scheduled days
    const beforeSched = newContent;
    newContent = enforceSchedule(newContent, (plan as any).training_days);
    if (newContent !== beforeSched) {
      console.warn("[plan-auto-adapt] rule3: removed sessions on non-scheduled days");
    }

    // Rule 2: ensure warm-up / cool-down rows exist on running sessions
    const beforeInject = newContent;
    newContent = injectWarmupCooldown(newContent);
    if (newContent !== beforeInject) {
      console.warn("[plan-auto-adapt] rule2: injected missing warm-up/cool-down rows");
    }

    // Rule 2b: enforce 5-min minimum on existing warm-up / cool-down rows
    const validated = enforceWarmupCooldownMinimums(newContent);
    newContent = validated.content;
    for (const c of validated.corrections) {
      console.warn(
        `[plan-auto-adapt] rule2b: bumped ${c.segment} on ${c.day} from ${c.from} min → ${c.to} min (minimum 5)`
      );
    }

    // Rule 4: recompute each session's `(Total: Nmin)` from segment durations
    const totalsFix = recomputeSessionTotals(newContent);
    newContent = totalsFix.content;
    for (const c of totalsFix.corrections) {
      console.warn(
        `[plan-auto-adapt] rule4: recomputed Total on ${c.day} from ${c.from} min → ${c.to} min (sum of segments)`
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
