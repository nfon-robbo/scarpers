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

    const reqBody = await req.json();
    const { type, race_distance, training_days, start_date, race_date, current_plan, adjustment, review_text, messages: chatMessages, target_date, today_workout, activity_summary, planned_workout } = reqBody;
    // type: "analysis" | "training-plan" | "plan-review" | "plan-adjust" | "day-adjust" | "workout-review"

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

    // Fetch daily metrics for health/readiness context (always, not just AI-decide)
    let metricsContext = "";
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
        stress: m.stress_score,
        steps: m.steps,
        weight: m.weight,
      }));
      metricsContext = `\nDAILY HEALTH METRICS (last ${metrics.length} days):\n${JSON.stringify(metricsSummary, null, 2)}\n`;
    }

    // Fetch Google Fit sleep stages and compute sleep scores
    let sleepContext = "";
    const { data: sleepStages } = await supabase
      .from("sleep_stages")
      .select("date, stage, duration_seconds")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .limit(500);

    if (sleepStages && sleepStages.length > 0) {
      // Aggregate by date
      const byDate: Record<string, { deep: number; light: number; rem: number; awake: number }> = {};
      for (const r of sleepStages) {
        if (!byDate[r.date]) byDate[r.date] = { deep: 0, light: 0, rem: 0, awake: 0 };
        const key = r.stage as "deep" | "light" | "rem" | "awake";
        if (key in byDate[r.date]) byDate[r.date][key] += r.duration_seconds;
      }

      // Compute sleep scores using the same algorithm as the frontend
      const sleepSummary = Object.entries(byDate)
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 30)
        .map(([date, stages]) => {
          const total = stages.deep + stages.light + stages.rem + stages.awake;
          const sleepTime = stages.deep + stages.light + stages.rem;
          const totalH = total / 3600;
          const deepPct = sleepTime > 0 ? (stages.deep / sleepTime) * 100 : 0;
          const remPct = sleepTime > 0 ? (stages.rem / sleepTime) * 100 : 0;
          const efficiency = total > 0 ? (sleepTime / total) * 100 : 0;

          // Sleep score calculation (same as frontend)
          let durationScore = totalH >= 7 && totalH <= 9 ? 30
            : totalH >= 6 ? 30 * ((totalH - 5) / 2)
            : totalH > 9 && totalH <= 10 ? 30 * (10 - totalH)
            : Math.max(0, 30 * (totalH / 6) * 0.5);
          let deepScore = deepPct >= 15 && deepPct <= 25 ? 25
            : deepPct >= 10 ? 25 * ((deepPct - 5) / 10)
            : Math.max(0, 25 * (deepPct / 15) * 0.6);
          let remScore = remPct >= 20 && remPct <= 30 ? 25
            : remPct >= 10 ? 25 * ((remPct - 5) / 15)
            : Math.max(0, 25 * (remPct / 20) * 0.5);
          let effScore = efficiency >= 90 ? 20
            : efficiency >= 75 ? 20 * ((efficiency - 60) / 30)
            : Math.max(0, 20 * (efficiency / 90) * 0.5);
          const score = Math.round(Math.min(100, durationScore + deepScore + remScore + effScore));

          return {
            date,
            sleep_score: score,
            total_hours: (totalH).toFixed(1),
            deep_hours: (stages.deep / 3600).toFixed(1),
            rem_hours: (stages.rem / 3600).toFixed(1),
            light_hours: (stages.light / 3600).toFixed(1),
            awake_hours: (stages.awake / 3600).toFixed(1),
            deep_pct: Math.round(deepPct),
            rem_pct: Math.round(remPct),
            efficiency: Math.round(efficiency),
          };
        });

      sleepContext = `\nSLEEP STAGES & SCORES (last ${sleepSummary.length} nights from Google Fit):\n${JSON.stringify(sleepSummary, null, 2)}\n`;
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
${metricsContext}
${sleepContext}`;

    let systemPrompt: string;
    let userPrompt: string;

    const isPlanAdjust = type === "plan-adjust";

    if (type === "day-adjust") {
      // Fetch last night's sleep for the target date
      const targetDateStr = target_date || new Date().toISOString().split("T")[0];

      // Get yesterday's activity (fatigue indicator)
      const yesterday = new Date(targetDateStr);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split("T")[0];
      
      const { data: yesterdayActivities } = await supabase
        .from("activities")
        .select("activity_type, duration_seconds, distance_meters, avg_heart_rate, training_load")
        .eq("user_id", user.id)
        .gte("start_time", yesterdayStr + "T00:00:00")
        .lt("start_time", targetDateStr + "T00:00:00");

      let yesterdayContext = "";
      if (yesterdayActivities && yesterdayActivities.length > 0) {
        yesterdayContext = `\nYESTERDAY'S ACTIVITIES:\n${JSON.stringify(yesterdayActivities, null, 2)}\n`;
      }

      // Get today's daily metrics (RHR, HRV, stress)
      const { data: todayMetrics } = await supabase
        .from("daily_metrics")
        .select("resting_heart_rate, hrv, stress_score, steps")
        .eq("user_id", user.id)
        .eq("date", targetDateStr)
        .maybeSingle();

      let metricsToday = "";
      if (todayMetrics) {
        metricsToday = `\nTODAY'S METRICS:\nResting HR: ${todayMetrics.resting_heart_rate ? Math.round(todayMetrics.resting_heart_rate) + " bpm" : "N/A"}\nHRV: ${todayMetrics.hrv ? Math.round(todayMetrics.hrv) + " ms" : "N/A"}\nStress: ${todayMetrics.stress_score ?? "N/A"}\n`;
      }

      // Fetch recent cadence data from running activities (last 30 days)
      const cadenceSince = new Date(targetDateStr);
      cadenceSince.setDate(cadenceSince.getDate() - 30);
      const { data: recentRuns } = await supabase
        .from("activities")
        .select("start_time, avg_cadence, avg_speed, distance_meters, duration_seconds")
        .eq("user_id", user.id)
        .gte("start_time", cadenceSince.toISOString())
        .not("avg_cadence", "is", null)
        .order("start_time", { ascending: false })
        .limit(20);

      let cadenceContext = "";
      if (recentRuns && recentRuns.length > 0) {
        const cadences = recentRuns.map(r => r.avg_cadence!);
        const avgCadence = Math.round(cadences.reduce((a, b) => a + b, 0) / cadences.length);
        const latestCadence = Math.round(cadences[0]);
        const trend = cadences.length >= 3 
          ? (cadences[0] > cadences[cadences.length - 1] ? "improving" : cadences[0] < cadences[cadences.length - 1] ? "declining" : "stable")
          : "insufficient data";
        cadenceContext = `\nCADENCE DATA (last ${recentRuns.length} runs):\nAverage cadence: ${avgCadence} spm\nMost recent: ${latestCadence} spm\nTrend: ${trend}\nTarget range: 170-180 spm for joint protection\n${avgCadence < 160 ? "⚠️ Cadence is LOW — prioritize quick, light steps to reduce impact on knee/ankle.\n" : avgCadence >= 170 ? "✅ Cadence is in target range — great for joint health.\n" : "Cadence improving but still below target — continue cueing 'quick feet'.\n"}`;
      }

      systemPrompt = `You are an elite endurance coach making a real-time daily adjustment decision for an athlete's workout.

You have:
1. The athlete's PLANNED WORKOUT for today
2. Their LAST NIGHT'S SLEEP data (stages, score, quality)
3. Yesterday's training (fatigue carry-over)
4. Today's biometrics (resting HR, HRV, stress)

Based on sleep science (National Sleep Foundation, Matthew Walker's research):
- Sleep score ≥ 70 with good deep/REM: athlete is well-recovered → keep workout as planned or push slightly harder
- Sleep score 50-69: moderate recovery → consider reducing intensity by 1 zone or cutting volume by 10-20%
- Sleep score < 50: poor recovery → significantly reduce intensity, shorten workout, or convert to easy recovery session
- Deep sleep < 15% of sleep time: impaired physical recovery → reduce high-intensity work
- REM < 20% of sleep time: impaired cognitive/motor recovery → avoid complex drills, keep it simple
- High awake time (>10%): fragmented sleep → reduce overall volume

Also consider:
- If yesterday had a hard session + poor sleep → extra caution
- If HRV is significantly below their baseline → reduce intensity
- If resting HR is elevated → flag potential illness/overtraining
- CADENCE is critical for joint health: target 170-180 spm. If the athlete's recent cadence is below 160 spm, emphasize "quick, light feet" cues in your coaching note. If cadence is trending up, praise the improvement. Always include a cadence recommendation in adjusted workouts.

Your response MUST follow this exact format:

## 🌙 Sleep & Recovery Assessment
Brief summary of last night's sleep quality and what it means for today.

## 📋 Today's Planned Workout
Show the original planned workout.

## ✅ Decision: [KEEP AS-IS / ADJUSTED]
State clearly whether you're modifying the workout or not, and why.

## 📝 Workout for Today
If adjusted, provide the COMPLETE modified workout in the EXACT same markdown table format (Segment | Duration | Target | HR Zone | Notes). Include the workout title with "(Total: Xmin)".
If kept as-is, restate the original workout.

## 💡 Coach's Note
1-2 sentences max. One practical tip (hydration, warm-up, mental cue).

## 🔄 Sync Reminder
One sentence: "If adjusted, sync your plan to intervals.icu to update your watch."

BREVITY RULES:
- Sleep & Recovery Assessment: 2-3 bullet points max, no prose paragraphs
- Decision section: 1-2 sentences explaining why
- Coach's Note: 1-2 sentences only
- Total response should be as short as possible while remaining actionable

${athleteContext}`;

      userPrompt = `Date: ${targetDateStr}

LAST NIGHT'S SLEEP DATA:
${sleepContext || "No sleep data available for last night."}

${metricsToday}
${yesterdayContext}
${cadenceContext}

TODAY'S PLANNED WORKOUT:
${today_workout || "No workout found for today."}

Analyze the athlete's readiness and decide whether to adjust today's workout. Be specific and data-driven. Include cadence recommendations if cadence data is available.`;

    } else if (type === "chat") {
      // chatMessages already parsed above from the original req.json(), so re-read from body params
      systemPrompt = `You are an elite endurance coach AI assistant. You have deep knowledge of training science, nutrition, recovery, and race preparation.

You have access to the athlete's complete training data. Use it to give personalized, data-driven answers.

BREVITY RULES (strict):
- Maximum 3-5 bullet points per answer
- NO long paragraphs — bullet points only
- Lead with the answer, then supporting data
- Total response UNDER 150 words
- Only use headers if the user asks a complex multi-part question
- Reference specific data points (dates, paces, HR, sleep scores) but keep each bullet to one line
- Be practical and actionable — no filler or preamble

${athleteContext}

${dataContext}`;

      userPrompt = chatMessages || "Hello, I'd like some coaching advice.";
    } else if (type === "analysis") {
      systemPrompt = `You are an elite endurance coach AI, modeled after the garmin-ai-coach system. You perform multi-domain training analysis.

Your analysis must cover these domains in separate sections:

## 📊 KPI Dashboard Summary
Summarize: training load trends (chronic vs acute), training frequency, volume trends, intensity distribution. Calculate approximate ACWR (Acute:Chronic Workload Ratio) if enough data exists.

## 🏃 Execution Analysis  
Analyze: pace/speed progression, heart rate efficiency (aerobic decoupling indicators), power trends if available, cadence patterns. Provide evidence-based progression tracking.

## 🫀 Physiology & Readiness
Analyze: heart rate trends (resting HR proxy from avg HR patterns), recovery patterns (days between hard sessions), any crash signatures (sudden drops in performance/consistency), fatigue indicators.

## 😴 Sleep & Recovery
Analyze sleep data if available:
- Sleep score trends (recent nights, 7-day average)
- Deep sleep and REM percentages vs recommended ranges (15-20% deep, 20-25% REM)
- Sleep efficiency trends
- Correlation between poor sleep nights and next-day training performance
- Recovery readiness based on sleep quality patterns
Reference National Sleep Foundation guidelines where relevant.

## 💡 Actionable Recommendations
- One bullet per action, no elaboration unless critical
- Group: Load Management | Sport-Specific | Recovery & Sleep | Performance
- Max 3-5 bullets total across all categories

BREVITY RULES (strict):
- Each section above: 3-5 bullet points MAX, no prose paragraphs
- Data points and recommendations only — no filler
- Total analysis should be roughly half the length you'd normally write
- Use specific numbers but keep each bullet to one line`;

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
2-3 sentences max. Personal advice or technique cues only.

BREVITY RULES (strict):
- Progress Summary: 3-4 bullets max with numbers
- What Went Well / Needs Attention: 2-3 bullets each, one line per bullet
- Recommended Adjustments: state verdict + 2-3 bullet reasons
- No prose paragraphs anywhere — bullets and short sentences only`;

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
5. EVERY running segment MUST include a music BPM target in the Notes column (🎵 150=Z1, 155=Z2, 165=Z3, 170=Z4, 175=Z5) for cadence matching.
6. Include the Season Strategy Overview section before the weekly plan.
7. Start from the next upcoming week based on today's date.`;

      userPrompt = `${athleteContext}

${dataContext}

ORIGINAL TRAINING PLAN:
${current_plan || "No plan provided"}

PROGRESS REVIEW:
${review_text || "No review provided"}

Generate the complete revised ${raceLabel} training plan based on the review and the ${adjustmentDirection} adjustment requested. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else if (type === "training-plan") {
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
- Review sleep data to assess recovery status. If sleep scores are consistently low (<60) or deep/REM percentages are below recommended ranges, factor in extra recovery days or lower intensity sessions. Reference sleep trends when explaining rest day placement.
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
3. EVERY running segment in the Notes column MUST include a music BPM target aligned with the target cadence for that segment. Use the format "🎵 XXX BPM (target cadence)". Use these mappings:
   - Z1 (walking/easy): 🎵 150 BPM
   - Z2 (easy run): 🎵 155 BPM
   - Z3 (steady/intervals): 🎵 165 BPM
   - Z4 (tempo/threshold): 🎵 170 BPM
   - Z5 (race pace/VO2max): 🎵 175 BPM
   This is critical for the athlete to match their running cadence to music tempo for joint protection. NEVER omit the music BPM from the Notes column on any running segment.

For each workout day, use this Zepp-compatible format. IMPORTANT: Use UK date format (DD/MM/YYYY) for all dates:

### Week 1: [Theme]
**Monday ${planStartUK}** - [Workout Type] (Total: 40min)
| Segment | Duration/Distance | Target | HR Zone | Notes |
|---------|-------------------|--------|---------|-------|
| Warm-up | 10 min | easy pace | Z1-Z2 | 🎵 150 BPM (target cadence) |
| Main | 3 x 1km | 5:30/km | Z4 | 🎵 170 BPM (target cadence); 90s jog recovery |
| Cool-down | 10 min | easy pace | Z1 | 🎵 150 BPM (target cadence) |

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
    } else if (type === "workout-review") {
      const reviewSystemPrompt = [
        "You are an incredibly supportive and encouraging running coach reviewing an athlete's completed workout vs their plan. Be warm, positive, celebratory. Keep it concise (150-200 words). Use emojis sparingly.",
        "",
        "Format:",
        "## Workout Review",
        "**Performance Summary**: Brief planned vs actual comparison",
        "**What Went Well**: 2-3 specific positives",
        "**Areas to Build On**: 1-2 gentle suggestions (only if relevant)",
        "**Coach's Note**: Encouraging closing message",
      ].join("\n");
      systemPrompt = reviewSystemPrompt;

      const pw = planned_workout || "N/A";
      const as = activity_summary || "N/A";
      userPrompt = "## Planned Workout\n" + pw + "\n\n## Actual Activity\n" + as + "\n\nReview this workout with encouraging, supportive feedback.";
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
