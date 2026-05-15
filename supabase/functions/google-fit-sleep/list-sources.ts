// Throwaway debug function - list all Google Fit sleep data sources
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: { user } } = await supabase.auth.getUser(req.headers.get("Authorization")!.replace("Bearer ", ""));
  const { data: tokenRow } = await supabase.from("google_fit_tokens").select("*").eq("user_id", user!.id).maybeSingle();

  // Refresh token
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_FIT_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_FIT_CLIENT_SECRET")!,
      refresh_token: tokenRow!.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const { access_token } = await refreshRes.json();

  const sourcesRes = await fetch(
    "https://www.googleapis.com/fitness/v1/users/me/dataSources?dataTypeName=com.google.sleep.segment",
    { headers: { Authorization: `Bearer ${access_token}` } }
  );
  const sources = await sourcesRes.json();

  // For each source, query the last 3 days
  const end = Date.now();
  const start = end - 3 * 24 * 60 * 60 * 1000;
  const perSource: any[] = [];
  for (const src of sources.dataSource || []) {
    const dsRes = await fetch(
      `https://www.googleapis.com/fitness/v1/users/me/dataSources/${src.dataStreamId}/datasets/${start * 1_000_000}-${end * 1_000_000}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const ds = await dsRes.json();
    const points = ds.point || [];
    const dates = new Set(points.map((p: any) => new Date(parseInt(p.endTimeNanos) / 1e6).toISOString().split("T")[0]));
    perSource.push({ id: src.dataStreamId, name: src.dataStreamName, type: src.type, points: points.length, dates: Array.from(dates) });
  }

  return new Response(JSON.stringify({ sources: perSource }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
