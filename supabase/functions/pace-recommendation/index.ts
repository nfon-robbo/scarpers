/**
 * pace-recommendation — an elite-coach recommendation for a new running pace
 * when the athlete says their current target is too slow (or too hard).
 *
 * Returns strict JSON: { pace: "8:30-8:50/km", rationale: "..." }.
 * Callers must treat any failure as "use the deterministic fallback" — this
 * endpoint never mutates the plan.
 */
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

const MODEL = "openai/gpt-6-astra";

interface Body {
  currentPace: string;       // "8:55-9:15/km"
  sessionType: string;       // "easy" | "threshold" | ...
  workoutTitle?: string;
  direction?: "faster" | "slower";
  feedback?: string;         // what the runner said
}

const PACE_RE = /^\d{1,2}:[0-5]\d(?:-\d{1,2}:[0-5]\d)?\/km$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const key = Deno.env.get("LOVABLE_API_KEY");
    if (!key) return json({ error: "Missing LOVABLE_API_KEY" }, 500);

    const body: Body = await req.json();
    if (!body?.currentPace || !body?.sessionType) {
      return json({ error: "currentPace and sessionType are required" }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supa.auth.getUser();
    const userId = userData?.user?.id;
    if (!userId) return json({ error: "unauthorized" }, 401);

    // Context: measured benchmark + recent runs.
    const { data: bench } = await supa
      .from("benchmark_results")
      .select("threshold_pace_s_per_km, threshold_hr, lthr, benchmark_date, confidence_band")
      .eq("user_id", userId)
      .eq("active", true)
      .order("benchmark_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const since = new Date(Date.now() - 42 * 86400_000).toISOString();
    const { data: acts } = await supa
      .from("activities")
      .select("start_time, distance_meters, duration_seconds, avg_heart_rate, activity_type")
      .eq("user_id", userId)
      .gte("start_time", since)
      .order("start_time", { ascending: false })
      .limit(25);

    const runLines = (acts ?? [])
      .filter((a: any) => /run/i.test(a.activity_type ?? "") && a.distance_meters > 400 && a.duration_seconds > 300)
      .slice(0, 12)
      .map((a: any) => {
        const secPerKm = a.duration_seconds / (a.distance_meters / 1000);
        const mm = Math.floor(secPerKm / 60);
        const ss = Math.round(secPerKm % 60);
        return `- ${String(a.start_time).slice(0, 10)}: ${(a.distance_meters / 1000).toFixed(2)} km @ ${mm}:${String(ss).padStart(2, "0")}/km${a.avg_heart_rate ? `, avg HR ${Math.round(a.avg_heart_rate)}` : ""}`;
      })
      .join("\n") || "- no recent runs recorded";

    const benchLine = bench?.threshold_pace_s_per_km
      ? `Measured threshold pace: ${Math.floor(bench.threshold_pace_s_per_km / 60)}:${String(Math.round(bench.threshold_pace_s_per_km % 60)).padStart(2, "0")}/km (LTHR ${bench.lthr ?? bench.threshold_hr ?? "n/a"}, ${bench.benchmark_date}, confidence ${bench.confidence_band ?? "n/a"})`
      : "No measured benchmark on file.";

    const system = `You are an elite running coach. The athlete says a prescribed pace is not right for them. Recommend a new target pace band for that session type.

RULES
- Be conservative: never recommend more than 10% faster than the current pace.
- Prefer a band (e.g. "8:30-8:50/km"), not a single number, for easy/steady work.
- Ground the number in their measured threshold pace and recent runs when available.
- Respond with STRICT JSON ONLY, no markdown, matching:
  {"pace":"M:SS-M:SS/km","rationale":"one or two short sentences"}
- The pace MUST be in min/km with the /km suffix.`;

    const user = `Session type: ${body.sessionType}
Workout: ${body.workoutTitle ?? "n/a"}
Current prescribed pace: ${body.currentPace}
Athlete wants it: ${body.direction === "slower" ? "easier/slower" : "faster"}
Athlete said: ${(body.feedback ?? "").slice(0, 500) || "the pace is too slow"}

${benchLine}

Recent runs (most recent first):
${runLines}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        reasoning: { effort: "low" },
        input: [
          { role: "system", content: [{ type: "input_text", text: system }] },
          { role: "user", content: [{ type: "input_text", text: user }] },
        ],
      }),
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return json({ error: `gateway ${res.status}`, detail: text.slice(0, 500) }, res.status || 502);
    }

    // Accumulate the SSE output text.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let out = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload);
            if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
              out += evt.delta;
            }
          } catch { /* ignore keepalives */ }
        }
      }
    }

    const match = out.match(/\{[\s\S]*\}/);
    if (!match) return json({ error: "no_json", raw: out.slice(0, 300) }, 502);
    let parsed: { pace?: string; rationale?: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return json({ error: "bad_json", raw: out.slice(0, 300) }, 502);
    }
    const pace = (parsed.pace ?? "").replace(/\s+/g, "");
    if (!PACE_RE.test(pace)) return json({ error: "bad_pace", raw: parsed.pace ?? "" }, 502);

    return json({ pace, rationale: parsed.rationale ?? "" });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
