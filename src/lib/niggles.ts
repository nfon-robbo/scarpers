import { supabase } from "@/integrations/supabase/client";

export interface NiggleRow {
  id: string;
  user_id: string;
  location: string;
  severity: string | null;
  notes: string | null;
  source: string | null;
  activity_id: string | null;
  status: string;
  reported_on: string;
  last_checkin_on: string | null;
  last_trend: string | null;
}

export type NiggleTrend = "Better" | "Same" | "Worse";

/** Common running niggle locations offered as quick chips. */
export const NIGGLE_AREAS = [
  "Left knee", "Right knee",
  "Left calf", "Right calf",
  "Left hamstring", "Right hamstring",
  "Left Achilles", "Right Achilles",
  "Left shin", "Right shin",
  "Left ankle", "Right ankle",
  "Left foot", "Right foot",
  "Left hip", "Right hip",
  "Glute", "Groin", "Quad", "IT band", "Lower back",
];

/**
 * Pull previously-reported injury areas out of the free-text athlete context
 * captured at onboarding, so we can offer them as one-tap answers.
 */
export function extractProfileInjuryAreas(athleteContext?: string | null): string[] {
  if (!athleteContext) return [];
  const found: string[] = [];
  const push = (s: string) => {
    const cleaned = s.trim().replace(/[.\s]+$/, "");
    if (cleaned && cleaned.length >= 3 && cleaned.length <= 60 &&
        !found.some((f) => f.toLowerCase() === cleaned.toLowerCase())) {
      found.push(cleaned.charAt(0).toUpperCase() + cleaned.slice(1));
    }
  };

  // 1. Verbatim phrases from the athlete's own injury notes — these are what
  //    THEY wrote, so offer them first, exactly as recorded.
  //    Handles "Injuries / niggles: left IT band, hip flexor" style lines and
  //    any free text the onboarding captured.
  const lines = athleteContext.split(/\n+/);
  for (const line of lines) {
    const m = line.match(/injur(?:y|ies)[^:]*(?:\/\s*niggles?)?\s*:\s*(.+)/i)
           || line.match(/niggles?\s*:\s*(.+)/i);
    if (m?.[1]) {
      for (const part of m[1].split(/[,;]|\band\b|\bor\b/i)) push(part);
    }
  }

  // 2. Keyword matching against the standard area list for anything else
  //    mentioned elsewhere in the free-text context.
  const text = athleteContext.toLowerCase();
  for (const area of NIGGLE_AREAS) {
    const part = area.replace(/^(left|right)\s+/i, "").toLowerCase();
    if (text.includes(area.toLowerCase())) push(area);
    else if (text.includes(part) && !/^(left|right)/i.test(area)) push(area);
  }
  const extras = ["plantar fasciitis", "shin splints", "runner's knee", "IT band", "achilles", "hamstring", "calf", "knee", "hip", "back"];
  for (const e of extras) {
    if (text.includes(e.toLowerCase())) push(e);
  }
  return found.slice(0, 8);
}

export async function getActiveNiggles(userId: string): Promise<NiggleRow[]> {
  const { data } = await supabase
    .from("niggles" as any)
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("reported_on", { ascending: false });
  return (data as any as NiggleRow[]) || [];
}

/** Record (or refresh) an active niggle for a location. */
export async function recordNiggle(params: {
  userId: string;
  location: string;
  severity?: string | null;
  notes?: string | null;
  source?: string;
  activityId?: string | null;
}): Promise<NiggleRow | null> {
  const { userId, location, severity, notes, source = "workout-review", activityId } = params;
  const existing = await getActiveNiggles(userId);
  const match = existing.find((n) => n.location.toLowerCase() === location.toLowerCase());
  if (match) {
    const { data } = await supabase
      .from("niggles" as any)
      .update({ severity: severity ?? match.severity, notes: notes ?? match.notes, activity_id: activityId ?? match.activity_id } as any)
      .eq("id", match.id)
      .select("*")
      .maybeSingle();
    return (data as any) || match;
  }
  const { data } = await supabase
    .from("niggles" as any)
    .insert({
      user_id: userId,
      location,
      severity: severity ?? null,
      notes: notes ?? null,
      source,
      activity_id: activityId ?? null,
    } as any)
    .select("*")
    .maybeSingle();
  return (data as any) || null;
}

/** Save today's Better/Same/Worse answer and roll the niggle status forward. */
export async function recordNiggleCheckin(params: {
  userId: string;
  niggleId: string;
  dateIso: string;
  response: NiggleTrend;
  workoutTitle?: string | null;
  advice?: string | null;
}) {
  const { userId, niggleId, dateIso, response, workoutTitle, advice } = params;
  await supabase.from("niggle_checkins" as any).upsert(
    {
      user_id: userId,
      niggle_id: niggleId,
      checkin_on: dateIso,
      response,
      workout_title: workoutTitle ?? null,
      advice: advice ?? null,
    } as any,
    { onConflict: "niggle_id,checkin_on" },
  );
  await supabase
    .from("niggles" as any)
    .update({ last_checkin_on: dateIso, last_trend: response } as any)
    .eq("id", niggleId);
}

export async function resolveNiggle(niggleId: string) {
  await supabase.from("niggles" as any).update({ status: "resolved" } as any).eq("id", niggleId);
}

export async function hasCheckinOn(niggleId: string, dateIso: string): Promise<boolean> {
  const { data } = await supabase
    .from("niggle_checkins" as any)
    .select("id")
    .eq("niggle_id", niggleId)
    .eq("checkin_on", dateIso)
    .maybeSingle();
  return !!data;
}
