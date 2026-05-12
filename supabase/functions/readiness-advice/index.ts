import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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

    const { readiness_score, factors, current_hour_local, missing_data } = await req.json();

    // Fetch profile and active training plan in parallel
    const [profileRes, planRes] = await Promise.all([
      supabase.from("profiles").select("name, primary_sport").eq("user_id", user.id).maybeSingle(),
      supabase.from("training_plans").select("content, start_date, race_date, training_days")
        .eq("user_id", user.id).eq("archived", false).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const profile = profileRes.data;
    const plan = planRes.data;

    // Extract today's and tomorrow's workouts from the plan content
    let planContext = "";
    if (plan?.content) {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const todayStr = today.toISOString().split("T")[0];
      const tomorrowStr = tomorrow.toISOString().split("T")[0];
      const todayDay = today.toLocaleDateString("en-US", { weekday: "long" });
      const tomorrowDay = tomorrow.toLocaleDateString("en-US", { weekday: "long" });
      
      // Parse the plan content to find workouts for today and tomorrow
      const lines = plan.content.split("\n");
      let currentDate = "";
      let todayWorkout = "";
      let tomorrowWorkout = "";
      let capturing = "";
      
      for (const line of lines) {
        // Match date headers like "### Monday, February 17, 2026" or "**Monday 2026-02-17**"
        const dateMatch = line.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          currentDate = dateMatch[1];
          capturing = currentDate === todayStr ? "today" : currentDate === tomorrowStr ? "tomorrow" : "";
          if (capturing === "today") todayWorkout += line + "\n";
          if (capturing === "tomorrow") tomorrowWorkout += line + "\n";
          continue;
        }
        // Also match day names (e.g., "### Monday" within a week block)
        if (line.match(/^#{1,4}\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)) {
          const dayName = line.match(/(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i)?.[1];
          if (dayName?.toLowerCase() === todayDay.toLowerCase()) capturing = "today";
          else if (dayName?.toLowerCase() === tomorrowDay.toLowerCase()) capturing = "tomorrow";
          else capturing = "";
        }
        
        if (capturing === "today") todayWorkout += line + "\n";
        if (capturing === "tomorrow") tomorrowWorkout += line + "\n";
      }
      
      const trainingDays = plan.training_days || [];
      const todayDayShort = today.toLocaleDateString("en-US", { weekday: "short" });
      const tomorrowDayShort = tomorrow.toLocaleDateString("en-US", { weekday: "short" });
      const isTodayTraining = trainingDays.some((d: string) => d.toLowerCase().startsWith(todayDayShort.toLowerCase()));
      const isTomorrowTraining = trainingDays.some((d: string) => d.toLowerCase().startsWith(tomorrowDayShort.toLowerCase()));
      
      planContext = `\nTRAINING PLAN CONTEXT:`;
      planContext += `\nTraining days: ${trainingDays.join(", ")}`;
      planContext += `\nToday (${todayDay}): ${isTodayTraining ? "TRAINING DAY" : "REST DAY"}`;
      planContext += `\nTomorrow (${tomorrowDay}): ${isTomorrowTraining ? "TRAINING DAY" : "REST DAY"}`;
      if (todayWorkout.trim()) planContext += `\nToday's workout:\n${todayWorkout.trim()}`;
      if (tomorrowWorkout.trim()) planContext += `\nTomorrow's workout:\n${tomorrowWorkout.trim()}`;
      if (!todayWorkout.trim() && isTodayTraining) planContext += `\nToday's workout: Could not parse from plan`;
      if (!tomorrowWorkout.trim() && !isTomorrowTraining) planContext += `\nTomorrow: Rest day (no workout scheduled)`;
    }

    // Fetch sleep stages to determine typical bedtime/wake patterns
    const { data: sleepStages } = await supabase
      .from("sleep_stages")
      .select("date, start_time, end_time, stage")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(200);

    let sleepPatternContext = "";
    if (sleepStages && sleepStages.length > 0) {
      // Group by date, find earliest start and latest end per night
      const byDate: Record<string, { earliest: string; latest: string }> = {};
      for (const s of sleepStages) {
        if (!s.start_time || !s.end_time) continue;
        if (!byDate[s.date]) {
          byDate[s.date] = { earliest: s.start_time, latest: s.end_time };
        } else {
          if (s.start_time < byDate[s.date].earliest) byDate[s.date].earliest = s.start_time;
          if (s.end_time > byDate[s.date].latest) byDate[s.date].latest = s.end_time;
        }
      }
      const dates = Object.keys(byDate).sort().reverse().slice(0, 14);
      if (dates.length >= 3) {
        // Collect actual recent bedtimes and wake times as readable strings
        const recentNights = dates.slice(0, 7).map(d => {
          const bedDt = new Date(byDate[d].earliest);
          const wakeDt = new Date(byDate[d].latest);
          const fmtTime = (dt: Date) => dt.toISOString().slice(11, 16) + " UTC";
          const durationMs = wakeDt.getTime() - bedDt.getTime();
          const durationH = (durationMs / 3600000).toFixed(1);
          return `${d}: bed ${fmtTime(bedDt)}, wake ${fmtTime(wakeDt)}, ~${durationH}h`;
        });
        
        sleepPatternContext = `\nRECENT SLEEP DATA (last ${recentNights.length} nights, times in UTC — convert to local using current_hour_local vs current UTC hour to infer offset):\n${recentNights.join("\n")}`;
        sleepPatternContext += `\nIMPORTANT: Convert all times to the user's local timezone before mentioning them. Use the difference between current_hour_local and the current UTC hour to determine the offset. Never show UTC times to the user.`;
      }
    }

    const isCookedMode = readiness_score <= 20;

    const systemPrompt = isCookedMode
      ? `You are a brutally honest, foul-mouthed but lovable fitness coach AI. Think Gordon Ramsay meets a personal trainer. The user's readiness score is ${readiness_score}/100 — they are absolutely cooked.

Rules:
- Be FUNNY. Use creative insults, mild swearing (shit, damn, hell, ass are fine)
- Reference their ACTUAL data
- Tell them to stop, rest, recover. They are NOT training today.
- Keep it to 2-4 sentences. No headers, no bullet points. Just raw, unfiltered roasting.
- Use the user's name if available
${sleepPatternContext}
${planContext}
${missing_data && missing_data.length > 0 ? `\nCRITICAL: The following data has NOT been synced today: ${missing_data.join(', ')}. Do NOT reference or comment positively on any missing metric.` : ''}`

      : `You are a knowledgeable, practical sports science coach. Tone: supportive, clear, no fluff.

Your job: Give a short readiness verdict — 3-4 sentences, under 75 words total.

Rules:
- Sentence 1: headline reason for the score, citing the single most important metric (e.g. "Deep sleep was only 1% last night").
- Sentence 2: brief "why it matters" — connect that metric to recovery / today's capacity in plain language.
- Sentence 3: one supporting data point (HRV trend, RHR, yesterday's load, sleep duration vs typical) for context.
- Sentence 4: one concrete action for today (rest, easy session, hydrate, bed by Xpm, etc.).
- No preamble ("Good morning…"), no headers, no bullet points, no lists.
- Do NOT restate the score number or list every metric.
- Only reference workouts that ACTUALLY appear in the plan data. If today is a rest day, do not invent one.
- Use the user's first name once, max.
${sleepPatternContext}
${planContext}
${missing_data && missing_data.length > 0 ? `\nCRITICAL: NOT synced today: ${missing_data.join(', ')}. Never reference missing metrics.` : ''}`;

    const factorsText = (factors || []).map((f: any) => `${f.label}: ${f.detail} (${f.status})`).join("\n");

    const userPrompt = `User: ${profile?.name || "champ"}
Sport: ${profile?.primary_sport || "general fitness"}
Current local hour: ${current_hour_local ?? new Date().getHours()}
Readiness score: ${readiness_score}/100

Metrics:
${factorsText || "No detailed metrics available"}

Give me your verdict.`;

    const { callAI } = await import("../_shared/ai.ts");
    const response = await callAI({
      stream: false,
      label: "readiness-advice",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited, try again shortly." }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const advice = data.choices?.[0]?.message?.content || "Get off your ass and do something.";

    return new Response(JSON.stringify({ advice }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("readiness-advice error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
