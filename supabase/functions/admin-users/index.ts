// TEMPORARY admin endpoint for listing + deleting users by email.
// Remove this function once cleanup is complete.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No auth" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const admin = createClient(supabaseUrl, serviceKey);

    if (req.method === "GET") {
      const users: { id: string; email: string; created_at: string }[] = [];
      let page = 1;
      while (true) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        for (const u of data.users) {
          users.push({ id: u.id, email: u.email ?? "", created_at: u.created_at });
        }
        if (data.users.length < 200) break;
        page++;
      }
      users.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return json({ users });
    }

    if (req.method === "POST") {
      const { userId } = await req.json();
      if (!userId) return json({ error: "userId required" }, 400);
      if (userId === user.id) return json({ error: "Cannot delete yourself" }, 400);

      const tables = [
        "activities", "analyses", "analytics_summaries", "chat_messages", "chat_threads",
        "daily_metrics", "google_fit_tokens", "intervals_credentials", "readiness_snapshots",
        "running_iq_snapshots", "sleep_stages", "strava_tokens", "sync_schedules",
        "training_plans", "uploads", "user_feedback", "user_roles", "workout_reviews", "profiles",
      ];
      for (const t of tables) {
        await admin.from(t).delete().eq("user_id", userId);
      }
      const { error: delErr } = await admin.auth.admin.deleteUser(userId);
      if (delErr) throw delErr;
      return json({ success: true });
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
