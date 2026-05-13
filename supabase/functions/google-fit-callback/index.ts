import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const GOOGLE_FIT_CLIENT_ID = Deno.env.get("GOOGLE_FIT_CLIENT_ID")!;
  const GOOGLE_FIT_CLIENT_SECRET = Deno.env.get("GOOGLE_FIT_CLIENT_SECRET")!;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // user JWT
  const errorParam = url.searchParams.get("error");

  if (errorParam) {
    return new Response(
      `<html><body><script>window.close();</script>Google Fit authorization denied.</body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  try {
    const redirectUri = `${SUPABASE_URL}/functions/v1/google-fit-callback`;

    // Exchange code for tokens
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
      return new Response(
        `<html><body><script>window.close();</script>Token exchange failed.</body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    const tokenData = await tokenRes.json();

    // Look up the nonce we minted on `authorize` to find the user.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: nonceRow } = await supabase
      .from("oauth_state")
      .select("user_id, expires_at")
      .eq("nonce", state)
      .eq("provider", "google_fit")
      .maybeSingle();

    if (!nonceRow || new Date(nonceRow.expires_at).getTime() < Date.now()) {
      return new Response(
        `<html><body><script>window.close();</script>Authentication failed or link expired.</body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }
    await supabase.from("oauth_state").delete().eq("nonce", state);
    const user = { id: nonceRow.user_id };

    // Calculate expires_at
    const expiresAt = Math.floor(Date.now() / 1000) + (tokenData.expires_in || 3600);

    // Upsert tokens
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
      return new Response(
        `<html><body><script>window.close();</script>Failed to save tokens.</body></html>`,
        { headers: { "Content-Type": "text/html" } }
      );
    }

    return new Response(
      `<html><body><script>window.opener?.postMessage('google-fit-connected','*');window.close();</script><p>Connected! You can close this window.</p></body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  } catch (error) {
    console.error("Google Fit callback error:", error);
    return new Response(
      `<html><body><script>window.close();</script>An error occurred.</body></html>`,
      { headers: { "Content-Type": "text/html" } }
    );
  }
});
