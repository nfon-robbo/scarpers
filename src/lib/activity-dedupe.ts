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

/**
 * Sweep the entire account: for every FIT (non-Strava) activity, delete any
 * Strava activity within ±windowMinutes. Runs in chunks so we never blow past
 * the 1000-row Supabase default limit.
 */
export async function purgeAllStravaOverlaps(
  userId: string,
  windowMinutes = 15,
): Promise<number> {
  let removed = 0;
  const pageSize = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await supabase
      .from("activities")
      .select("start_time, source_file")
      .eq("user_id", userId)
      .order("start_time", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error || !data?.length) break;
    const fitTimes = data
      .filter((r: any) => r.start_time && !(typeof r.source_file === "string" && r.source_file.startsWith("strava:")))
      .map((r: any) => r.start_time as string);
    if (fitTimes.length) {
      // Process in chunks of 200 start_times to keep range queries small.
      for (let i = 0; i < fitTimes.length; i += 200) {
        removed += await purgeStravaOverlaps(userId, fitTimes.slice(i, i + 200), windowMinutes);
      }
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return removed;
}

/**
 * Group activities by start_time bucket (default 15min) and prefer FIT
 * (non-`strava:` source_file) over Strava. Pure UI-side dedupe — does not
 * touch the database.
 */
export function dedupeActivities<T extends { id: string; start_time?: string | null; source_file?: string | null }>(
  list: T[],
  windowMinutes = 15,
): T[] {
  const isStrava = (a: T) => typeof a.source_file === "string" && a.source_file.startsWith("strava:");
  const windowMs = windowMinutes * 60 * 1000;
  const noTime: T[] = [];
  const timed: T[] = [];
  for (const a of list) {
    if (a.start_time) timed.push(a);
    else noTime.push(a);
  }
  // Sort newest first so bucket key is stable.
  timed.sort((a, b) => new Date(b.start_time!).getTime() - new Date(a.start_time!).getTime());
  const buckets: T[][] = [];
  for (const a of timed) {
    const t = new Date(a.start_time!).getTime();
    const bucket = buckets.find((b) =>
      b.some((x) => Math.abs(new Date(x.start_time!).getTime() - t) <= windowMs)
    );
    if (bucket) bucket.push(a);
    else buckets.push([a]);
  }
  const kept: T[] = [...noTime];
  for (const arr of buckets) {
    if (arr.length === 1) { kept.push(arr[0]); continue; }
    const hasFit = arr.some((a) => !isStrava(a));
    kept.push(...(hasFit ? arr.filter((a) => !isStrava(a)) : arr));
  }
  kept.sort((a, b) => new Date(b.start_time || 0).getTime() - new Date(a.start_time || 0).getTime());
  return kept;
}
