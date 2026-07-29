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
  name: "list_sleep",
  title: "List recent sleep",
  description:
    "Return the signed-in user's daily sleep summaries (duration, deep/light/REM minutes, sleep score, HRV, resting HR) for the last N days.",
  inputSchema: {
    days: z.number().int().min(1).max(90).optional().describe("Number of past days to include (default 14)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const n = days ?? 14;
    const since = new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await sb(ctx)
      .from("daily_metrics")
      .select(
        "date,sleep_duration_seconds,sleep_score,deep_sleep_minutes,light_sleep_minutes,rem_sleep_minutes,awake_during_night_minutes,hrv,resting_heart_rate",
      )
      .gte("date", since)
      .order("date", { ascending: false });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { sleep: data ?? [] },
    };
  },
});
