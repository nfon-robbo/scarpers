/**
 * Auto-link synced activities to the active training plan.
 *
 * Matching rules:
 *  - Activity start date matches a planned session date (same calendar day,
 *    i.e. within 24h).
 *  - Activity duration is within 20% of the planned duration.
 *  - Activity type matches the planned type (run ↔ run, walk ↔ walk).
 *  - Activity is not already linked to a plan.
 *
 * On match, sets `activities.training_plan_id` to the active plan id so the
 * planned session shows as completed in the Training Plan UI. Unmatched
 * sessions are left untouched.
 */

import { supabase } from "@/integrations/supabase/client";
import { parseWorkoutsFromPlan, type ParsedWorkout } from "@/lib/plan-export";
import { format } from "date-fns";

export interface AutoLinkMatch {
  date: string; // yyyy-MM-dd
  plannedTitle: string;
  plannedDurationSec: number;
  activityId: string;
  activityType: string;
  activityDurationSec: number;
}

export interface AutoLinkResult {
  matches: AutoLinkMatch[];
  checked: number;
  planId: string | null;
}

function plannedDurationSeconds(w: ParsedWorkout): number {
  let total = 0;
  for (const seg of w.segments || []) {
    const d = (seg.duration || "").trim();
    if (!d) continue;
    const reps = d.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(min|sec|s|m)\b/i);
    if (reps) {
      const n = parseInt(reps[1], 10);
      const v = parseFloat(reps[2]);
      const unit = reps[3].toLowerCase();
      total += n * (unit.startsWith("s") ? v : v * 60);
      continue;
    }
    const colon = d.match(/(\d{1,3}):(\d{2})/);
    if (colon) { total += parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10); continue; }
    const min = d.match(/(\d+(?:\.\d+)?)\s*min/i);
    if (min) { total += parseFloat(min[1]) * 60; continue; }
    const sec = d.match(/(\d+(?:\.\d+)?)\s*(?:sec|s)\b/i);
    if (sec) { total += parseFloat(sec[1]); continue; }
  }
  if (total > 0) return Math.round(total);
  // Fallback: parse "Total: ~30 min" / "(30 min)" from title or rawText
  const txt = `${w.title} ${w.rawText}`;
  const totalMatch =
    txt.match(/Total:\s*~?\s*(\d+)\s*min/i) ||
    txt.match(/\(\s*~?\s*(\d+)\s*min\s*(?:total)?\s*\)/i);
  if (totalMatch) return parseInt(totalMatch[1], 10) * 60;
  return 0;
}

function plannedKind(w: ParsedWorkout): "run" | "walk" | "other" {
  const txt = `${w.title} ${w.rawText}`.toLowerCase();
  // Pure walk session = title says walk and no "run" mention outside walk-run
  const mentionsRun = /\brun(ning)?\b|\bjog\b|\bintervals?\b|\btempo\b|\bthreshold\b/.test(txt);
  const mentionsWalk = /\bwalk(ing)?\b/.test(txt);
  if (mentionsWalk && !mentionsRun) return "walk";
  if (mentionsRun) return "run";
  // Default to run for a running plan
  return "run";
}

function activityKind(activityType: string | null | undefined): "run" | "walk" | "other" {
  const t = (activityType || "").toLowerCase();
  if (t.includes("walk") || t.includes("hike")) return "walk";
  if (t.includes("run")) return "run";
  return "other";
}

function isRest(w: ParsedWorkout): boolean {
  return w.segments.length === 0 || /\brest\b/i.test(w.title);
}

/**
 * Try to auto-link unlinked activities to planned sessions in the active plan.
 * Safe to call repeatedly — only touches activities with a null training_plan_id.
 */
export async function autoLinkActivitiesToPlan(userId: string): Promise<AutoLinkResult> {
  const empty: AutoLinkResult = { matches: [], checked: 0, planId: null };

  // 1. Active plan
  const { data: plan } = await supabase
    .from("training_plans")
    .select("id, content, start_date")
    .eq("user_id", userId)
    .eq("archived", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!plan) return empty;

  const workouts = parseWorkoutsFromPlan(plan.content || "");
  const planned = workouts.filter((w) => w.dateObj && !isRest(w));
  if (!planned.length) return { ...empty, planId: plan.id };

  // 2. Date range covering the plan's planned sessions
  const times = planned.map((w) => w.dateObj!.getTime());
  const minDate = new Date(Math.min(...times));
  const maxDate = new Date(Math.max(...times));
  // Pad by 1 day each side (timezone safety)
  const fromIso = new Date(minDate.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(maxDate.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const { data: activities } = await supabase
    .from("activities")
    .select("id, start_time, duration_seconds, activity_type, training_plan_id")
    .eq("user_id", userId)
    .is("training_plan_id", null)
    .gte("start_time", fromIso)
    .lte("start_time", toIso);

  if (!activities || activities.length === 0) {
    return { ...empty, planId: plan.id };
  }

  // Bucket unlinked activities by yyyy-MM-dd
  const byDate = new Map<string, typeof activities>();
  for (const a of activities) {
    if (!a.start_time) continue;
    const key = format(new Date(a.start_time), "yyyy-MM-dd");
    const arr = byDate.get(key) || [];
    arr.push(a);
    byDate.set(key, arr);
  }

  // Avoid double-linking if same plan date already has a linked activity
  const datesWithLinked = new Set<string>();
  {
    const { data: linked } = await supabase
      .from("activities")
      .select("start_time")
      .eq("user_id", userId)
      .eq("training_plan_id", plan.id)
      .gte("start_time", fromIso)
      .lte("start_time", toIso);
    for (const a of linked || []) {
      if (a.start_time) datesWithLinked.add(format(new Date(a.start_time), "yyyy-MM-dd"));
    }
  }

  const matches: AutoLinkMatch[] = [];
  let checked = 0;

  for (const w of planned) {
    const dateKey = format(w.dateObj!, "yyyy-MM-dd");
    if (datesWithLinked.has(dateKey)) continue;
    const candidates = byDate.get(dateKey);
    if (!candidates || candidates.length === 0) continue;
    const kind = plannedKind(w);
    const plannedSec = plannedDurationSeconds(w);

    checked++;

    // Prefer a kind-matching candidate within 20% of planned duration.
    // Fall back to any kind-matching activity on the same day so a run done
    // longer/shorter than planned still counts as "completed".
    let best: { a: any; diff: number } | null = null;
    let fallback: { a: any; diff: number } | null = null;
    for (const a of candidates) {
      const aKind = activityKind(a.activity_type);
      if (aKind !== kind) continue;
      const aSec = Number(a.duration_seconds) || 0;
      if (aSec <= 0) continue;
      const diff = plannedSec > 0 ? Math.abs(aSec - plannedSec) / plannedSec : 0;
      if (plannedSec > 0 && diff <= 0.2) {
        if (!best || diff < best.diff) best = { a, diff };
      } else {
        if (!fallback || diff < fallback.diff) fallback = { a, diff };
      }
    }
    const chosen = best || fallback;
    if (!chosen) continue;
    best = chosen;

    const { error } = await supabase
      .from("activities")
      .update({ training_plan_id: plan.id } as any)
      .eq("id", best.a.id)
      .is("training_plan_id", null); // race-safety

    if (error) {
      console.error("[auto-link] failed to link activity", best.a.id, error);
      continue;
    }

    // Remove from pool so a second planned session same day doesn't reuse it
    byDate.set(
      dateKey,
      (byDate.get(dateKey) || []).filter((x) => x.id !== best!.a.id)
    );
    datesWithLinked.add(dateKey);

    matches.push({
      date: dateKey,
      plannedTitle: w.title,
      plannedDurationSec: plannedSec,
      activityId: best.a.id,
      activityType: best.a.activity_type || "",
      activityDurationSec: Number(best.a.duration_seconds) || 0,
    });
  }

  if (matches.length > 0) {
    console.info("[auto-link] matched", matches);
    try {
      window.dispatchEvent(new Event("plan-link-changed"));
      // Open the workout review for the most recent matched session so the
      // athlete can update their check-in. Latest by date.
      const latest = matches.slice().sort((a, b) => a.date.localeCompare(b.date)).pop();
      if (latest) {
        // Slight delay so plan + linkedActivities have refreshed first
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("workout-auto-linked", { detail: { date: latest.date, activityId: latest.activityId } }));
        }, 600);
      }
    } catch {
      /* non-browser env */
    }
  }

  return { matches, checked, planId: plan.id };
}
