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
    const { type, race_distance, goal_time, current_pace_min, current_pace_max, training_days, start_date, race_date, current_plan, adjustment, review_text, messages: chatMessages, history: chatHistory, target_date, today_workout, activity_summary, planned_workout } = reqBody;
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
        .eq("archived", false)
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

🚨 SURGICAL EDIT MODE (HIGHEST PRIORITY) 🚨
If the user prompt contains a "COACH RECOMMENDATION TO APPLY" block, you are NOT doing a readiness assessment — you are applying ONE specific edit to the workout that follows. Rules:
- Make the SMALLEST POSSIBLE change. Do not redesign the session.
- "Add a rep" / "add another rep" → duplicate the existing interval pair (work + recovery) ONE more time. Keep the same duration, pace, walk recovery, cadence, BPM, notes. Do NOT change pace. Do NOT change duration. Do NOT change session type. Do NOT change the title. Do NOT add warnings.
- "Remove a rep" → delete the LAST work+recovery pair only.
- "Make it shorter / longer" → only adjust what was asked.
- NEVER replace a run/walk interval session with stretching, mobility, yoga, rest, or any other session type unless the user explicitly asked for that.
- NEVER change the workout title unless the structural type changed.
- Preserve every other segment exactly as written, including warm-up, cool-down, paces, BPM, notes.
- Output the COMPLETE modified workout under "## 📝 Workout for Today" using the same table format. Skip the readiness assessment fluff — go straight to Decision (always "ADJUSTED") and the workout.



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
If adjusted, provide the COMPLETE modified workout in the EXACT same markdown table format (Segment | Duration/Distance | Target | Notes). Include the workout title with "(Total: Xmin)". When a segment has a distance target, include both distance and estimated duration.
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
      systemPrompt = `You are an elite RUNNING coach AI assistant. This is a running-only application.

You have access to the athlete's complete training data. Use it to give personalized, data-driven answers.

🚫 ABSOLUTE BANS — NEVER suggest, recommend, or even mention any of the following as alternatives, substitutes, or cross-training:
- Swimming
- Cycling / biking / spin
- Rowing
- Elliptical
- Yoga, pilates, or any non-running aerobic activity
If joint load is a concern, the only permitted adjustments are: reduce intensity, reduce volume/duration, swap to easy run, swap to walk/run intervals, swap to walk-only recovery, add a rest day, change cadence, change surface (road/trail/treadmill), or strength/mobility work. NEVER recommend a non-running aerobic substitute under ANY circumstance, even for injury, illness, or recovery.

BREVITY RULES (strict):
- Maximum 3-5 bullet points per answer
- NO long paragraphs — bullet points only
- Lead with the answer, then supporting data
- Total response UNDER 150 words
- Only use headers if the user asks a complex multi-part question
- Reference specific data points (dates, paces, HR, sleep scores) but keep each bullet to one line
- Be practical and actionable — no filler or preamble

RECOMMENDATION ACTIONS:
- WHENEVER your reply suggests changing, scaling, swapping, postponing, or modifying any workout in the plan, you MUST end the message with one of these markers on its own line:
  • [[ACTION:day:DD/MM/YYYY]]   ← use this when the change affects ONE specific day only (e.g. "today's session", "Wednesday 17 June", a single workout the user just asked about). Replace DD/MM/YYYY with that exact date in UK format.
  • [[ACTION:plan]]              ← use this ONLY when the change requires rewriting multiple weeks/sessions of the plan (e.g. "reduce overall volume across the next 4 weeks").
- Default to [[ACTION:day:...]] whenever possible. Only use [[ACTION:plan]] when a single-day edit cannot capture the change.
- Do NOT include any marker for general advice, education, or questions that don't change the plan.
- CRITICAL: Only emit a marker if you are PROPOSING A CONCRETE EDIT to a workout using explicit edit wording such as "swap", "replace", "cut", "reduce", "shorten", "postpone", "move", "skip", "add", or "change".
- If your reply only ANALYSES, REASSURES, or CONCLUDES the workout was fine/appropriate/well-managed/no change needed, DO NOT emit any marker — even if you give advice such as softer surfaces, cadence cues, recovery, fuelling, hydration, or monitoring symptoms.
- For questions like "Is it too intense?", "Was that okay?", "How did my workout go?", or any post-hoc review of a completed workout, NEVER emit an action marker unless you explicitly tell the user a future planned workout should be changed.
- Examples that must NOT have a marker: "The intensity was appropriate", "This looks well-managed", "You're on track", "No change needed", "continue prioritising soft surfaces", "monitor your knee", "keep cadence light".
- Never wrap the marker in code fences. Always plain text on the last line.

CONVERSATION CONTEXT (CRITICAL):
- The earlier messages in this conversation are real prior turns. Use them.
- If the user gives a follow-up like "add another rep", "remove a rep", "make it shorter", "swap it for an easy run", or any modification WITHOUT naming a date, it refers to the SAME workout that was last discussed in this conversation (the most recent [[ACTION:day:DD/MM/YYYY]] you produced, or the workout date the user explicitly named most recently).
- In that case, reuse that exact same DD/MM/YYYY in your [[ACTION:day:...]] marker. Do NOT pick a different date and do NOT say "couldn't find a workout" — just apply the change to the remembered session.
- Only switch to a different date if the user explicitly names a new date or session.

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
1. EVERY workout MUST have a full markdown table with Segment/Duration/Target/Notes columns (NO HR Zone column).
2. Use UK date format (DD/MM/YYYY) for all dates.
3. Only schedule workouts on: ${daysStr}.
4. EVERY workout title MUST include the total duration as "(Total: Xmin)".
5. For interval segments, ALWAYS express durations in MINUTES (e.g., "4 x 3 min", "6 x 2 min") — NEVER use zone labels as the duration.
6. When a segment has a specific distance target (e.g., long run of 10km, intervals of 800m), include BOTH the distance AND the estimated duration in the Duration column (e.g., "10km (~55 min)" or "4 x 800m (~3.5 min each)").
7. EVERY running segment MUST include a music BPM target in the Notes column (🎵 150-175 BPM range based on intensity).
8. Include the Season Strategy Overview section before the weekly plan.
9. Start from the next upcoming week based on today's date.`;

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

      // ===== Compute athlete physiological summary for prompt placeholders =====
      const recentMetrics = (metrics || []).slice(0, 7);
      const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
      const restingHrVals = recentMetrics.map((m: any) => m.resting_heart_rate).filter((v: any) => v != null);
      const hrvVals = recentMetrics.map((m: any) => m.hrv).filter((v: any) => v != null);
      const sleepVals = recentMetrics.map((m: any) => m.sleep_duration_seconds).filter((v: any) => v != null);
      const restingHr = restingHrVals.length ? Math.round(avg(restingHrVals)!) : null;
      const hrv = hrvVals.length ? Math.round(avg(hrvVals)!) : null;
      const avgSleepH = sleepVals.length ? (avg(sleepVals)! / 3600).toFixed(1) : null;

      // HRV trend: compare last 3 days vs previous 7
      let hrvTrend = "stable";
      const recent3 = hrvVals.slice(0, 3);
      const prior7 = hrvVals.slice(3, 10);
      if (recent3.length >= 2 && prior7.length >= 3) {
        const r = avg(recent3)!;
        const p = avg(prior7)!;
        const diff = ((r - p) / p) * 100;
        if (diff < -10) hrvTrend = "declining (>10% drop)";
        else if (diff > 5) hrvTrend = "improving";
      }

      // HR zones from estimated max HR (220 - age fallback) or from activity max
      const ageMax = profile?.date_of_birth
        ? 220 - (new Date().getFullYear() - new Date(profile.date_of_birth).getFullYear())
        : null;
      const observedMax = Math.max(...(activities || []).map((a: any) => a.max_heart_rate || 0));
      const maxHr = ageMax || (observedMax > 0 ? observedMax : 190);
      const z1Max = Math.round(maxHr * 0.65);
      const z2Range = `${Math.round(maxHr * 0.65)}-${Math.round(maxHr * 0.75)}`;
      const z3Range = `${Math.round(maxHr * 0.75)}-${Math.round(maxHr * 0.85)}`;
      const z4Range = `${Math.round(maxHr * 0.85)}-${Math.round(maxHr * 0.92)}`;
      const z5Min = Math.round(maxHr * 0.92);

      // Recent run stats
      const runs = (activities || []).filter((a: any) => /run/i.test(a.activity_type || ""));
      const longestRun = runs.length ? Math.max(...runs.map((a: any) => (a.distance_meters || 0) / 1000)).toFixed(1) : "N/A";
      // ===== Pace anchors derived from THIS user's actual runs =====
      const fmtPace = (secPerKm: number): string => {
        const m = Math.floor(secPerKm / 60);
        const s = Math.round(secPerKm % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
      };
      // NOTE: activities.avg_speed is stored in km/h (not m/s). 60 / kmh = min/km.
      const paceFromMps = (kmh: number) => (60 / kmh) * 60; // returns seconds per km
      // Z2 (HR-filtered) pace if we have it
      const z2Runs = runs.filter((a: any) => a.avg_heart_rate && a.avg_heart_rate >= maxHr * 0.65 && a.avg_heart_rate <= maxHr * 0.75 && a.avg_speed);
      const z2PaceMps = z2Runs.length ? avg(z2Runs.map((a: any) => Number(a.avg_speed))) : null;
      // Average pace across ALL runs with speed (fallback when HR data is sparse)
      const allPacedRuns = runs.filter((a: any) => a.avg_speed && Number(a.avg_speed) > 0);
      const avgRunMps = allPacedRuns.length ? avg(allPacedRuns.map((a: any) => Number(a.avg_speed))) : null;
      // Slowest 25% (a proxy for true easy pace) across all runs
      const sortedSlow = [...allPacedRuns].sort((a: any, b: any) => Number(a.avg_speed) - Number(b.avg_speed));
      const slowSlice = sortedSlow.slice(0, Math.max(1, Math.floor(sortedSlow.length / 4)));
      const easyMps = slowSlice.length ? avg(slowSlice.map((a: any) => Number(a.avg_speed))) : null;

      // Map experience level to a safe default easy pace when we have ZERO run data.
      const expLevelLower = (profile?.experience_level || "intermediate").toLowerCase();
      const fallbackByLevel = (lvl: string): { easy: string; label: string } => {
        if (/begin|novice|new/.test(lvl)) return { easy: "7:30", label: "Beginner default (no run history)" };
        if (/elite|advanced|expert/.test(lvl)) return { easy: "5:00", label: "Elite default (no run history)" };
        return { easy: "6:30", label: "Intermediate default (no run history)" };
      };

      // User-supplied pace range takes priority over everything else.
      const userPaceMin = typeof current_pace_min === "string" && /^\d{1,2}:\d{2}$/.test(current_pace_min.trim()) ? current_pace_min.trim() : null;
      const userPaceMax = typeof current_pace_max === "string" && /^\d{1,2}:\d{2}$/.test(current_pace_max.trim()) ? current_pace_max.trim() : null;
      const userPaceRange = userPaceMin && userPaceMax ? `${userPaceMin}-${userPaceMax}` : (userPaceMin || userPaceMax);

      // Choose the authoritative easy/Z2 pace: user-supplied → HR-filtered Z2 → slowest-25% → overall avg → experience fallback.
      let z2Pace: string;
      let z2PaceSource: string;
      if (userPaceRange) {
        z2Pace = userPaceRange + (userPaceMin && userPaceMax ? "" : "");
        z2PaceSource = `user-supplied current easy pace (HARD ANCHOR — use this exact range for week 1, then progress gradually toward goal pace)`;
      } else if (z2PaceMps) {
        z2Pace = fmtPace(paceFromMps(z2PaceMps));
        z2PaceSource = `derived from ${z2Runs.length} HR-Z2 runs`;
      } else if (easyMps) {
        z2Pace = fmtPace(paceFromMps(easyMps));
        z2PaceSource = `slowest-25% of ${allPacedRuns.length} recent runs (HR data sparse, used as easy-pace proxy)`;
      } else if (avgRunMps) {
        z2Pace = fmtPace(paceFromMps(avgRunMps) + 30);
        z2PaceSource = `avg of ${allPacedRuns.length} runs + 30s/km cushion`;
      } else {
        const fb = fallbackByLevel(expLevelLower);
        z2Pace = fb.easy;
        z2PaceSource = fb.label;
      }
      // When user supplies their current pace, ignore the historical average so the AI is not tempted to use it.
      const avgRunPace = userPaceRange
        ? `IGNORED — user supplied current easy pace (${userPaceRange}/km); use that instead`
        : (avgRunMps ? fmtPace(paceFromMps(avgRunMps)) : "N/A");
      const userAnchorBlock = userPaceRange
        ? `\n🚨 USER-SUPPLIED PACE OVERRIDE 🚨\nThe athlete has explicitly told us their current easy run pace is ${userPaceRange}/km.\nWeek 1 EVERY easy/Z2/recovery/long run MUST be prescribed at ${userPaceRange}/km — no faster, no slower.\nDo NOT fall back to historical averages, textbook paces, or goal-derived paces for week 1.\nProgress this anchor by no more than ~5-10 seconds/km per week toward the goal pace as fitness builds.\n`
        : "";

      // ACWR (acute:chronic workload ratio) from training load
      const today = new Date();
      const acuteLoad = runs.filter((a: any) => {
        const d = new Date(a.start_time);
        return (today.getTime() - d.getTime()) / 86400000 <= 7;
      }).reduce((s: number, a: any) => s + (a.duration_seconds || 0) / 60, 0);
      const chronicLoad = runs.filter((a: any) => {
        const d = new Date(a.start_time);
        return (today.getTime() - d.getTime()) / 86400000 <= 28;
      }).reduce((s: number, a: any) => s + (a.duration_seconds || 0) / 60, 0) / 4;
      const acwr = chronicLoad > 0 ? (acuteLoad / chronicLoad).toFixed(2) : "N/A";

      // Weeks calculation
      let weeks = "TBD (ai-recommend)";
      let baseWeeks = "?", buildWeeks = "?", sharpenWeeks = "?", taperWeeks = "2";
      if (race_date && race_date !== "ai-recommend") {
        const start = new Date(planStart);
        const race = new Date(race_date);
        const w = Math.max(1, Math.round((race.getTime() - start.getTime()) / (7 * 86400000)));
        weeks = String(w);
        taperWeeks = String(Math.min(2, Math.max(1, Math.round(w * 0.15))));
        sharpenWeeks = String(Math.max(1, Math.round(w * 0.20)));
        buildWeeks = String(Math.max(1, Math.round(w * 0.30)));
        baseWeeks = String(w - Number(taperWeeks) - Number(sharpenWeeks) - Number(buildWeeks));
      }

      // Day name of the start date so we can force the first workout to land on it
      const startDayName = new Date(planStart + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" });
      const startDayShort = startDayName.slice(0, 3);
      const trainingDaysList = (training_days as string[] | undefined) || [];
      const includesStartDay = trainingDaysList.some((d) => d.toLowerCase().startsWith(startDayShort.toLowerCase()));
      const firstWorkoutRule = includesStartDay
        ? `The first workout MUST be on ${planStart} (${startDayName}).`
        : `IMPORTANT: The first workout MUST be on ${planStart} (${startDayName}) — even though ${startDayName} is NOT in the regular training days list. Treat the start date as a one-off extra session. From the day AFTER ${planStart} onwards, only schedule workouts on: ${daysStr}.`;

      const raceDateUKFmt = race_date && race_date !== "ai-recommend"
        ? (() => { const [ry, rm, rd] = (race_date as string).split("-"); return `${rd}/${rm}/${ry}`; })()
        : null;
      const raceDayName = race_date && race_date !== "ai-recommend"
        ? new Date(race_date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long" })
        : null;

      // Build the EXACT list of required workout dates so the model cannot stop early
      // or round to a week boundary. Includes every training-day-of-week between
      // start and race, the start date itself, and the race date itself.
      const dayShortToFull: Record<string, string> = {
        mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
        fri: "Friday", sat: "Saturday", sun: "Sunday",
      };
      const trainingDayNames = (training_days as string[] | undefined || []).map((d) => {
        const k = d.slice(0, 3).toLowerCase();
        return dayShortToFull[k] || d;
      });
      const requiredDates: string[] = [];
      if (race_date && race_date !== "ai-recommend") {
        const start = new Date(planStart + "T00:00:00");
        const end = new Date(race_date + "T00:00:00");
        for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
          const iso = d.toISOString().slice(0, 10);
          const dayName = d.toLocaleDateString("en-GB", { weekday: "long" });
          const isStart = iso === planStart;
          const isRace = iso === race_date;
          const isTrainingDay = trainingDayNames.includes(dayName);
          if (isStart || isRace || isTrainingDay) {
            const tag = isRace ? " ← 🏁 RACE DAY" : isStart ? " ← FIRST WORKOUT" : "";
            requiredDates.push(`- ${iso} (${dayName})${tag}`);
          }
        }
      }
      const requiredDatesBlock = requiredDates.length
        ? `\n\n══ MANDATORY WORKOUT DATES — EVERY ONE OF THESE MUST APPEAR IN THE PLAN ══\n${requiredDates.join("\n")}\n\nThe plan is INCOMPLETE and INVALID if any of the dates above is missing. Do not stop until you have written a workout entry for every single date in this list. The very last entry in the plan MUST be ${race_date} (race day).`
        : "";

      const planLengthInstruction = isAIDecide
        ? `Generate the FULL training plan from start date to race date. Every week must have detailed daily workouts. Do NOT limit to 4 weeks — output the complete plan for however many weeks are needed. ${firstWorkoutRule}`
        : `Generate the COMPLETE plan starting from ${planStart} and ending on ${race_date} (${raceDayName}, ${raceDateUKFmt}).
${firstWorkoutRule}
After the start date, only schedule workouts on: ${daysStr}. All other days are rest/recovery.

⚠️ CRITICAL — RACE DAY IS MANDATORY:
The FINAL entry in the plan MUST be the race itself on ${race_date} (${raceDayName}, ${raceDateUKFmt}). Label it "🏁 RACE DAY — ${raceLabel}".
RACE DAY IS THE RACE ONLY — it is a single continuous effort over the full race distance (${raceLabel}) at goal pace${goal_time ? ` to hit ${goal_time}` : ""}. Do NOT prescribe walk/run intervals, do NOT split it into sets, do NOT add training intervals on race day. A short pre-race routine (light jog warm-up + strides + fuelling/pacing notes) may be described in the notes column, but the workout itself must be ONE entry: the race. Do NOT stop the plan before this date. The final week must extend all the way through to ${race_date} inclusive — do NOT round down to a clean week boundary.${requiredDatesBlock}`;

      const ageYears = profile?.date_of_birth
        ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000))
        : null;

      // ===== Detect beginner / injury / returning runner =====
      const expLevel = (profile?.experience_level || "intermediate").toLowerCase();
      const ctxText = `${profile?.athlete_context || ""} ${profile?.training_goals || ""}`.toLowerCase();
      const isBeginner = expLevel === "beginner" || /beginner|novice|new\s+to\s+run|just\s+start|first[- ]time/.test(ctxText);
      const hasInjury = /injur|niggle|pain|surgery|physio|rehab|tendon|fracture|strain|sprain/i.test(ctxText);
      const mostRecentRunMs = runs.length
        ? Math.max(...runs.map((a: any) => new Date(a.start_time).getTime()))
        : 0;
      const daysSinceLastRun = mostRecentRunMs ? Math.floor((Date.now() - mostRecentRunMs) / 86400000) : 999;
      const isReturning = /return|coming\s+back|comeback|time\s+off|break\s+from\s+run/i.test(ctxText) || daysSinceLastRun > 56;
      const needsWalkRunRamp = isBeginner || hasInjury || isReturning;

      const walkRunFlags = [
        isBeginner ? "Beginner" : null,
        hasInjury ? "Injured/Recovering" : null,
        isReturning ? `Returning (${daysSinceLastRun >= 999 ? "no recent runs" : daysSinceLastRun + "d since last run"})` : null,
      ].filter(Boolean).join(", ");

      const walkRunBlock = needsWalkRunRamp
        ? `

══ MANDATORY WALK/RUN RAMP (athlete flagged as ${walkRunFlags}) ══
HARD RULE — DO NOT DEVIATE:
The FIRST 10 scheduled workouts in this plan MUST be WALK/RUN INTERVAL sessions. No continuous easy runs, no tempo, no long runs in those 10 slots. Each session must be a structured walk/run interval workout, individually tailored to THIS athlete using their profile, recent activity history, HR zones, and any injury/niggle context above.

Progressive structure across the 10 sessions (adapt run/walk durations and rep counts to the athlete's current capacity — use longest recent run (${longestRun} km), Z2 pace (${z2Pace}/km), resting HR ${restingHr ?? "N/A"}, HRV trend ${hrvTrend}, and injury notes to set the right starting point):
  Sessions 1-2: shortest run intervals (e.g. 30-60s run / 60-90s walk) × 8-12 reps
  Sessions 3-4: 60-90s run / 60s walk × 8-12 reps
  Sessions 5-6: 2 min run / 60s walk × 6-10 reps
  Sessions 7-8: 3-4 min run / 60-90s walk × 5-8 reps
  Sessions 9-10: 5 min run / 60s walk × 4-6 reps (transition toward continuous)

For EACH of the 10 sessions:
- Title MUST start with "Walk/Run Intervals:" e.g. "Walk/Run Intervals: 10 × 1min (Total: 30min)"
- Markdown table with a warm-up walk row, the structured interval rep block row(s), and a cool-down walk row
- The interval row's Duration column MUST use the format "N × Xmin run / Ymin walk" (ASCII "x" is also fine) so the watch can expand the reps. Example: "10 × 1min run / 1min walk"
- Run intensity stays in Z1-Z2 (HR < ${Math.round(maxHr * 0.75)} bpm). NO Z3+ work in these 10 sessions
- Walk recoveries in Z1
- Target column MUST include BOTH the HR range AND an explicit pace range in min/km, based on the athlete's actual Z2 pace (${z2Pace}/km). Run pace target: roughly Z2 pace ± 30s (e.g. if Z2 is 7:00/km use "7:00-7:30/km"). Walk pace: 9:00-10:00/km. NEVER omit the pace — without it the watch defaults to a generic 6:27/km which is too fast for a beginner.
- ⚠️ DO NOT use race-pace-derived paces (threshold, VO2max, race pace) for these 10 walk/run sessions. The athlete is ramping up — paces MUST be conversational easy paces only (Z2 ± 30s, i.e. roughly ${z2Pace}/km). Any run pace faster than 5:30/km in these 10 sessions is FORBIDDEN regardless of goal time.
- Music BPM target on every running segment (🎵 150 BPM walking, 🎵 155 BPM easy run)
- Notes column must briefly reference WHY this fits THIS athlete (their injury, layoff length, or beginner status)
- If athlete has an injury, add a short form/safety cue tied to that injury

After session 10, transition into the normal periodised plan (Z2 continuous, then tempo, then quality work) per the rules below.
`
        : "";

      systemPrompt = `══ ATHLETE ══
Name: ${profile?.name || "Athlete"}
Sex: ${profile?.sex || "not specified"}
Age: ${ageYears ?? "not specified"}
Height: ${profile?.height_cm ? `${profile.height_cm} cm` : "not specified"}
Weight: ${profile?.weight_kg ? `${profile.weight_kg} kg` : "not specified"}
Experience: ${profile?.experience_level || "intermediate"}
Goal: ${profile?.training_goals || "complete the race strong"}
Race: ${raceLabel} on ${race_date && race_date !== "ai-recommend" ? race_date : "TBD (you decide)"}
${(() => {
  if (!goal_time) return "Goal Time: not specified — train for general improvement at this distance";
  // Compute target race pace per km from goal_time + race distance
  const parts = String(goal_time).trim().split(":").map((x: string) => parseInt(x, 10));
  let totalSec = 0;
  if (parts.length === 3) totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) totalSec = parts[0] * 60 + parts[1];
  const distKm = ({ "5k": 5, "10k": 10, "half-marathon": 21.0975, "marathon": 42.195 } as Record<string, number>)[race_distance as string] || 0;
  if (!totalSec || !distKm) return `Goal Time: ${goal_time} — build the plan around hitting this finish time`;
  const paceSec = Math.round(totalSec / distKm);
  const pm = Math.floor(paceSec / 60), ps = paceSec % 60;
  const racePace = `${pm}:${ps.toString().padStart(2, "0")}/km`;
  // Derive training paces from race pace
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}/km`;
  return `Goal Time: ${goal_time} → Required race pace: ${racePace}
Derived training paces (use these as anchors when prescribing intervals/tempo/easy):
- Race pace: ${racePace}
- Threshold/Tempo: ${fmt(paceSec + 15)} (race pace + 15s/km)
- VO2max (3-5min reps): ${fmt(Math.max(180, paceSec - 15))} (race pace - 15s/km)
- Easy/Z2: ${fmt(paceSec + 75)} - ${fmt(paceSec + 105)} (race pace + 75-105s/km)
- Long run: ${fmt(paceSec + 60)} - ${fmt(paceSec + 90)}
CRITICAL: Every interval/tempo/race-pace workout MUST prescribe paces tied to this goal time. Do NOT default to generic paces. The whole plan must progressively prepare the athlete to sustain ${racePace} on race day.`;
})()}
Plan: ${weeks} weeks starting ${planStart}
Training Days: ${(training_days as string[] | undefined)?.length || 4} (${daysStr})

══ PHYSIOLOGICAL DATA ══
HR Zones (estimated from max HR ${maxHr}): Z1<${z1Max}, Z2:${z2Range}, Z3:${z3Range}, Z4:${z4Range}, Z5>${z5Min} bpm
VO2max: derive from activity history above
Resting HR: ${restingHr ?? "N/A"} bpm (7-day avg)
HRV: ${hrv ?? "N/A"} ms (trend: ${hrvTrend})
Sleep: ${avgSleepH ?? "N/A"}h/night (see sleep scores in data above)
ACWR: ${acwr} (acute:chronic workload ratio, last 7d vs 28d running minutes)
Injury History: ${profile?.athlete_context || "none reported"}
Current Niggles: ${profile?.athlete_context || "none reported"}

══ RECENT PERFORMANCE ══
Avg pace across recent runs: ${avgRunPace}/km
🔒 ANCHOR EASY PACE (Z2): ${z2Pace}/km — source: ${z2PaceSource}
Long Run: ${longestRun} km
(Recent 5K time and tempo pace: derive from activity history above)
${userAnchorBlock}
══ MANDATORY PACE RULES ══
EVERY pace you prescribe MUST be derived from the ANCHOR EASY PACE above (${z2Pace}/km), NOT from generic textbook values, NOT from a fixed 6:00/km default, and NOT from the historical average pace.
Use these offsets relative to the anchor:
- Easy / Recovery / Z2 continuous: ${z2Pace}/km (± 15s)
- Long run: ${z2Pace}/km to ${z2Pace}/km + 30s
- Steady / Z3 tempo: anchor − 30 to 45s/km
- Threshold / Z4: anchor − 60 to 75s/km
- VO2max / Z5 reps: anchor − 90 to 110s/km
- Walk recovery: 12:30-13:30/km
${userPaceRange ? `WEEK 1 RUN PACE IS LOCKED TO ${userPaceRange}/km. Do not use ${avgRunMps ? fmtPace(paceFromMps(avgRunMps)) + "/km" : "any other pace"} for week 1 easy runs under any circumstance.` : ""}
Across the plan the easy-pace anchor should gradually improve toward the goal race pace as fitness builds, but NEVER prescribe an easy run faster than the current anchor in week 1. Forbidden: prescribing a 6:00/km easy run when the anchor is 7:30/km. Forbidden: ignoring the anchor and using race-pace-derived numbers for easy runs.

══ COACHING TASK ══
You are an elite running coach with 35 years of experience, training beginners to olympic gold medalists to be the best runner they can be. Generate a ${weeks}-week periodized training plan. Be concise, specific, coach-like.${walkRunBlock}

INTERVAL INTRODUCTION BY EXPERIENCE:
IF Beginner OR Injured OR Returning (>8 weeks off):
  - Weeks 1-2: Walk/run intervals ONLY (progressive: 30s run/30s walk → 5min run/1min walk over 10 sessions)
  - Week 3: Introduce tempo (10min Z3)
  - Week 5+: Race pace intervals
IF Intermediate AND No Injury:
  - Weeks 1-2: Easy continuous running Z2
  - Week 2: Add strides (6×20sec)
  - Week 3: Tempo introduction
  - Week 4+: Intervals (race pace, VO2max)
IF Advanced:
  - Week 1: Easy base week Z2
  - Week 2+: Quality sessions with recovery weeks

TRAINING PRINCIPLES:
- 80% volume in Z2 (easy), 20% in Z3-Z5 (hard)
- Increase weekly volume max 10%
- Recovery week every 3-4 weeks (reduce volume 40-50%)
- Taper: Final 10-14 days reduce volume 50-60%, maintain intensity
- Include 2x/week strength/band circuits (glute bridges, single-leg deadlifts, planks, clamshells)
- If ACWR>1.5 OR HRV drops >10% OR RHR elevated >5bpm for 3+ days: force recovery week

PERIODIZATION:
Phase 1 — Base (${baseWeeks} weeks): Z2 volume, aerobic foundation, injury prevention
Phase 2 — Build (${buildWeeks} weeks): Tempo + threshold, maintain volume
Phase 3 — Sharpen (${sharpenWeeks} weeks): Race pace + VO2max, reduce volume 10%
Phase 4 — Taper (${taperWeeks} weeks): -50% volume, maintain intensity

WORKOUT TYPES:
- Easy: Z2, conversational, 30-60min
- Long: Z2, progressive finish, 60-120min
- Tempo: Z3, comfortably hard, 20-40min sustained
- Race Pace: Z3-Z4, 3-10min blocks with 2-3min recovery
- VO2max: Z4-Z5, 400m-1200m reps with equal rest
- Strides: 6×20sec @ 5K pace (neuromuscular)

══ OUTPUT FORMAT ══

**SEASON OVERVIEW** (max 150 words)
- Phase breakdown with weeks
- Weekly volume progression by phase
- Intensity distribution (% time in each zone)
- Key milestone sessions

**WEEK-BY-WEEK PLAN**
${planLengthInstruction}

CRITICAL FORMAT RULES (required for watch sync — do not deviate):
1. Use UK date format (DD/MM/YYYY) for every date.
2. EVERY workout day MUST be presented as a markdown table with columns: Segment | Duration/Distance | Target | Notes. No compact one-liners.
3. EVERY workout title MUST include "(Total: Xmin)" — sum all segments including warm-up, recoveries, cool-down.
4. Interval durations in MINUTES (e.g., "4 x 3 min"), never bare zone labels.
5. When a segment has a distance target, include BOTH distance AND estimated duration (e.g., "10km (~55 min)").
6. EVERY running segment in Notes MUST include music BPM target:
   - Walking/easy: 🎵 150 BPM
   - Easy run: 🎵 155 BPM
   - Steady/intervals: 🎵 165 BPM
   - Tempo/threshold: 🎵 170 BPM
   - Race pace/VO2max: 🎵 175 BPM
7. Include HR target ranges from the zones above in the Target column.
8. Warm-up and cool-down segments MUST be exactly 5 minutes — never 10 minutes or longer.

Example workout format:
### Week 1: Base Building
**Monday ${planStart}** - Easy Run (Total: 30min)
| Segment | Duration/Distance | Target | Notes |
|---------|-------------------|--------|-------|
| Warm-up | 5 min walk | Z1 (<${z1Max} bpm) | 🎵 150 BPM (target cadence) |
| Main | 20 min easy run | Z2 (${z2Range} bpm) | 🎵 155 BPM (target cadence); walk breaks OK if HR spikes |
| Cool-down | 5 min walk | Z1 (<${z1Max} bpm) | 🎵 150 BPM (target cadence) |
- Strength: Band circuit after (glute bridges, clamshells, planks)

After all weekly sessions, append:

**RACE DAY STRATEGY**
- Mile-by-mile splits (conservative start, build, finish strong)
- HR targets per mile
- Warm-up protocol (5min jog Z2 + 4×20sec strides)
- Fueling (if race >60min)

**STRENGTH CIRCUIT** (2x/week)
- Single-leg deadlifts: 3×10 each leg
- Glute bridges: 3×15
- Clamshells: 3×20 each side
- Planks: 3×30-60sec
- Calf raises: 3×20

Generate the complete plan now. Be specific with paces, HR zones, and workout structures. Base all targets on the athlete's actual performance data above.`;

      userPrompt = `${athleteContext}

${dataContext}

Generate a comprehensive ${raceLabel} ${isAIDecide ? 'fitness assessment, recommended timeline, and complete' : 'season strategy and detailed 4-week'} training plan starting ${planStart}. Schedule workouts only on ${daysStr}. Base all targets on the actual performance data above. Today's date is ${new Date().toISOString().split("T")[0]}.`;
    } else if (type === "post-plan-analysis") {
      // After initial plan generation, analyse existing activities to see if plan needs amending
      const raceLabel = {
        "5k": "5K",
        "10k": "10K",
        "half-marathon": "Half Marathon",
        "marathon": "Marathon",
      }[race_distance as string] || "Half Marathon";

      systemPrompt = `You are an elite endurance coach AI. A new ${raceLabel} training plan has just been generated for the athlete. Your job is to compare the plan against the athlete's RECENT ACTIVITY HISTORY to see if any amendments are warranted.

Look for:
1. **Pacing mismatch**: Are plan targets significantly faster or slower than recent performances?
2. **Volume mismatch**: Is the planned weekly volume a big jump (>10-15%) from recent training?
3. **Intensity distribution**: Does the plan match the athlete's current 80/20 easy-hard balance?
4. **Recovery concerns**: Does sleep/HRV data suggest the athlete needs more recovery than planned?
5. **Injury/limitation flags**: Are there activity patterns suggesting an injury that the plan doesn't account for?

Your response MUST follow this format:

## 🔍 Activity vs Plan Analysis
3-5 bullet points comparing key metrics from recent activities to plan targets.

## ✅ Verdict: [NO CHANGES NEEDED / CHANGES RECOMMENDED]
State clearly whether you recommend amendments.

If CHANGES RECOMMENDED:
## 📝 Recommended Changes
- List specific changes with reasons (3-5 bullets max)
- Be precise: "Reduce Week 1 long run from 15km to 12km because longest recent run was 10km"

If NO CHANGES NEEDED:
## 👍 Plan Looks Good
Brief 1-2 sentence confirmation that the plan aligns well with current fitness.

BREVITY RULES:
- Maximum 150 words total
- Bullet points only, no paragraphs
- Reference specific numbers from the data

${athleteContext}`;

      userPrompt = `${dataContext}

NEW TRAINING PLAN:
${current_plan || "No plan provided"}

Analyse whether the new plan aligns with the athlete's recent activity history, or if amendments are needed. Today's date is ${new Date().toISOString().split("T")[0]}.`;
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

    const { callAI } = await import("../_shared/ai.ts");
    const isChat = type === "chat";
    const priorTurns = isChat && Array.isArray(chatHistory)
      ? chatHistory
          .filter((m: any) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-20)
          // Drop the trailing user turn — we send it as the final userPrompt below.
          .slice(0, -1)
      : [];
    const response = await callAI({
      stream: true,
      maxTokens: 64000,
      messages: [
        { role: "system", content: systemPrompt },
        ...priorTurns,
        { role: "user", content: userPrompt },
      ],
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
