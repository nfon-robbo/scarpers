import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const INTERVALS_API_KEY = Deno.env.get("INTERVALS_API_KEY");
    const INTERVALS_ATHLETE_ID = Deno.env.get("INTERVALS_ATHLETE_ID");

    if (!INTERVALS_API_KEY || !INTERVALS_ATHLETE_ID) {
      return new Response(
        JSON.stringify({ error: "Intervals.icu credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Fetch last 90 days of wellness data from Intervals.icu
    const newest = new Date().toISOString().split("T")[0];
    const oldest = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

    const basicAuth = btoa(`API_KEY:${INTERVALS_API_KEY}`);
    const baseUrl = `https://intervals.icu/api/v1/athlete/${INTERVALS_ATHLETE_ID}`;

    const resp = await fetch(
      `${baseUrl}/wellness?oldest=${oldest}&newest=${newest}`,
      {
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Intervals.icu wellness error:", resp.status, errText);
      throw new Error(`Intervals.icu API error: ${resp.status}`);
    }

    const wellnessData = await resp.json();
    console.log(`Fetched ${wellnessData.length} wellness records from Intervals.icu`);

    let upserted = 0;
    let skipped = 0;

    for (const w of wellnessData) {
      if (!w.id) continue; // id is the date string YYYY-MM-DD

      // Map Intervals.icu wellness fields to our daily_metrics
      const record: Record<string, unknown> = {
        user_id: user.id,
        date: w.id,
        source_file: "intervals.icu",
      };

      // Sleep: Intervals.icu provides sleepTime in seconds and sleepScore
      if (w.sleepTime != null) record.sleep_duration_seconds = w.sleepTime;
      if (w.sleepScore != null) record.sleep_score = w.sleepScore;
      if (w.sleepQuality != null && record.sleep_score == null) record.sleep_score = w.sleepQuality;

      // HRV
      if (w.hrv != null) record.hrv = w.hrv;

      // Resting HR
      if (w.restingHR != null) record.resting_heart_rate = w.restingHR;

      // Weight
      if (w.weight != null) record.weight = w.weight;

      // Steps
      if (w.steps != null) record.steps = w.steps;

      // Stress / readiness
      if (w.stress != null) record.stress_score = w.stress;

      // Body fat
      if (w.bodyFat != null) record.body_fat_percentage = w.bodyFat;

      // Calories
      if (w.calories != null) record.calories_total = w.calories;

      // Only upsert if we have at least some data beyond user_id/date
      const hasData = Object.keys(record).some(
        (k) => !["user_id", "date", "source_file"].includes(k) && record[k] != null
      );

      if (!hasData) {
        skipped++;
        continue;
      }

      // Upsert by user_id + date
      const { data: existing } = await supabase
        .from("daily_metrics")
        .select("id")
        .eq("user_id", user.id)
        .eq("date", w.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("daily_metrics")
          .update(record)
          .eq("id", existing.id);
      } else {
        await supabase
          .from("daily_metrics")
          .insert(record);
      }

      upserted++;
    }

    console.log(`Wellness sync: ${upserted} upserted, ${skipped} skipped`);

    return new Response(
      JSON.stringify({ synced: upserted, skipped, total: wellnessData.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("intervals-wellness error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
