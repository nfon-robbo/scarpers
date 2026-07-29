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
  name: "log_nutrition",
  title: "Log a nutrition entry",
  description:
    "Add a food entry to the signed-in user's Scarpers nutrition diary. Values are for the actual portion consumed (not per 100g).",
  inputSchema: {
    food_name: z.string().min(1),
    meal_type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
    quantity_g: z.number().positive(),
    calories: z.number().min(0),
    carbs_g: z.number().min(0).optional(),
    protein_g: z.number().min(0).optional(),
    fat_g: z.number().min(0).optional(),
    sat_fats_g: z.number().min(0).optional(),
    salt_mg: z.number().min(0).optional(),
    alcohol_units: z.number().min(0).optional(),
    brand: z.string().optional(),
    log_date: z.string().optional().describe("YYYY-MM-DD; defaults to today."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("nutrition_logs")
      .insert({
        user_id: ctx.getUserId(),
        food_name: input.food_name,
        meal_type: input.meal_type,
        quantity_g: input.quantity_g,
        calories: input.calories,
        carbs_g: input.carbs_g ?? 0,
        protein_g: input.protein_g ?? 0,
        fat_g: input.fat_g ?? 0,
        sat_fats_g: input.sat_fats_g ?? 0,
        salt_mg: input.salt_mg ?? 0,
        alcohol_units: input.alcohol_units ?? 0,
        brand: input.brand ?? null,
        log_date: input.log_date ?? new Date().toISOString().slice(0, 10),
        source: "mcp",
      })
      .select()
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Logged ${input.food_name} (${input.calories} kcal).` }],
      structuredContent: { entry: data },
    };
  },
});
