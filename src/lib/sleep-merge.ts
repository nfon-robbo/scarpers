// Dedupe overlapping sleep_stages segments by (date, source, stage).
// Google Fit sometimes records the same night via multiple sessions
// (phone + watch), which produces duplicate segments and ~doubled totals.

export interface RawSleepStageRow {
  date: string;
  stage: string;
  duration_seconds: number;
  source?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface MergedSleepRow {
  date: string;
  stage: string;
  duration_seconds: number;
  source: string;
}

export function mergeSleepStages(rows: RawSleepStageRow[]): MergedSleepRow[] {
  type Seg = { start: number; end: number };
  const byKey = new Map<string, { segs: Seg[]; fallback: number }>();
  for (const r of rows) {
    const src = (r.source ?? "google_fit") as string;
    const k = `${r.date}|${src}|${r.stage}`;
    if (!byKey.has(k)) byKey.set(k, { segs: [], fallback: 0 });
    const bucket = byKey.get(k)!;
    if (r.start_time && r.end_time) {
      bucket.segs.push({
        start: new Date(r.start_time).getTime(),
        end: new Date(r.end_time).getTime(),
      });
    } else {
      // No time range — keep max duration as a fallback so we don't sum dupes
      bucket.fallback = Math.max(bucket.fallback, r.duration_seconds || 0);
    }
  }

  const out: MergedSleepRow[] = [];
  for (const [k, { segs, fallback }] of byKey) {
    const [date, source, stage] = k.split("|");
    let secs = 0;
    if (segs.length > 0) {
      segs.sort((a, b) => a.start - b.start);
      let curStart = -1, curEnd = -1;
      for (const s of segs) {
        if (curEnd < 0 || s.start > curEnd) {
          if (curEnd >= 0) secs += curEnd - curStart;
          curStart = s.start; curEnd = s.end;
        } else {
          curEnd = Math.max(curEnd, s.end);
        }
      }
      if (curEnd >= 0) secs += curEnd - curStart;
      secs = Math.round(secs / 1000);
    } else {
      secs = fallback;
    }
    out.push({ date, source, stage, duration_seconds: secs });
  }
  return out;
}
