import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function popupPage(opts: { title: string; body: string; success?: boolean }) {
  const accent = opts.success ? "#fc4c02" : "#f87171";
  const icon = opts.success ? "✓" : "✕";
  const messageType = opts.success ? "strava-connected" : "strava-error";
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${opts.title} · Scarpers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;height:100%;}
  body{background:radial-gradient(ellipse at top,#1a0f2e 0%,#0b0613 60%);color:#e7e3f1;font-family:Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:24px;}
  .card{max-width:380px;width:100%;text-align:center;background:rgba(255,255,255,0.04);border:1px solid rgba(252,76,2,0.18);border-radius:20px;padding:36px 28px;backdrop-filter:blur(12px);box-shadow:0 20px 60px rgba(0,0,0,0.4);}
  .icon{width:64px;height:64px;border-radius:50%;background:${accent}22;color:${accent};display:flex;align-items:center;justify-content:center;font-size:32px;margin:0 auto 20px;font-weight:700;}
  h1{font-family:'Bebas Neue',sans-serif;font-weight:400;font-size:34px;letter-spacing:0.04em;margin:0 0 10px;color:#fff;}
  p{margin:0 0 24px;color:#b4adc7;font-size:15px;line-height:1.5;}
  button{background:${accent};color:#fff;border:0;border-radius:12px;padding:12px 22px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;}
  button:hover{filter:brightness(1.08);}
</style></head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${opts.title}</h1>
    <p>${opts.body}</p>
    <button onclick="window.close()">Close window</button>
  </div>
  <script>
    try { window.opener && window.opener.postMessage(${JSON.stringify(messageType)}, '*'); } catch(e){}
    setTimeout(function(){ try { window.close(); } catch(e){} }, 600);
  </script>
</body></html>`;
  return new Response(html, {
    headers: new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

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

      // Verify caller, then mint an opaque nonce so the JWT never enters the URL.
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: { user }, error: userErr } = await supabase.auth.getUser(
        authHeader.replace("Bearer ", "")
      );
      if (userErr || !user) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const nonce = crypto.randomUUID();
      const { error: nonceErr } = await supabase.from("oauth_state").insert({
        nonce, user_id: user.id, provider: "strava",
      });
      if (nonceErr) {
        console.error("oauth_state insert failed:", nonceErr);
        return new Response(JSON.stringify({ error: "Failed to start OAuth" }), {
          status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const redirectUri = `${SUPABASE_URL}/functions/v1/strava-auth?action=callback`;
      const scope = "read,activity:read_all";
      const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${nonce}`;

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
        return popupPage({ title: "Authorization denied", body: "You cancelled Strava access. You can try again from Settings." });
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
        return popupPage({ title: "Connection failed", body: "Strava rejected the authorization. Please try again." });
      }

      const tokenData = await tokenRes.json();

      // Look up the nonce we minted on `authorize` to find the user.
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { data: nonceRow } = await supabase
        .from("oauth_state")
        .select("user_id, expires_at")
        .eq("nonce", state)
        .eq("provider", "strava")
        .maybeSingle();

      if (!nonceRow || new Date(nonceRow.expires_at).getTime() < Date.now()) {
        return popupPage({ title: "Link expired", body: "This connection link has expired. Please start again from Settings." });
      }
      // Single-use: delete now.
      await supabase.from("oauth_state").delete().eq("nonce", state);
      const user = { id: nonceRow.user_id };

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
        return popupPage({ title: "Couldn't save", body: "We connected to Strava but couldn't store your tokens. Please try again." });
      }

      return popupPage({
        title: "Connected",
        body: "Strava is linked. This window will close automatically.",
        success: true,
      });
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
