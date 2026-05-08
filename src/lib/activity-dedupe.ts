import { supabase } from "@/integrations/supabase/client";

/**
 * FIT files always take precedence over Strava. Given a list of FIT start_times
 * being imported, find any Strava activities for the same user within ±windowMinutes
 * of any FIT start_time and delete them.
 *
 * Returns the number of Strava activities removed.
 */
export async function purgeStravaOverlaps(
  userId: string,
  fitStartTimes: (string | null | undefined)[],
  windowMinutes = 15,
): Promise<number> {
  const times = fitStartTimes
    .filter(Boolean)
    .map((t) => new Date(t as string).getTime())
    .filter((n) => isFinite(n));
  if (!times.length) return 0;

  const windowMs = windowMinutes * 60 * 1000;
  const minT = Math.min(...times) - windowMs;
  const maxT = Math.max(...times) + windowMs;

  const { data, error } = await supabase
    .from("activities")
    .select("id, start_time, source_file")
    .eq("user_id", userId)
    .gte("start_time", new Date(minT).toISOString())
    .lte("start_time", new Date(maxT).toISOString())
    .like("source_file", "strava:%");

  if (error || !data?.length) return 0;

  const ids: string[] = [];
  for (const row of data) {
    if (!row.start_time) continue;
    const rt = new Date(row.start_time).getTime();
    if (times.some((ft) => Math.abs(ft - rt) <= windowMs)) {
      ids.push(row.id);
    }
  }

  if (!ids.length) return 0;
  const { error: delErr } = await supabase
    .from("activities")
    .delete()
    .in("id", ids);
  if (delErr) {
    console.error("purgeStravaOverlaps delete failed:", delErr);
    return 0;
  }
  return ids.length;
}
