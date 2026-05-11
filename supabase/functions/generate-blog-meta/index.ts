import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) throw new Error("Not authenticated");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) throw new Error("Not authenticated");
    const userId = claimsData.claims.sub;

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) throw new Error("Admin access required");

    const { type, title, content } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const plainContent = content ? content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().substring(0, 3000) : "";

    let systemPrompt: string;
    let userPrompt: string;

    if (type === "title") {
      if (!plainContent) throw new Error("Content is required — write your blog post first");
      systemPrompt = `You are an SEO copywriter for Scarpers, an AI running coach blog. Read the blog content below and generate 3 compelling titles that accurately reflect the content. Requirements:
- Each title should be SEO-friendly (50-65 chars ideal)
- Target UK runners (5K, 10K, half marathon, marathon, ultra)
- Use UK English
- Click-worthy but not clickbait
- Include relevant keywords naturally from the content
- Return ONLY a JSON array of 3 title strings, e.g. ["Title 1", "Title 2", "Title 3"]`;
      userPrompt = `Blog content:\n${plainContent}`;
    } else if (type === "slug") {
      const source = plainContent || title || "";
      if (!source) throw new Error("Title or content is required");
      systemPrompt = `You are an SEO expert. Generate an SEO-optimised URL slug for a running blog post.
- Lowercase, hyphens only (no underscores or special chars)
- 3-6 words, concise and keyword-rich
- Remove filler words unless needed for clarity
- Return ONLY the slug string, nothing else`;
      userPrompt = title ? `Blog title: ${title}\nContent: ${source.substring(0, 1500)}` : `Blog content: ${source.substring(0, 1500)}`;
    } else {
      throw new Error("Invalid type — use 'title' or 'slug'");
    }

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResponse.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI generation failed");
    }

    const aiData = await aiResponse.json();
    const raw = aiData.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("No response from AI");

    if (type === "title") {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```/g, "").trim();
      let titles: string[];
      try { titles = JSON.parse(cleaned); }
      catch { titles = cleaned.split("\n").map((t: string) => t.replace(/^\d+\.\s*/, "").replace(/^["']|["']$/g, "").trim()).filter(Boolean); }
      return new Response(JSON.stringify({ titles: titles.slice(0, 3) }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    } else {
      const slug = raw.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/--+/g, "-").replace(/^-|-$/g, "");
      return new Response(JSON.stringify({ slug }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  } catch (e: any) {
    console.error("generate-blog-meta error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
