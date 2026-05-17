import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_PAGES = `
- / (homepage — AI running coach pitch, hero, features)
- /5k-training-plan (5K training plan landing page)
- /10k-training-plan (10K training plan landing page)
- /ai-running-coach (AI coach explainer)
- /coach/claire-rayners (coach persona page)
- /about
- /blog (blog listing + individual posts at /blog/:slug)
`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const sb = createClient(supabaseUrl, supabaseKey, { global: { headers: { Authorization: authHeader! } } });

    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin");
    if (!roles || roles.length === 0) return json({ error: "Forbidden" }, 403);

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return json({ error: "AI not configured" }, 500);

    const body = await req.json();
    const { keyword, position, action, volume, difficulty, provider } = body;
    if (!keyword) return json({ error: "keyword is required" }, 400);

    // === APPLY: generate full blog post draft ===
    if (action === "apply") {
      const { suggestionTitle, suggestionDescription, suggestionType, blogTitle, blogSlug, blogOutline } = body;

      const finalTitle = blogTitle || `${suggestionTitle} – ${keyword}`;
      const finalSlug = (blogSlug || `${keyword}-${suggestionType || "guide"}`)
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

      const SCARPERS_BLOG_RULES = `
PERMANENT BLOG RULES (cannot be overridden):

AUTHOR/ATTRIBUTION:
- Never attribute the post to any named individual (no "Claire Rayners", no coach name, no reviewer name).
- Do not write in first person as a coach. No "I", "as your coach", "Hello fellow runners", or similar.
- No byline inside the body. Attribution is handled by the site as "By the Scarpers Team".

CONTENT ACCURACY:
- Never invent case studies, testimonials, or named user stories. If illustrating, use clearly hypothetical phrasing like "for example, a runner who...".
- Do NOT claim Scarpers has Apple Watch integration, calendar integration, or any feature not confirmed as live. Stick to: AI training plans, Garmin/Strava/Google Fit data import, readiness/Running IQ insights.
- No superlatives like "UK's leading" or unverifiable marketing claims.

TONE:
- Direct, informative, authoritative. No coaching persona, no casual openers, minimal marketing language.
- Prefer prose paragraphs over bullet-list-heavy structure. Use lists only when genuinely list-like.
- Reserve the Scarpers call-to-action for the FINAL section only.

RUNNING SCIENCE (apply where relevant, accurately):
- 80/20 rule: ~80% easy aerobic, ~20% hard.
- 10% rule: never increase weekly mileage by more than ~10% week-on-week.
- 5-zone heart-rate model, with zone 2 as the primary aerobic development zone.
- Cadence: 170-180 spm as an efficiency target for most runners; acknowledge this is not absolute, especially for beginners.
- Progressive overload with a deload week every 3-4 weeks.
- Adaptation happens during recovery, not during the run.
- Specificity: training should reflect the goal race distance and pace.
- Never recommend unsafe volumes/intensities for the stated level. Always acknowledge injury history as a plan-design factor.

SEO/STRUCTURE:
- Single H1 containing the primary keyword. H2 subheadings throughout (H3 only where genuinely nested).
- Minimum 800 words. No keyword stuffing — write for the reader first.
- End with one natural call-to-action linking to https://www.scarpers.co.uk/.
- UK English spelling throughout. Return ONLY the HTML body content (no <html>/<body> tags, no markdown fences).`;

      const contentPrompt = suggestionType === "blog_post" && blogOutline
        ? `Write a comprehensive, SEO-optimised blog post for scarpers.co.uk (an AI running coach app for UK runners) targeting the keyword "${keyword}".
H1 title: "${finalTitle}"
Cover these points in detail:
${blogOutline.map((p: string) => `- ${p}`).join("\n")}

${SCARPERS_BLOG_RULES}`
        : `Write SEO content for scarpers.co.uk, an AI running coach app for UK runners.
Recommendation for keyword "${keyword}":
Title: ${suggestionTitle}
Description: ${suggestionDescription}
Type: ${suggestionType}

Write a comprehensive, SEO-optimised blog post addressing this recommendation and targeting "${keyword}".

${SCARPERS_BLOG_RULES}`;

      const useClaude = provider === "claude";
      let generatedContent = `<h2>${finalTitle}</h2><p>Draft content for: ${keyword}</p>`;
      let generatedExcerpt = `Guide about ${keyword} for UK runners.`;

      if (useClaude) {
        const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!anthropicKey) return json({ error: "Claude (ANTHROPIC_API_KEY) not configured" }, 500);
        const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-5",
            max_tokens: 4000,
            messages: [{ role: "user", content: contentPrompt }],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const raw = aiData.content?.[0]?.text || "";
          if (raw) generatedContent = raw.replace(/```html\n?/g, "").replace(/```\n?/g, "").trim();
          const plain = generatedContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          generatedExcerpt = plain.substring(0, 150).trim() + "…";
        } else {
          const errText = await aiRes.text();
          console.error("Claude error:", aiRes.status, errText);
          return json({ error: `Claude generation failed: ${aiRes.status}` }, 500);
        }
      } else {
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [{ role: "user", content: contentPrompt }],
          }),
        });
        if (aiRes.ok) {
          const aiData = await aiRes.json();
          const raw = aiData.choices?.[0]?.message?.content || "";
          if (raw) generatedContent = raw.replace(/```html\n?/g, "").replace(/```\n?/g, "").trim();
          const plain = generatedContent.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          generatedExcerpt = plain.substring(0, 150).trim() + "…";
        }
      }

      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminSb = createClient(supabaseUrl, serviceKey);

      const { data: post, error: insertErr } = await adminSb
        .from("blog_posts")
        .upsert({
          title: finalTitle,
          content: generatedContent,
          slug: finalSlug,
          excerpt: generatedExcerpt,
          author_id: user.id,
          published: false,
        }, { onConflict: "slug" })
        .select("id, slug")
        .single();

      if (insertErr) return json({ error: insertErr.message }, 500);

      return json({ applied: true, post });
    }

    // === SUGGEST ===
    const positionInfo = position
      ? `The site currently ranks at position #${position} for this keyword.`
      : `The site is NOT currently in the top 100 for this keyword.`;
    const meta = [
      volume != null ? `Monthly search volume (UK): ~${volume}` : null,
      difficulty != null ? `Semrush keyword difficulty: ${difficulty}/100` : null,
    ].filter(Boolean).join("\n");

    const prompt = `You are an SEO expert for scarpers.co.uk, an AI running coach app for UK runners.

Target keyword: "${keyword}"
${positionInfo}
${meta}

Existing pages on the site:${SITE_PAGES}

HARD RULES:
- NEVER suggest editing, rewriting, or optimising the homepage ("/") meta title or meta description. The homepage meta is locked and off-limits.
- "meta_update" suggestions are only allowed for non-homepage routes (e.g. /5k-training-plan, /10k-training-plan, /ai-running-coach, /coach/claire-rayners, /about, /blog/*).

Suggest 3-5 concrete, actionable SEO improvements to rank higher for "${keyword}". For each:
1. "type": one of "blog_post", "meta_update", "content_addition", "faq_schema", "internal_link"
2. "title": short title of the action
3. "description": 2-3 sentence explanation
4. "effort": "low" | "medium" | "high"
5. "impact": "low" | "medium" | "high"

If you suggest a blog post, also include:
- "blogTitle": SEO-optimised title under 60 chars
- "blogSlug": URL-friendly slug
- "blogOutline": 5-8 bullet points covering what the post should include

Return ONLY valid JSON: { "suggestions": [...] }`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        tools: [{
          type: "function",
          function: {
            name: "seo_suggestions",
            description: "Return SEO improvement suggestions",
            parameters: {
              type: "object",
              properties: {
                suggestions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", enum: ["blog_post", "meta_update", "content_addition", "faq_schema", "internal_link"] },
                      title: { type: "string" },
                      description: { type: "string" },
                      effort: { type: "string", enum: ["low", "medium", "high"] },
                      impact: { type: "string", enum: ["low", "medium", "high"] },
                      blogTitle: { type: "string" },
                      blogSlug: { type: "string" },
                      blogOutline: { type: "array", items: { type: "string" } },
                    },
                    required: ["type", "title", "description", "effort", "impact"],
                  },
                },
              },
              required: ["suggestions"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "seo_suggestions" } },
      }),
    });

    if (!aiResponse.ok) {
      const err = await aiResponse.text();
      console.error("AI error:", aiResponse.status, err);
      if (aiResponse.status === 429) return json({ error: "Rate limited, please try again later." }, 429);
      if (aiResponse.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: "AI generation failed" }, 500);
    }

    const aiData = await aiResponse.json();
    let suggestions: { suggestions: any[] } = { suggestions: [] };
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (toolCall?.function?.arguments) {
      try { suggestions = JSON.parse(toolCall.function.arguments); } catch { /* */ }
    } else {
      try { suggestions = JSON.parse(aiData.choices?.[0]?.message?.content || "{}"); } catch { /* */ }
    }

    // Safety net: strip any meta_update suggestion that targets the homepage
    const homepageRefs = /(\bhome\s*page\b|\bhomepage\b|\blanding\s*page\b|^\/$|["'`\s]\/["'`\s]|index\.html|root\s+page)/i;
    suggestions.suggestions = (suggestions.suggestions || []).filter((s: any) => {
      if (s?.type !== "meta_update") return true;
      const blob = `${s.title || ""} ${s.description || ""}`;
      return !homepageRefs.test(blob);
    });

    const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    suggestions.suggestions?.sort((a: any, b: any) => (impactOrder[a.impact] ?? 3) - (impactOrder[b.impact] ?? 3));

    return json({ ...suggestions, tokens: aiData.usage || {} });
  } catch (error) {
    console.error("Error:", error);
    return json({ error: String(error) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
