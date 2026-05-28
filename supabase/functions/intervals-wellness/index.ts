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

    // Per-user intervals.icu credentials
    const { data: creds } = await supabase
      .from("intervals_credentials")
      .select("athlete_id, api_key")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!creds?.athlete_id || !creds?.api_key) {
      return new Response(
        JSON.stringify({ skipped: "not_connected", synced: 0, total: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch last 90 days of wellness data from Intervals.icu
    const newest = new Date().toISOString().split("T")[0];
    const oldest = new Date(Date.now() - 90 * 86400000).toISOString().split("T")[0];

    const basicAuth = btoa(`API_KEY:${creds.api_key}`);
    const baseUrl = `https://intervals.icu/api/v1/athlete/${creds.athlete_id}`;

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

    // Diagnostic: log first record's keys so we can identify HRV field name
    if (wellnessData.length > 0) {
      const sample = wellnessData[0];
      const hrvRelated = Object.entries(sample).filter(
        ([k, v]) => v != null && /hrv|rmssd|sdnn/i.test(k)
      );
      console.log("Sample wellness record keys:", Object.keys(sample).join(", "));
      console.log("HRV-related fields:", JSON.stringify(hrvRelated));
    }

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

      // Sleep is sourced exclusively from Google Fit (it provides stage breakdown).
      // Intentionally skipping sleep_duration_seconds / sleep_score / sleep stages
      // from Intervals.icu to keep a single source of truth.

      // SpO2
      if (w.spO2 != null) record.spo2 = w.spO2;

      // HRV: try multiple field names used by Intervals.icu / wearables
      const hrvValue = w.hrv ?? w.hrvSDNN ?? w.rMSSD ?? w.morningHrv ?? w.avgHrv ?? w.lnRmssd ?? null;
      if (hrvValue != null) record.hrv = hrvValue;

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
