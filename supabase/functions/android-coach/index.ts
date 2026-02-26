import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const ANDROID_API_KEY = Deno.env.get("ANDROID_API_KEY");
    if (!ANDROID_API_KEY) throw new Error("ANDROID_API_KEY not configured");

    const body = await req.json();

    // Validate API key
    if (body.api_key !== ANDROID_API_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid API key" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      type,
      race_distance,
      training_days,
      start_date,
      race_date,
      message,
      athlete,
      activities,
      metrics,
    } = body;

    // Build athlete context from request body
    const athleteContext = `
Athlete: ${athlete?.name || "Unknown"}
Primary Sport: ${athlete?.sport || "running"}
Experience: ${athlete?.experience || "intermediate"}
Goals: ${athlete?.goals || "general fitness"}
Additional Context: ${athlete?.context || "none"}
`;

    // Build data context from optional arrays
    let dataContext = "";
    if (activities && Array.isArray(activities) && activities.length > 0) {
      dataContext += `\nTRAINING DATA (${activities.length} activities):\n${JSON.stringify(activities, null, 2)}\n`;
    }
    if (metrics && Array.isArray(metrics) && metrics.length > 0) {
      dataContext += `\nDAILY HEALTH METRICS (${metrics.length} days):\n${JSON.stringify(metrics, null, 2)}\n`;
    }

    let systemPrompt: string;
    let userPrompt: string;

    if (type === "training-plan") {
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";
      const planStart = start_date || new Date().toISOString().split("T")[0];
      const [y, m, d] = planStart.split("-");
      const planStartUK = `${d}/${m}/${y}`;

      const isAIDecide = race_date === "ai-recommend";

      let raceDateInstruction: string;
      if (isAIDecide) {
        raceDateInstruction = `The athlete has NOT set a race date. You MUST:
1. Analyze their activity history, health metrics, paces, cadence, HR patterns, training consistency, longest runs, and overall fitness.
2. Determine how many weeks of training they need before racing a ${raceLabel}.
3. Recommend a specific race date and explain your reasoning.
4. Generate the COMPLETE training plan from start to race date.`;
      } else if (race_date) {
        const [ry, rm, rd] = (race_date as string).split("-");
        const raceDateUK = `${rd}/${rm}/${ry}`;
        raceDateInstruction = `Target race date: ${raceDateUK}. Plan training to peak for this date with appropriate taper.`;
      } else {
        raceDateInstruction = `No race date specified. Suggest a realistic timeline.`;
      }

      const planLengthInstruction = isAIDecide
        ? `Generate the FULL training plan from start date to race date. Every week must have detailed daily workouts.`
        : `Generate a detailed 28-day plan starting from ${planStart}. Only schedule workouts on: ${daysStr}. All other days are rest/recovery.`;

      systemPrompt = `You are an elite endurance coach AI that generates periodized training plans for a ${raceLabel} race.

The athlete trains on these days: ${daysStr}. All other days should be rest or active recovery. The plan starts on ${planStartUK}.

RACE DATE: ${raceDateInstruction}

CRITICAL INSTRUCTIONS:
- Review the athlete's profile, especially "Additional Context" for injuries or limitations. Adapt every workout accordingly.
- Base all targets on actual performance data if provided, not generic estimates.
- Structure each workout with clear segments: Warm-up → Main set → Cool-down
- For each segment specify: duration OR distance, target HR zone (Z1-Z5) or target pace range
- HR zones: Z1 (50-60% max HR), Z2 (60-70%), Z3 (70-80%), Z4 (80-90%), Z5 (90-100%)

${isAIDecide ? `## 🏥 Fitness Assessment
Assess the athlete's current fitness from their data before creating the plan.

## ⏱️ Recommended Training Duration
State how many weeks are needed and recommend a specific race date (DD/MM/YYYY).

` : ''}## 📅 Season Strategy Overview
Create a macro-cycle plan with phase architecture (base, build, peak, taper, race).

## 📋 ${isAIDecide ? 'Complete' : '4-Week'} Training Plan
${planLengthInstruction}

CRITICAL FORMAT RULES:
1. EVERY workout day MUST have a full markdown table with Segment/Duration/Target/HR Zone/Notes columns.
2. EVERY workout title MUST include total duration as "(Total: Xmin)".
3. EVERY running segment Notes column MUST include a music BPM target: Z1=🎵150, Z2=🎵155, Z3=🎵165, Z4=🎵170, Z5=🎵175.
4. Use UK date format (DD/MM/YYYY).

### Week 1: [Theme]
**Monday ${planStartUK}** - [Workout Type] (Total: 40min)
| Segment | Duration/Distance | Target | HR Zone | Notes |
|---------|-------------------|--------|---------|-------|
| Warm-up | 10 min | easy pace | Z1-Z2 | 🎵 150 BPM |
| Main | 3 x 1km | 5:30/km | Z4 | 🎵 170 BPM; 90s jog recovery |
| Cool-down | 10 min | easy pace | Z1 | 🎵 150 BPM |

Include progression, RPE targets, weekly volume targets, and injury accommodations.`;

      userPrompt = `${athleteContext}

${dataContext}

Generate a comprehensive ${raceLabel} training plan starting ${planStart}. Schedule workouts only on ${daysStr}. Today's date is ${new Date().toISOString().split("T")[0]}.`;

    } else if (type === "chat") {
      systemPrompt = `You are an elite endurance coach AI assistant with deep knowledge of training science, nutrition, recovery, and race preparation.

BREVITY RULES (strict):
- Maximum 3-5 bullet points per answer
- NO long paragraphs — bullet points only
- Lead with the answer, then supporting data
- Total response UNDER 150 words
- Only use headers if the user asks a complex multi-part question
- Reference specific data points if available but keep each bullet to one line
- Be practical and actionable — no filler or preamble

${athleteContext}

${dataContext}`;

      userPrompt = message || "Hello, I'd like some coaching advice.";
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "training-plan" or "chat".' }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call AI gateway (non-streaming)
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
        stream: false,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ success: false, error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ success: false, error: "AI credits exhausted." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const text = await response.text();
      console.error("AI gateway error:", response.status, text);
      throw new Error("AI gateway error");
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({ success: true, type, content }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("android-coach error:", e);
    return new Response(
      JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
