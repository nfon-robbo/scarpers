import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
    const sbAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await sbAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { imageDataUrl } = await req.json();
    if (!imageDataUrl || typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return new Response(JSON.stringify({ error: "imageDataUrl required (data:image/... base64)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `Extract sleep vitals from this Garmin Connect sleep screenshot. It may be English.
Return STRICT JSON only — no prose, no code fences — with these keys (use null if not visible):
{
  "breathing_variations": string | null,       // e.g. "Balanced", "Few", "Some", "Many" — as shown
  "restless_moments": number | null,
  "avg_overnight_hr": number | null,           // bpm
  "resting_heart_rate": number | null,         // bpm
  "body_battery_change": number | null,        // signed integer, e.g. +51 -> 51, -10 -> -10
  "avg_spo2": number | null,                   // percent
  "lowest_spo2": number | null,                // percent
  "avg_respiration": number | null,            // brpm
  "lowest_respiration": number | null,         // brpm
  "avg_overnight_hrv": number | null,          // ms
  "hrv_7d_avg": number | null,                 // 7-day average HRV in ms if shown
  "hrv_7d_status": string | null,              // e.g. "Balanced", "Unbalanced", "Low"
  "skin_temp_change_c": number | null          // celsius, signed
}
Do not ignore visible labels like Breathing variations/pattern, Restless moments, 7-day average HRV, HRV status, or Skin temperature. If the screenshot shows a 7-day HRV average value, put the number in hrv_7d_avg even if overnight HRV is not shown.`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You extract structured data from screenshots. Always return strict JSON only." },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.error("AI gateway error:", resp.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error", detail: t }), {
        status: resp.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await resp.json();
    const raw = json?.choices?.[0]?.message?.content ?? "";
    // Strip code fences if present
    const cleaned = String(raw).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // try to find first {...}
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Could not parse AI response as JSON");
      parsed = JSON.parse(m[0]);
    }

    return new Response(JSON.stringify({ vitals: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-garmin-sleep error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
