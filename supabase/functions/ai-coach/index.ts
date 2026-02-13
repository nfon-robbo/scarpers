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

    const { type, race_distance, training_days, start_date, race_date, current_plan, adjustment, review_text } = await req.json();
    // type: "analysis" | "training-plan" | "plan-review" | "plan-adjust"

    // Fetch user profile
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // For plan-review: fetch the current plan's ID and only use linked activities
    // For AI-decide: fetch ALL activities for full fitness picture
    // Otherwise: fetch last 56 days for the 4-week plan
    const isAIDecide = race_date === "ai-recommend";
    const isPlanReview = type === "plan-review";

    let activitiesQuery = supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .order("start_time", { ascending: false });

    if (isPlanReview) {
      // Get the user's current plan ID to filter linked activities
      const { data: currentPlanData } = await supabase
        .from("training_plans")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (currentPlanData) {
        activitiesQuery = activitiesQuery.eq("training_plan_id", currentPlanData.id);
      }
    } else if (!isAIDecide) {
      const since = new Date();
      since.setDate(since.getDate() - 56);
      activitiesQuery = activitiesQuery.gte("start_time", since.toISOString());
    }

    const { data: activities } = await activitiesQuery;

    if (isPlanReview && (!activities || activities.length === 0)) {
      return new Response(
        JSON.stringify({ error: "No activities linked to your plan. Go to Activities and tick the 'Plan' checkbox on workouts you've completed for this plan." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!activities || activities.length === 0) {
      return new Response(
        JSON.stringify({ error: "No activities found. Please upload FIT files first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch daily metrics for health/readiness context
    let metricsContext = "";
    if (isAIDecide) {
      const { data: metrics } = await supabase
        .from("daily_metrics")
        .select("*")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(90);

      if (metrics && metrics.length > 0) {
        const metricsSummary = metrics.map((m: any) => ({
          date: m.date,
          resting_hr: m.resting_heart_rate ? Math.round(m.resting_heart_rate) : null,
          hrv: m.hrv ? Math.round(m.hrv) : null,
          sleep_hours: m.sleep_duration_seconds ? (m.sleep_duration_seconds / 3600).toFixed(1) : null,
          sleep_score: m.sleep_score,
          stress: m.stress_score,
          steps: m.steps,
          weight: m.weight,
        }));
        metricsContext = `\nDAILY HEALTH METRICS (last ${metrics.length} days):\n${JSON.stringify(metricsSummary, null, 2)}\n`;
      }
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
TRAINING DATA (${activities.length} activities${isAIDecide ? " - full history" : " over ~8 weeks"}):
${JSON.stringify(activitySummary, null, 2)}
${metricsContext}`;

    let systemPrompt: string;
    let userPrompt: string;

    const isPlanAdjust = type === "plan-adjust";

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
    } else if (type === "plan-review") {
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";

      systemPrompt = `You are an elite endurance coach AI reviewing an athlete's progress against their training plan for a ${raceLabel} race.

You have been given:
1. The athlete's CURRENT TRAINING PLAN (what they were supposed to do)
2. Their ACTUAL ACTIVITY DATA (what they actually did)

Your job is to compare planned vs actual and provide a progress review. Be specific and reference actual dates and numbers.

IMPORTANT: Do NOT generate a revised plan. Only analyse and recommend. The athlete will decide whether to apply changes.

Your response MUST include these sections:

## 📊 Progress Summary
- How many planned sessions were completed vs missed
- Overall adherence percentage
- Volume comparison (planned vs actual km/time)

## ✅ What Went Well
- Sessions that were completed on target or exceeded expectations
- Positive trends in pace, HR efficiency, or consistency

## ⚠️ What Needs Attention
- Missed sessions and their impact
- Sessions done but significantly off target (pace, HR, duration)
- Any concerning patterns (overtraining, undertraining, intensity creep)

## 🔄 Recommended Adjustments
Based on the progress review, clearly state one of these verdicts:
- **ON TRACK**: The plan is working well. No changes needed — continue as written.
- **MAKE EASIER**: The athlete is struggling. Explain specifically what should be scaled back (reduced volume, lower intensity, more recovery days) and why.
- **MAKE HARDER**: The athlete is ahead of schedule. Explain what should be progressed (increased volume, higher intensity, additional quality sessions) and why.

Be specific about WHAT would change and WHY, but do NOT output the revised plan yet.

## 💡 Coach's Notes
Personal advice, motivation, or specific technique cues based on what you've observed.`;

      userPrompt = `${athleteContext}

${dataContext}

CURRENT TRAINING PLAN:
${current_plan || "No plan provided"}

Review this athlete's progress against their training plan. Compare what was planned vs what was actually done. Determine if the plan needs adjusting but do NOT generate a revised plan. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else if (isPlanAdjust) {
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      const daysStr = (training_days as string[] | undefined)?.length
        ? (training_days as string[]).join(", ")
        : "Mon, Wed, Fri, Sat";

      const adjustmentDirection = (adjustment as string) || "apply";
      let adjustInstruction = "";
      if (adjustmentDirection === "easier") {
        adjustInstruction = "The athlete has requested the plan be made EASIER. Reduce volume, lower intensity, add more recovery days, and scale back ambitious targets. Be conservative.";
      } else if (adjustmentDirection === "harder") {
        adjustInstruction = "The athlete has requested the plan be made HARDER. Increase volume, raise intensity, add quality sessions, and push targets up. The athlete is ready for more.";
      } else {
        adjustInstruction = "Apply the recommended adjustments from the review as-is.";
      }

      systemPrompt = `You are an elite endurance coach AI adjusting a ${raceLabel} training plan based on a progress review.

${adjustInstruction}

You have been given:
1. The ORIGINAL TRAINING PLAN
2. The PROGRESS REVIEW with analysis
3. The athlete's ACTIVITY DATA

Generate a COMPLETE REVISED training plan for the remaining weeks. 

CRITICAL FORMAT RULES: 
1. EVERY workout MUST have a full markdown table with Segment/Duration/Target/HR Zone/Notes columns.
2. Use UK date format (DD/MM/YYYY) for all dates.
3. Only schedule workouts on: ${daysStr}.
4. EVERY workout title MUST include the total duration as "(Total: Xmin)".
5. Include the Season Strategy Overview section before the weekly plan.
6. Start from the next upcoming week based on today's date.`;

      userPrompt = `${athleteContext}

${dataContext}

ORIGINAL TRAINING PLAN:
${current_plan || "No plan provided"}

PROGRESS REVIEW:
${review_text || "No review provided"}

Generate the complete revised ${raceLabel} training plan based on the review and the ${adjustmentDirection} adjustment requested. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else {
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
      // Convert to UK format for display
      const [y, m, d] = planStart.split("-");
      const planStartUK = `${d}/${m}/${y}`;
      let raceDateInstruction: string;
      if (race_date === "ai-recommend") {
        raceDateInstruction = `The athlete has NOT set a race date. You MUST:
1. Thoroughly analyze ALL their activity history, health metrics, average paces, cadence, heart rate patterns, training consistency, longest runs, and overall fitness level.
2. Determine how many weeks of training they realistically need before they can race a ${raceLabel} at their best — this could be anywhere from 4 to 24+ weeks depending on their current fitness.
3. Recommend a specific race date based on your analysis and explain your reasoning clearly.
4. Generate the COMPLETE training plan from the start date to the race date — NOT just 4 weeks. Every single week must be detailed with daily workouts.`;
      } else if (race_date) {
        const [ry, rm, rd] = (race_date as string).split("-");
        const raceDateUK = `${rd}/${rm}/${ry}`;
        raceDateInstruction = `The athlete's target race date is ${raceDateUK}. Plan the training to peak for this date, including appropriate taper.`;
      } else {
        raceDateInstruction = `No race date specified. Suggest a realistic timeline.`;
      }

      const planLengthInstruction = isAIDecide
        ? `Generate the FULL training plan from start date to race date. Every week must have detailed daily workouts. Do NOT limit to 4 weeks — output the complete plan for however many weeks are needed.`
        : `Generate a detailed 28-day plan starting from ${planStart}. Only schedule workouts on: ${daysStr}. All other days are rest/recovery.`;

      systemPrompt = `You are an elite endurance coach AI that generates periodized training plans for a ${raceLabel} race, modeled after the garmin-ai-coach system.

The athlete trains on these days: ${daysStr}. All other days should be rest or active recovery. The plan starts on ${planStartUK}.

RACE DATE: ${raceDateInstruction}

CRITICAL INSTRUCTIONS:
- Carefully review the athlete's profile, especially "Additional Context" which may contain injuries, physical limitations, or health conditions. You MUST adapt every workout to account for these. If an injury is mentioned, include modifications, reduced intensity, or alternative exercises.
- Review ALL activity data to understand the athlete's current fitness level, typical paces, heart rate zones, and recent training load. Base all targets on their ACTUAL performance, not generic estimates.
- The athlete uses an Amazfit Balance 2 watch with the Zepp app. Structure each workout so it can be manually created as a custom workout in the Zepp app:
  - Break workouts into clear segments: Warm-up → Main set (with intervals if applicable) → Cool-down
  - For each segment specify: duration OR distance, target HR zone (Z1-Z5) or target pace range
  - For interval sessions, clearly state: number of reps, work duration/distance, recovery duration/distance, target pace/HR for each
  - Use the Zepp-compatible HR zones: Z1 (50-60% max HR), Z2 (60-70%), Z3 (70-80%), Z4 (80-90%), Z5 (90-100%)

Based on the athlete's data and goals, generate a plan specifically targeting a ${raceLabel}:

${isAIDecide ? `## 🏥 Fitness Assessment
Before creating the plan, provide a detailed assessment of the athlete's current fitness:
- Current estimated VO2max / fitness level based on pace and HR data
- Average run distance, pace, and cadence
- Longest recent run and how it compares to ${raceLabel} distance
- Heart rate trends and aerobic base status
- Training consistency and volume over time
- Health indicators (sleep, HRV, resting HR, stress) if available
- Overall readiness assessment for ${raceLabel}

## ⏱️ Recommended Training Duration
Based on the fitness assessment above:
- State exactly how many weeks of training are needed and why
- Recommend a specific race date (DD/MM/YYYY format)
- Explain the reasoning behind the timeline

` : ''}## 📅 Season Strategy Overview
Create a macro-cycle plan with:
- Phase architecture (base, build, peak, taper, race) tailored for ${raceLabel}
- Key training blocks and their focus
- Volume/intensity progression targets appropriate for ${raceLabel} distance
- Any modifications needed based on the athlete's injuries or limitations

## 📋 ${isAIDecide ? 'Complete' : '4-Week'} Training Plan
${planLengthInstruction}

CRITICAL FORMAT RULES:
1. EVERY single workout day MUST have a full markdown table with Segment/Duration/Target/HR Zone/Notes columns. Do NOT use compact one-liner formats like "Easy Run (30 min) @ Z2". Even simple easy runs must have a table with at least Warm-up, Main, and Cool-down rows. This is required for watch sync to work. No exceptions for any week.
2. EVERY workout title line MUST include the total duration in the format "(Total: Xmin)" — calculate this by summing all segment durations including warm-up, main set, and cool-down. This is mandatory for every single workout. For interval sessions, include the recovery time in the total.

For each workout day, use this Zepp-compatible format. IMPORTANT: Use UK date format (DD/MM/YYYY) for all dates:

### Week 1: [Theme]
**Monday ${planStartUK}** - [Workout Type] (Total: 40min)
| Segment | Duration/Distance | Target | HR Zone | Notes |
|---------|-------------------|--------|---------|-------|
| Warm-up | 10 min | easy pace | Z1-Z2 | |
| Main | 3 x 1km | 5:30/km | Z4 | 90s jog recovery |
| Cool-down | 10 min | easy pace | Z1 | |

EVERY workout in EVERY week must follow this exact table format. Continue for all weeks with actual dates.

Include:
- Progression across weeks (build weeks + recovery week pattern)
- Session RPE targets
- Weekly volume targets appropriate for ${raceLabel}
- Key ${raceLabel}-specific workouts (tempo runs, race-pace sessions, long runs)
- Injury/limitation accommodations noted where relevant
- Adaptation goals per week

Be specific with paces, durations, and intensities. Use the athlete's actual performance data to set realistic ${raceLabel} targets.`;

      userPrompt = `${athleteContext}

${dataContext}

Generate a comprehensive ${raceLabel} ${isAIDecide ? 'fitness assessment, recommended timeline, and complete' : 'season strategy and detailed 4-week'} training plan starting ${planStart}. Schedule workouts only on ${daysStr}. Base all targets on the actual performance data above. Today's date is ${new Date().toISOString().split("T")[0]}.`;
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
