import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";
import { generateText } from "npm:ai";
import { createOpenAICompatible } from "npm:@ai-sdk/openai-compatible";

const BodySchema = z.object({
  percent: z.number(),
  status: z.string(),
  startPercent: z.number(),
  hoursAwake: z.number(),
  sleepHours: z.number(),
  deepPct: z.number(),
  remPct: z.number(),
  hrvVsBaseline: z.string(),
  drainAwake: z.number(),
  drainActive: z.number(),
  prevSleep: z
    .object({ hours: z.number(), deepPct: z.number(), remPct: z.number() })
    .nullable()
    .optional(),
  pattern: z.string(),
});

const SYSTEM_PROMPT = `You are Claire Rayner, an experienced running coach. Write EXACTLY 2-4 sentences analyzing this body battery data. Be direct and conversational. Always use digits for numbers (66%, 11h, not "sixty-six percent" or "eleven hours"). Reference specific values from the data: starting %, hours awake, passive drain %, activity drain %. No generic praise or filler. Example good response: "You're at 66% after 11h awake following a 100% start from excellent sleep (18% deep, 19% REM). The -34% passive drain is normal for this duration, and minimal activity (-3%) kept things steady. This is a healthy evening level with good reserves."`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten().fieldErrors }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const b = parsed.data;
    const r = Math.round;

    const percent = r(b.percent);
    const startPercent = r(b.startPercent);
    const hoursAwake = Math.round(b.hoursAwake * 10) / 10;
    const sleepHours = Math.round(b.sleepHours * 10) / 10;
    const deepPct = r(b.deepPct);
    const remPct = r(b.remPct);
    const drainAwake = r(b.drainAwake);
    const drainActive = r(b.drainActive);

    const prevSleepStr = b.prevSleep
      ? `${Math.round(b.prevSleep.hours * 10) / 10}h (${r(b.prevSleep.deepPct)}% deep, ${r(b.prevSleep.remPct)}% REM)`
      : "none in window";

    const userPrompt = `Current: ${percent}% (${b.status}) after ${hoursAwake}h awake
Started today: ${startPercent}% from ${sleepHours}h sleep (${deepPct}% deep, ${remPct}% REM, HRV ${b.hrvVsBaseline})
Drained: ${drainAwake}% passive + ${drainActive}% activity
Previous sleep: ${prevSleepStr}
Pattern: ${b.pattern}

CRITICAL: Use digits for ALL numbers. Write "66%" not "sixty-six percent", "11h" not "eleven hours".
Explain why the battery is at its current level and whether this is expected.`;

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const provider = createOpenAICompatible({
      name: "lovable",
      baseURL: "https://ai.gateway.lovable.dev/v1",
      headers: {
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
    });

    try {
      const { text } = await generateText({
        model: provider("google/gemini-3-flash-preview"),
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        maxTokens: 300,
      });
      return new Response(JSON.stringify({ insight: (text || "").trim() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("429")) {
        return new Response(JSON.stringify({ error: "Rate limited", code: 429 }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (msg.includes("402")) {
        return new Response(JSON.stringify({ error: "AI credits exhausted", code: 402 }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.error("body-battery-insight AI error:", msg);
      return new Response(JSON.stringify({ error: "AI error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("body-battery-insight error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
