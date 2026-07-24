/**
 * benchmark-coach-verdict — generates a short elite-coach take from the
 * structured interview answers. Called after the interview saves. Its
 * output is stored on post_benchmark_interview.verdict; failure MUST NOT
 * roll back the benchmark save.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

interface Body {
  benchmarkId: string;
}

const MODEL = "google/gemini-3.6-flash";

const SYSTEM = `You are an elite running coach with 30 years of experience training Olympians and everyday runners. You write in a direct, warm, no-filler voice.

Given a runner's post-benchmark interview and detection signals, produce a "Coach's take":
- Maximum 120 words.
- 3-5 short markdown bullets.
- Reference specifics from what they answered — do not repeat the raw options verbatim, translate them into coach observations.
- If "Old injury" was flagged, address it first with care.
- If the effort was likely submaximal, name it plainly and say what next time should look like.
- No emojis. No headings. Bullets only. No sign-off.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) {
      return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { benchmarkId }: Body = await req.json();
    if (!benchmarkId) {
      return new Response(JSON.stringify({ error: "benchmarkId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate the caller owns this benchmark row.
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supa.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: row, error } = await svc
      .from("benchmark_results")
      .select(
        "user_id, benchmark_protocol, effort_window_duration_s, effort_window_distance_m, threshold_pace_s_per_km, threshold_hr, confidence_score, confidence_band, likely_submaximal, rpe_response, could_continue_response, held_back_reasons, slowdown_reason, breaks_reasons, stoppage_duration_band, conditions, injury_flagged, post_benchmark_interview",
      )
      .eq("id", benchmarkId)
      .maybeSingle();
    if (error || !row || row.user_id !== userId) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const facts = {
      protocol: row.benchmark_protocol,
      duration_min: Math.round((row.effort_window_duration_s ?? 0) / 60),
      distance_km: Math.round(((row.effort_window_distance_m ?? 0) / 1000) * 100) / 100,
      threshold_pace_s_per_km: row.threshold_pace_s_per_km,
      threshold_hr: row.threshold_hr,
      confidence: `${row.confidence_band ?? "?"} (${row.confidence_score ?? "?"}/100)`,
      likely_submaximal: row.likely_submaximal,
      rpe: row.rpe_response,
      could_continue: row.could_continue_response,
      held_back: row.held_back_reasons,
      slowdown_reason: row.slowdown_reason,
      breaks: row.breaks_reasons,
      stoppage_band: row.stoppage_duration_band,
      conditions: row.conditions,
      injury_flagged: row.injury_flagged,
      detection: (row.post_benchmark_interview as any)?.detection ?? null,
      hr_sensor: (row.post_benchmark_interview as any)?.hr_sensor_type_at_capture ?? null,
    };

    const userMsg = `Runner just completed a benchmark. Here is what we know:\n\n\`\`\`json\n${JSON.stringify(facts, null, 2)}\n\`\`\`\n\nWrite the Coach's take.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: userMsg }],
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      return new Response(JSON.stringify({ error: `AI gateway ${res.status}`, detail: t }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await res.json();
    const verdict = json?.choices?.[0]?.message?.content?.trim() ?? "";

    if (verdict) {
      const existing = (row.post_benchmark_interview as any) ?? {};
      await svc.from("benchmark_results")
        .update({
          post_benchmark_interview: {
            ...existing,
            verdict,
            verdict_at: new Date().toISOString(),
            verdict_model: MODEL,
          },
        })
        .eq("id", benchmarkId);
    }

    return new Response(JSON.stringify({ ok: true, model: MODEL, verdict }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
