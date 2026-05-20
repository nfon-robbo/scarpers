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
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const body = await req.json();
    const score = Number(body.readiness_score ?? body.score);
    const factors = body.factors;
    if (!Number.isFinite(score)) throw new Error("readiness_score required");

    const factorsText = (factors || [])
      .map((f: any) => `${f.label}: ${f.detail} (${f.status})`)
      .join("\n");

    const tier =
      score >= 80
        ? "above 80 — a hard session or race-pace work is appropriate today."
        : score >= 60
        ? "60-80 — normal training is fine, stick to the plan."
        : score >= 40
        ? "40-59 — keep it easy, avoid intervals or threshold work."
        : "below 40 — rest or a very easy walk only.";

    const systemPrompt = `You are the Scarpers readiness coach — direct, knowledgeable, encouraging, grounded in the user's actual data. Output STRICT JSON only — no prose, no markdown, no code fences.

Schema:
{"insight": string, "recommendation": string}

Rules:
- "insight": ONE sentence under 20 words. Name the single most significant factor driving the score and whether it is positive or negative. Cite actual factor values (numbers, percentages). No greetings, no preamble.
- "recommendation": ONE sentence under 20 words. Recommend a training intent for today based on the score band: ${tier}
- Be specific. Do not repeat the score number. Do not use the user's name.`;

    const userPrompt = `Readiness score: ${score}/100\n\nFactors:\n${factorsText || "(none)"}\n\nReturn JSON.`;

    const { callAI } = await import("../_shared/ai.ts");
    const response = await callAI({
      stream: false,
      label: "readiness-coach-insight",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    if (response.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (response.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted" }), {
        status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      // Degrade gracefully — return empty insight so the UI doesn't crash.
      return new Response(JSON.stringify({ insight: "", recommendation: "", fallback: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    let raw: string = data.choices?.[0]?.message?.content || "";
    // Strip code fences if the model wrapped JSON.
    raw = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();

    let insight = "";
    let recommendation = "";
    try {
      const parsed = JSON.parse(raw);
      insight = String(parsed.insight || "").trim();
      recommendation = String(parsed.recommendation || "").trim();
    } catch (err) {
      console.error("readiness-coach-insight: failed to parse JSON", raw);
    }

    return new Response(JSON.stringify({ insight, recommendation }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("readiness-coach-insight error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
