import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Not authenticated");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Not authenticated");

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) throw new Error("Admin access required");

    const { title, customPrompt } = await req.json();
    const hasCustom = typeof customPrompt === "string" && customPrompt.trim().length > 0;
    if (!hasCustom && (!title || typeof title !== "string")) throw new Error("Title or custom prompt is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = hasCustom
      ? `Generate a high-quality, professional blog cover image: ${customPrompt.trim()}. Make it eye-catching, vibrant, suitable as a wide banner image. No text or words in the image.`
      : `Generate a high-quality, professional running / endurance sport blog cover image based on this title: "${title}". Visually represent the subject. Make it eye-catching, vibrant, suitable as a wide banner image. No text or words in the image.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3.1-flash-image-preview",
        messages: [{ role: "user", content: prompt }],
        modalities: ["image", "text"],
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      if (aiResponse.status === 429) return new Response(JSON.stringify({ error: "Rate limited, please try again shortly" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiResponse.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      throw new Error("AI image generation failed");
    }

    const aiData = await aiResponse.json();
    const message = aiData.choices?.[0]?.message;

    let imageUrl: string | undefined;
    if (message?.images && Array.isArray(message.images) && message.images.length > 0) {
      imageUrl = message.images[0]?.image_url?.url;
    }
    if (!imageUrl && Array.isArray(message?.content)) {
      const imgPart = message.content.find((p: any) => p.type === "image_url" || p.type === "image");
      imageUrl = imgPart?.image_url?.url || imgPart?.url;
    }

    if (!imageUrl) {
      const refusal = message?.refusal || message?.content;
      const reason = typeof refusal === "string" && refusal.length > 0 ? refusal.substring(0, 200) : "The AI could not generate an image for this title. Try rewording it.";
      console.error("No image in AI response:", reason);
      return new Response(JSON.stringify({ error: reason }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, "");
    const imageBytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

    const filePath = `ai-${Date.now()}.png`;
    const { error: uploadError } = await supabase.storage
      .from("blog-images")
      .upload(filePath, imageBytes, { contentType: "image/png", upsert: true });
    if (uploadError) throw new Error("Upload failed: " + uploadError.message);

    const { data: urlData } = supabase.storage.from("blog-images").getPublicUrl(filePath);

    return new Response(JSON.stringify({ url: urlData.publicUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-blog-cover error:", e);
    return new Response(JSON.stringify({ error: e.message || "Unknown error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
