import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { score, label, pillars, lowest_pillar } = await req.json();

    const { data: profile } = await supabase
      .from("profiles")
      .select("name, primary_sport, experience_level, training_goals")
      .eq("user_id", user.id)
      .maybeSingle();

    const pillarsText = (pillars || [])
      .map((p: any) => `- ${p.name}: ${p.score}/100 (${Math.round(p.weight * 100)}% weight)`)
      .join("\n");

    const systemPrompt = `You are a sharp, practical running coach. Your job is to explain to the runner — in 3-5 short bullet points — exactly how they can raise their Running IQ score.

Rules:
- Output 3-5 bullet points only. No intro, no outro, no headers.
- Each bullet: ONE specific, actionable change. Be concrete (distances, frequency, weeks).
- Prioritise the LOWEST-scoring pillar first.
- Reference the actual pillar names (Fitness, Volume, Consistency, Form, Recovery).
- If Volume is low → suggest gradual weekly km increase (≤10% per week).
- If Consistency is low → suggest a realistic weekly run count.
- If Form is low → cadence drills (170-180 spm), strides, easy-pace HR efficiency.
- If Recovery is low → sleep, easy days, HRV trend.
- If Fitness is low → VO₂ work (strides, intervals) only if base allows.
- Keep total response under 120 words.
- Use UK spelling. No emojis.`;

    const userPrompt = `Runner: ${profile?.name || "athlete"}
Experience: ${profile?.experience_level || "intermediate"}
Sport: ${profile?.primary_sport || "running"}
Goals: ${profile?.training_goals || "general fitness"}

Current Running IQ: ${score}/200 (${label})
Weakest pillar: ${lowest_pillar || "unknown"}

Pillar breakdown:
${pillarsText}

How can they raise their score?`;

    const { callAI } = await import("../_shared/ai.ts");
    const response = await callAI({
      stream: false,
      label: "running-iq-advice",
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
    const advice = data.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ advice }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("running-iq-advice error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
