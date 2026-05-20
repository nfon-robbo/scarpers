import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface Body {
  percent: number;
  status: string;
  hoursAwake: number;
  startPercent: number;
  sleepHours: number;
  deepPct: number;
  remPct: number;
  hrvVsBaseline: string;
  drainAwake: number;
  drainActive: number;
  prevSleep?: { hours: number; deepPct: number; remPct: number } | null;
  pattern: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const b = (await req.json()) as Body;

    const prevSleepStr = b.prevSleep
      ? `${b.prevSleep.hours.toFixed(1)}h (${b.prevSleep.deepPct}% deep, ${b.prevSleep.remPct}% REM)`
      : "none in window";

    const userPrompt = `You are analysing a Body Battery chart for a runner. Provide a 2-4 sentence summary explaining:
- Why the battery is at its current level (${b.percent}%)
- Key factors from the past 48h (sleep quality, time awake, activities)
- Brief context on whether this is expected/concerning

Data:
- Current: ${b.percent}% (${b.status}) after ${b.hoursAwake.toFixed(1)}h awake
- Started today: ${b.startPercent}% from ${b.sleepHours.toFixed(1)}h sleep (${b.deepPct}% deep, ${b.remPct}% REM, HRV ${b.hrvVsBaseline})
- Drained today: ${Math.round(b.drainAwake)}% passive + ${Math.round(b.drainActive)}% activity
- Previous sleep: ${prevSleepStr}
- Chart pattern: ${b.pattern}

Write conversationally, be specific to the data, encouraging but honest. No bullet points, no emojis, no headings. Plain prose, max 4 sentences.`;

    const { callAI } = await import("../_shared/ai.ts");
    const resp = await callAI({
      stream: false,
      label: "body-battery-insight",
      userId: userData.user.id,
      maxTokens: 400,
      messages: [
        { role: "system", content: "You are Claire Rayners, an experienced running coach. Speak warmly and concisely, in 2-4 sentences of plain prose. No markdown, no lists, no emojis." },
        { role: "user", content: userPrompt },
      ],
    });

    if (!resp.ok) {
      const status = resp.status === 429 || resp.status === 402 ? resp.status : 500;
      const error = resp.status === 429 ? "Rate limited" : resp.status === 402 ? "AI credits exhausted" : "AI error";
      return new Response(JSON.stringify({ error, code: resp.status }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await resp.json();
    const insight = data?.choices?.[0]?.message?.content?.trim() || "";
    return new Response(JSON.stringify({ insight }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("body-battery-insight error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
