import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_activities",
  title: "List recent activities",
  description:
    "List the signed-in user's recent Scarpers activities (runs, rides, etc.), newest first. Returns id, start_time, activity_type, distance in km, duration in minutes, and average heart rate.",
  inputSchema: {
    limit: z.number().int().min(1).max(50).optional().describe("Max activities to return (default 10)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("activities")
      .select("id,start_time,activity_type,distance_meters,duration_seconds,avg_heart_rate")
      .order("start_time", { ascending: false })
      .limit(limit ?? 10);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = (data ?? []).map((a) => ({
      id: a.id,
      start_time: a.start_time,
      type: a.activity_type,
      distance_km: a.distance_meters ? +(a.distance_meters / 1000).toFixed(2) : null,
      duration_min: a.duration_seconds ? +(a.duration_seconds / 60).toFixed(1) : null,
      avg_hr: a.avg_heart_rate,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { activities: rows },
    };
  },
});
