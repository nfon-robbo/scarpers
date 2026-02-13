import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const STRAVA_CLIENT_ID = Deno.env.get("STRAVA_CLIENT_ID");
  const STRAVA_CLIENT_SECRET = Deno.env.get("STRAVA_CLIENT_SECRET");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    return new Response(JSON.stringify({ error: "Strava credentials not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // Step 1: Generate the Strava OAuth URL
    if (action === "authorize") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Pass user's JWT as state so we can identify them on callback
      const token = authHeader.replace("Bearer ", "");
      const redirectUri = `${SUPABASE_URL}/functions/v1/strava-auth?action=callback`;
      const scope = "read,activity:read_all";
      const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${token}`;

      return new Response(JSON.stringify({ url: stravaUrl }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 2: OAuth callback — exchange code for tokens
    if (action === "callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state"); // user JWT
      const errorParam = url.searchParams.get("error");

      if (errorParam) {
        return new Response(`<html><body><script>window.close();</script>Strava authorization denied.</body></html>`, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (!code || !state) {
        return new Response("Missing code or state", { status: 400 });
      }

      // Exchange code for tokens
      const tokenRes = await fetch("https://www.strava.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          code,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        console.error("Strava token exchange failed:", err);
        return new Response(`<html><body><script>window.close();</script>Token exchange failed.</body></html>`, {
          headers: { "Content-Type": "text/html" },
        });
      }

      const tokenData = await tokenRes.json();

      // Verify user from JWT state
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: { user }, error: userError } = await supabase.auth.getUser(state);

      if (userError || !user) {
        console.error("Invalid JWT state:", userError);
        return new Response(`<html><body><script>window.close();</script>Authentication failed.</body></html>`, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Upsert tokens
      const { error: dbError } = await supabase.from("strava_tokens").upsert(
        {
          user_id: user.id,
          athlete_id: tokenData.athlete.id,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token,
          expires_at: tokenData.expires_at,
        },
        { onConflict: "user_id" }
      );

      if (dbError) {
        console.error("DB upsert error:", dbError);
        return new Response(`<html><body><script>window.close();</script>Failed to save tokens.</body></html>`, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Redirect back to app
      const appUrl = url.origin.replace("datdwxsugeobqigtopnz.supabase.co", "id-preview--a8999b7f-9989-4a1f-a2b0-909ccd9e7b62.lovable.app");
      return new Response(
        `<html><body><script>window.opener?.postMessage('strava-connected','*');window.close();</script><p>Connected! You can close this window.</p></body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    // Step 3: Check connection status
    if (action === "status") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data } = await supabase.from("strava_tokens").select("athlete_id").eq("user_id", user.id).maybeSingle();
      return new Response(JSON.stringify({ connected: !!data, athlete_id: data?.athlete_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Step 4: Disconnect
    if (action === "disconnect") {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: { user } } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("strava_tokens").delete().eq("user_id", user.id);
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Strava auth error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
