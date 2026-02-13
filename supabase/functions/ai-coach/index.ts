import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { type } = await req.json();
    // type: "analysis" | "training-plan"

    // Fetch user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fetch activities (last 56 days)
    const since = new Date();
    since.setDate(since.getDate() - 56);
    const { data: activities } = await supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .gte("start_time", since.toISOString())
      .order("start_time", { ascending: false });

    if (!activities || activities.length === 0) {
      return new Response(
        JSON.stringify({ error: "No activities found. Please upload FIT files first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build activity summary for the AI
    const activitySummary = (activities || []).map((a: any) => ({
      date: a.start_time?.split("T")[0],
      type: a.activity_type || "unknown",
      duration_min: a.duration_seconds ? Math.round(a.duration_seconds / 60) : null,
      distance_km: a.distance_meters ? (a.distance_meters / 1000).toFixed(1) : null,
      avg_hr: a.avg_heart_rate ? Math.round(a.avg_heart_rate) : null,
      max_hr: a.max_heart_rate ? Math.round(a.max_heart_rate) : null,
      avg_speed: a.avg_speed ? Number(a.avg_speed).toFixed(1) : null,
      avg_power: a.avg_power ? Math.round(a.avg_power) : null,
      calories: a.calories ? Math.round(a.calories) : null,
      total_ascent: a.total_ascent ? Math.round(a.total_ascent) : null,
      cadence: a.avg_cadence ? Math.round(a.avg_cadence) : null,
      training_effect: a.training_effect,
    }));

    const athleteContext = `
Athlete: ${profile?.name || "Unknown"}
Primary Sport: ${profile?.primary_sport || "running"}
Experience: ${profile?.experience_level || "intermediate"}
Goals: ${profile?.training_goals || "general fitness"}
Additional Context: ${profile?.athlete_context || "none"}
`;

    const dataContext = `
TRAINING DATA (last ${activities.length} activities over ~8 weeks):
${JSON.stringify(activitySummary, null, 2)}
`;

    let systemPrompt: string;
    let userPrompt: string;

    if (type === "analysis") {
      systemPrompt = `You are an elite endurance coach AI, modeled after the garmin-ai-coach system. You perform multi-domain training analysis.

Your analysis must cover these domains in separate sections:

## 📊 KPI Dashboard Summary
Summarize: training load trends (chronic vs acute), training frequency, volume trends, intensity distribution. Calculate approximate ACWR (Acute:Chronic Workload Ratio) if enough data exists.

## 🏃 Execution Analysis  
Analyze: pace/speed progression, heart rate efficiency (aerobic decoupling indicators), power trends if available, cadence patterns. Provide evidence-based progression tracking.

## 🫀 Physiology & Readiness
Analyze: heart rate trends (resting HR proxy from avg HR patterns), recovery patterns (days between hard sessions), any crash signatures (sudden drops in performance/consistency), fatigue indicators.

## 💡 Actionable Recommendations
Group into categories:
- **Load Management**: training volume/intensity adjustments
- **Running/Cycling**: sport-specific technique and training suggestions  
- **Recovery**: rest, adaptation, injury prevention
- **Performance**: key workouts to add or modify

Use specific numbers from the data. Be direct and actionable. Format with markdown. Use emoji headers.`;

      userPrompt = `${athleteContext}

${dataContext}

Analyze this training data and provide a comprehensive multi-domain analysis report. Be specific, reference actual data points, and provide actionable coaching insights.`;
    } else {
      // training-plan
      systemPrompt = `You are an elite endurance coach AI that generates periodized training plans, modeled after the garmin-ai-coach system.

Based on the athlete's data and goals, generate:

## 📅 Season Strategy Overview
Create a macro-cycle plan (12-24 weeks) with:
- Phase architecture (base, build, peak, taper, race)
- Key training blocks and their focus
- Volume/intensity progression targets
- Race anchors and key dates

## 📋 4-Week Training Plan
Generate a detailed 28-day plan in this format for each day:

### Week 1: [Theme]
**Monday** - [Rest/Active Recovery/Workout Type]
- Description of the session
- Target zones/paces/power
- Duration and key metrics to hit

Continue for all 28 days across 4 weeks.

Include:
- Progression across weeks (build weeks + recovery week)
- Specific intensity zones (Z1-Z5)
- Session RPE targets
- Weekly volume targets
- Adaptation goals per week

Be specific with paces, durations, and intensities. Use the athlete's actual performance data to set realistic targets.`;

      userPrompt = `${athleteContext}

${dataContext}

Generate a comprehensive season strategy and detailed 4-week training plan. Base all targets on the actual performance data above. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    }

    // Stream from Lovable AI
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings → Workspace → Usage." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI gateway error");
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("ai-coach error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
