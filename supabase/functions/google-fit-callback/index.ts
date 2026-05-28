import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function popupPage(opts: { title: string; body: string; success?: boolean }) {
  const accent = opts.success ? "#a78bfa" : "#f87171";
  const icon = opts.success ? "✓" : "✕";
  const messageType = opts.success ? "google-fit-connected" : "google-fit-error";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${opts.title} · Scarpers</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;height:100%;}
  body{
    background:radial-gradient(ellipse at top,#1a0f2e 0%,#0b0613 60%);
    color:#e7e3f1;font-family:Inter,system-ui,sans-serif;
    display:flex;align-items:center;justify-content:center;padding:24px;
  }
  .card{
    max-width:380px;width:100%;text-align:center;
    background:rgba(255,255,255,0.04);
    border:1px solid rgba(167,139,250,0.18);
    border-radius:20px;padding:36px 28px;
    backdrop-filter:blur(12px);
    box-shadow:0 20px 60px rgba(0,0,0,0.4);
  }
  .icon{
    width:64px;height:64px;border-radius:50%;
    background:${accent}22;color:${accent};
    display:flex;align-items:center;justify-content:center;
    font-size:32px;margin:0 auto 20px;font-weight:700;
  }
  h1{
    font-family:'Bebas Neue',sans-serif;font-weight:400;
    font-size:34px;letter-spacing:0.04em;margin:0 0 10px;color:#fff;
  }
  p{margin:0 0 24px;color:#b4adc7;font-size:15px;line-height:1.5;}
  button{
    background:${accent};color:#0b0613;border:0;border-radius:12px;
    padding:12px 22px;font-weight:600;font-size:14px;cursor:pointer;
    font-family:inherit;
  }
  button:hover{filter:brightness(1.08);}
</style>
</head>
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
</body>
</html>`;
  return new Response(html, {
    headers: new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    }),
  });
}

Deno.serve(async (req) => {
  const GOOGLE_FIT_CLIENT_ID = Deno.env.get("GOOGLE_FIT_CLIENT_ID")!;
  const GOOGLE_FIT_CLIENT_SECRET = Deno.env.get("GOOGLE_FIT_CLIENT_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return popupPage({ title: "Authorization denied", body: "You cancelled Google Fit access. You can try again from Settings." });
  }

  if (!code || !state) {
    return popupPage({ title: "Something went wrong", body: "Missing authorization code. Please try connecting again." });
  }

  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/google-fit-callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_FIT_CLIENT_ID,
        client_secret: GOOGLE_FIT_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error("Google token exchange failed:", err);
      return popupPage({ title: "Connection failed", body: "Google rejected the authorization code. Please try again." });
    }

    const tokenData = await tokenRes.json();

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: nonceRow } = await supabase
      .from("oauth_state")
      .select("user_id, expires_at")
      .eq("nonce", state)
      .eq("provider", "google_fit")
      .maybeSingle();

    if (!nonceRow || new Date(nonceRow.expires_at).getTime() < Date.now()) {
      return popupPage({ title: "Link expired", body: "This connection link has expired. Please start again from Settings." });
    }
    await supabase.from("oauth_state").delete().eq("nonce", state);
    const user = { id: nonceRow.user_id };

    const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);

    const { error: dbError } = await supabase.from("google_fit_tokens").upsert(
      {
        user_id: user.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
      },
      { onConflict: "user_id" }
    );

    if (dbError) {
      console.error("DB upsert error:", dbError);
      return popupPage({ title: "Couldn't save", body: "We connected to Google but couldn't store your tokens. Please try again." });
    }

    return popupPage({
      title: "Connected",
      body: "Google Fit is linked. This window will close automatically.",
      success: true,
    });
  } catch (error) {
    console.error("Google Fit callback error:", error);
    return popupPage({ title: "Something went wrong", body: "An unexpected error occurred. Please try again." });
  }
});
