import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { sleepData, sleepScore } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const deepH = (sleepData.deep / 3600).toFixed(1);
    const lightH = (sleepData.light / 3600).toFixed(1);
    const remH = (sleepData.rem / 3600).toFixed(1);
    const awakeH = (sleepData.awake / 3600).toFixed(1);
    const totalH = ((sleepData.deep + sleepData.light + sleepData.rem + sleepData.awake) / 3600).toFixed(1);

    const prompt = `You are a sleep science expert. Analyze this sleep data for ${sleepData.date} and provide a concise, insightful assessment.

Sleep Score: ${sleepScore}/100
Total Sleep: ${totalH}h
Deep Sleep: ${deepH}h
Light Sleep: ${lightH}h  
REM Sleep: ${remH}h
Awake Time: ${awakeH}h

Based on research from the National Sleep Foundation, Mayo Clinic, and Matthew Walker's "Why We Sleep":

Provide your analysis in this format:
1. **Overall Assessment** - One sentence rating this sleep night
2. **Deep Sleep** - Was the deep sleep adequate? (Adults need ~1-2h or 15-20% of total sleep)
3. **REM Sleep** - Was REM adequate? (Adults need ~1.5-2h or 20-25% of total sleep)
4. **Sleep Efficiency** - Comment on awake time relative to total time in bed
5. **Recovery Impact** - How this sleep affects athletic recovery and cognitive performance
6. **Tip** - One specific, actionable improvement suggestion

Keep it concise, evidence-based, and actionable. Reference sleep science where relevant.`;

    const { callAI } = await import("../_shared/ai.ts");
    const response = await callAI({
      stream: true,
      messages: [
        { role: "system", content: "You are a sleep science expert drawing on research from the National Sleep Foundation, Mayo Clinic, and leading sleep researchers like Matthew Walker (UC Berkeley). Be concise and evidence-based." },
        { role: "user", content: prompt },
      ],
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("sleep-insight error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
