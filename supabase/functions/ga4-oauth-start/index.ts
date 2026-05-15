import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CLIENT_ID = Deno.env.get("GA4_OAUTH_CLIENT_ID");
  if (!CLIENT_ID) {
    return json({ error: "GA4_OAUTH_CLIENT_ID not set" }, 500);
  }

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user } } = await sb.auth.getUser(auth.replace("Bearer ", ""));
  if (!user) return json({ error: "Unauthorized" }, 401);

  const { data: roles } = await sb.from("user_roles").select("role")
    .eq("user_id", user.id).eq("role", "admin");
  if (!roles || roles.length === 0) return json({ error: "Forbidden" }, 403);

  const nonce = crypto.randomUUID();
  await sb.from("oauth_state").insert({ nonce, user_id: user.id, provider: "ga4" });

  const redirectUri = `${SUPABASE_URL}/functions/v1/ga4-oauth-callback`;
  const scope = "https://www.googleapis.com/auth/analytics.readonly";
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(CLIENT_ID)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent(scope)}&access_type=offline&prompt=consent&state=${nonce}`;

  return json({ url });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
