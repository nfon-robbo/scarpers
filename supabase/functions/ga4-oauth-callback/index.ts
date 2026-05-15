import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const CLIENT_ID = Deno.env.get("GA4_OAUTH_CLIENT_ID")!;
  const CLIENT_SECRET = Deno.env.get("GA4_OAUTH_CLIENT_SECRET")!;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const html = (msg: string) =>
    new Response(
      `<html><body style="font-family:sans-serif;padding:24px"><p>${msg}</p><script>window.opener?.postMessage('ga4-connected','*');setTimeout(()=>window.close(),1500);</script></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );

  if (errorParam) return html(`Authorization denied: ${errorParam}`);
  if (!code || !state) return html("Missing code or state.");

  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: nonceRow } = await sb.from("oauth_state")
      .select("user_id, expires_at").eq("nonce", state).eq("provider", "ga4").maybeSingle();
    if (!nonceRow || new Date(nonceRow.expires_at).getTime() < Date.now()) {
      return html("Authentication failed or link expired.");
    }
    await sb.from("oauth_state").delete().eq("nonce", state);

    const redirectUri = `${SUPABASE_URL}/functions/v1/ga4-oauth-callback`;
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const t = await tokenRes.text();
      console.error("Token exchange failed:", t);
      return html("Token exchange failed.");
    }

    const tok = await tokenRes.json();
    if (!tok.refresh_token) {
      return html("No refresh token returned. Revoke prior access in your Google Account and try again.");
    }
    const expiresAt = Math.floor(Date.now() / 1000) + (tok.expires_in || 3600);

    const { error: dbErr } = await sb.from("ga4_tokens").upsert({
      user_id: nonceRow.user_id,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      expires_at: expiresAt,
      property_id: Deno.env.get("GA4_PROPERTY_ID") ?? null,
    }, { onConflict: "user_id" });

    if (dbErr) {
      console.error("DB upsert failed:", dbErr);
      return html("Failed to save tokens.");
    }

    return html("Connected to Google Analytics. You can close this window.");
  } catch (e) {
    console.error("ga4-oauth-callback error:", e);
    return html("An error occurred.");
  }
});
