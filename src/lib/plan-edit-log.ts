/**
 * Plan edit history — records every workout-level change a user (or the AI
 * chatbot) makes to a training plan. The AI coach reads recent entries when
 * preparing its context so it can explain *why* the plan diverged.
 */
import { supabase } from "@/integrations/supabase/client";

export type PlanEditAction =
  | "skip"
  | "move"
  | "replace_recovery"
  | "replace_template"
  | "edit";

export type PlanEditTemplate =
  | "easy_run"
  | "tempo"
  | "race_pace"
  | "intervals"
  | "long_run"
  | "recovery_walk"
  | "rest"
  | null;

export interface PlanEditEntry {
  planId: string;
  userId: string;
  dateUk: string;
  action: PlanEditAction;
  template?: PlanEditTemplate;
  beforeTitle?: string | null;
  afterTitle?: string | null;
  summary: string;
  details?: Record<string, unknown> | null;
}

export async function logPlanEdit(entry: PlanEditEntry): Promise<void> {
  try {
    await supabase.from("plan_edit_log" as any).insert({
      plan_id: entry.planId,
      user_id: entry.userId,
      date_uk: entry.dateUk,
      action: entry.action,
      template: entry.template ?? null,
      before_title: entry.beforeTitle ?? null,
      after_title: entry.afterTitle ?? null,
      summary: entry.summary,
      details: entry.details ?? null,
    });
  } catch (e) {
    console.warn("logPlanEdit failed", e);
  }
}

export interface PlanEditRow {
  date_uk: string;
  action: string;
  template: string | null;
  before_title: string | null;
  after_title: string | null;
  summary: string;
  created_at: string;
}

export async function fetchRecentPlanEdits(
  planId: string,
  limit = 20,
): Promise<PlanEditRow[]> {
  try {
    const { data } = await supabase
      .from("plan_edit_log" as any)
      .select("date_uk, action, template, before_title, after_title, summary, created_at")
      .eq("plan_id", planId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as unknown as PlanEditRow[]) ?? [];
  } catch {
    return [];
  }
}

/** Markdown block appended to AI coach context so the model sees recent edits. */
export function formatEditsForCoach(rows: PlanEditRow[]): string {
  if (!rows.length) return "";
  const lines = rows.map((r) => {
    const when = r.created_at.slice(0, 10);
    const tmpl = r.template ? ` [${r.template}]` : "";
    return `- ${when} — ${r.date_uk} — ${r.action}${tmpl}: ${r.summary}`;
  });
  return `\n\n---\nRECENT PLAN EDITS (most recent first):\n${lines.join("\n")}\n`;
}
