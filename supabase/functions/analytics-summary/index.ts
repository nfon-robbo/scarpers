import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

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

    const body = await req.json().catch(() => ({}));
    const planId: string | null = body.planId ?? null;
    const force: boolean = !!body.force;
    const payload = body.payload ?? {};

    // Cache: return existing summary if generated within last 7 days, unless force.
    if (!force) {
      const { data: existing } = await supabase
        .from("analytics_summaries")
        .select("summary, generated_at")
        .eq("user_id", user.id)
        .eq(planId ? "plan_id" : "user_id", planId || user.id)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing && Date.now() - new Date(existing.generated_at).getTime() < WEEK_MS) {
        return new Response(
          JSON.stringify({ summary: existing.summary, generated_at: existing.generated_at, cached: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const systemPrompt = `You are Claire Rayners, an elite running coach. Write a short, sharp progress summary for the runner.

Rules:
- Output PLAIN TEXT, 3 short paragraphs separated by blank lines, max 140 words total.
- Paragraph 1: Biggest improvement so far — cite an actual number (pace, cadence, IQ, completion rate).
- Paragraph 2: Biggest remaining challenge — be specific and honest.
- Paragraph 3: ONE concrete focus for the coming week.
- No greetings, no markdown, no bullets, no emoji, no sign-off.
- UK spelling. Use "you", never the user's name.`;

    const userPrompt = `Training plan progress data:\n${JSON.stringify(payload).slice(0, 6000)}`;

    const { callAI } = await import("../_shared/ai.ts");
    const response = await callAI({
      stream: false,
      label: "analytics-summary",
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
      console.error("analytics-summary AI error", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const summary: string = (data.choices?.[0]?.message?.content || "").trim();
    if (!summary) throw new Error("Empty AI response");

    const generated_at = new Date().toISOString();
    await supabase.from("analytics_summaries").insert({
      user_id: user.id,
      plan_id: planId,
      summary,
      generated_at,
    });

    return new Response(JSON.stringify({ summary, generated_at, cached: false }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analytics-summary error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
