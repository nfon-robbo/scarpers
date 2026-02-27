import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

/** Authenticate via JWT (Authorization header) or API key (body.api_key) */
async function authenticateRequest(
  req: Request,
  body: Record<string, unknown>
): Promise<{ userId: string; supabase: ReturnType<typeof createClient> }> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Try JWT first (mobile app with user login)
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token !== SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (user && !error) {
        return { userId: user.id, supabase };
      }
    }
  }

  // Fallback to API key (stateless mode)
  const ANDROID_API_KEY = Deno.env.get("ANDROID_API_KEY");
  if (ANDROID_API_KEY && body.api_key === ANDROID_API_KEY) {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    return { userId: (body.user_id as string) || "", supabase: serviceClient };
  }

  throw new Error("Unauthorized");
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const body = await req.json();
    const { type } = body;

    // Authenticate
    let userId = "";
    let supabase: ReturnType<typeof createClient> | null = null;
    try {
      const auth = await authenticateRequest(req, body);
      userId = auth.userId;
      supabase = auth.supabase;
    } catch {
      // Auth failed — only allowed for AI types with API key fallback
    }

    const needsAuth = ["get-plan", "push-activity", "get-activities", "get-profile", "get-metrics", "get-sleep", "push-metrics"].includes(type as string);
    if (needsAuth && (!userId || !supabase)) {
      return new Response(
        JSON.stringify({ success: false, error: "Authentication required. Sign in with your account." }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!needsAuth && !userId && !supabase) {
      const ANDROID_API_KEY = Deno.env.get("ANDROID_API_KEY");
      if (!ANDROID_API_KEY || body.api_key !== ANDROID_API_KEY) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid API key" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ─── SYNC: Get latest training plan ───
    if (type === "get-plan") {
      const { data: plan, error } = await supabase!
        .from("training_plans")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`Failed to fetch plan: ${error.message}`);
      return new Response(
        JSON.stringify({
          success: true,
          type: "get-plan",
          plan: plan
            ? {
                id: plan.id,
                content: plan.content,
                race_distance: plan.race_distance,
                race_date: plan.race_date,
                start_date: plan.start_date,
                training_days: plan.training_days,
                created_at: plan.created_at,
              }
            : null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── SYNC: Push completed activity from mobile/watch ───
    if (type === "push-activity") {
      const activity = body.activity as Record<string, unknown>;
      if (!activity) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing 'activity' object" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const sourceFile = (activity.source_file as string) || `mobile:${Date.now()}`;

      // Deduplicate
      const { data: existing } = await supabase!
        .from("activities")
        .select("id")
        .eq("user_id", userId)
        .eq("source_file", sourceFile)
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ success: true, type: "push-activity", action: "skipped", id: existing.id }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: inserted, error } = await supabase!
        .from("activities")
        .insert({
          user_id: userId,
          activity_type: (activity.activity_type as string) || "running",
          start_time: (activity.start_time as string) || new Date().toISOString(),
          duration_seconds: (activity.duration_seconds as number) || null,
          distance_meters: (activity.distance_meters as number) || null,
          avg_heart_rate: (activity.avg_heart_rate as number) || null,
          max_heart_rate: (activity.max_heart_rate as number) || null,
          avg_speed: (activity.avg_speed as number) || null,
          max_speed: (activity.max_speed as number) || null,
          avg_cadence: (activity.avg_cadence as number) || null,
          avg_power: (activity.avg_power as number) || null,
          total_ascent: (activity.total_ascent as number) || null,
          total_steps: (activity.total_steps as number) || null,
          calories: (activity.calories as number) || null,
          latitude: (activity.latitude as number) || null,
          longitude: (activity.longitude as number) || null,
          source_file: sourceFile,
          raw_data: (activity.raw_data as Record<string, unknown>) || null,
          training_plan_id: (activity.training_plan_id as string) || null,
        })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to insert activity: ${error.message}`);
      return new Response(
        JSON.stringify({ success: true, type: "push-activity", action: "created", id: inserted.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── SYNC: Get recent activities ───
    if (type === "get-activities") {
      const days = (body.days as number) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const { data: activities, error } = await supabase!
        .from("activities")
        .select("id, activity_type, start_time, duration_seconds, distance_meters, avg_heart_rate, source_file, training_plan_id")
        .eq("user_id", userId)
        .gte("start_time", since)
        .order("start_time", { ascending: false });

      if (error) throw new Error(`Failed to fetch activities: ${error.message}`);
      return new Response(
        JSON.stringify({ success: true, type: "get-activities", activities: activities || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── SYNC: Get user profile ───
    if (type === "get-profile") {
      const { data: profile, error } = await supabase!
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

      if (error) throw new Error(`Failed to fetch profile: ${error.message}`);
      return new Response(
        JSON.stringify({ success: true, type: "get-profile", profile }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── SYNC: Get daily metrics (wellness data) ───
    if (type === "get-metrics") {
      const days = (body.days as number) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
      const { data: metrics, error } = await supabase!
        .from("daily_metrics")
        .select("date, resting_heart_rate, hrv, sleep_score, sleep_duration_seconds, weight, body_fat_percentage, stress_score, steps, calories_total")
        .eq("user_id", userId)
        .gte("date", since)
        .order("date", { ascending: false });

      if (error) throw new Error(`Failed to fetch metrics: ${error.message}`);
      return new Response(
        JSON.stringify({ success: true, type: "get-metrics", metrics: metrics || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── SYNC: Get sleep stages ───
    if (type === "get-sleep") {
      const days = (body.days as number) || 14;
      const since = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
      const { data: stages, error } = await supabase!
        .from("sleep_stages")
        .select("date, stage, duration_seconds, start_time, end_time, source")
        .eq("user_id", userId)
        .gte("date", since)
        .order("date", { ascending: false });

      if (error) throw new Error(`Failed to fetch sleep: ${error.message}`);
      return new Response(
        JSON.stringify({ success: true, type: "get-sleep", stages: stages || [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── SYNC: Push daily metrics from mobile ───
    if (type === "push-metrics") {
      const metric = body.metric as Record<string, unknown>;
      if (!metric || !metric.date) {
        return new Response(
          JSON.stringify({ success: false, error: "Missing 'metric' object with 'date'" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data, error } = await supabase!
        .from("daily_metrics")
        .upsert({
          user_id: userId,
          date: metric.date as string,
          resting_heart_rate: (metric.resting_heart_rate as number) || null,
          hrv: (metric.hrv as number) || null,
          sleep_score: (metric.sleep_score as number) || null,
          sleep_duration_seconds: (metric.sleep_duration_seconds as number) || null,
          weight: (metric.weight as number) || null,
          steps: (metric.steps as number) || null,
          stress_score: (metric.stress_score as number) || null,
          calories_total: (metric.calories_total as number) || null,
          source_file: (metric.source_file as string) || "mobile",
        }, { onConflict: "user_id,date" })
        .select("id")
        .single();

      if (error) throw new Error(`Failed to upsert metric: ${error.message}`);
      return new Response(
        JSON.stringify({ success: true, type: "push-metrics", id: data?.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }


    const {
      race_distance,
      training_days,
      start_date,
      race_date,
      message,
      athlete,
      activities: activityData,
      metrics,
    } = body;

    const athleteContext = `
Athlete: ${(athlete as any)?.name || "Unknown"}
Primary Sport: ${(athlete as any)?.sport || "running"}
Experience: ${(athlete as any)?.experience || "intermediate"}
Goals: ${(athlete as any)?.goals || "general fitness"}
Additional Context: ${(athlete as any)?.context || "none"}
`;

    let dataContext = "";
    if (activityData && Array.isArray(activityData) && activityData.length > 0) {
      dataContext += `\nTRAINING DATA (${activityData.length} activities):\n${JSON.stringify(activityData, null, 2)}\n`;
    }
    if (metrics && Array.isArray(metrics) && (metrics as any[]).length > 0) {
      dataContext += `\nDAILY HEALTH METRICS (${(metrics as any[]).length} days):\n${JSON.stringify(metrics, null, 2)}\n`;
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
      const planStart = (start_date as string) || new Date().toISOString().split("T")[0];
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

      userPrompt = (message as string) || "Hello, I'd like some coaching advice.";
    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid type. Use "training-plan", "chat", "get-plan", "push-activity", "get-activities", "get-profile", "get-metrics", "get-sleep", or "push-metrics".' }),
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
