// Single source of truth for which sleep source "wins" for a given date.
// Manual entries always take precedence — they reflect what the user typed.
// Then Health Connect (Garmin via Android), then Google Fit, then legacy Garmin export.

export const SLEEP_SOURCE_PRIORITY: Record<string, number> = {
  manual: 4,
  health_connect: 3,
  google_fit: 2,
  "garmin-export": 1,
};

export interface SourcedSleepRow {
  date: string;
  stage: string;
  duration_seconds: number;
  source: string;
}

/**
 * Returns only the rows from the highest-priority source present on each date.
 * Unknown sources fall back to priority 0.
 */
export function dedupeSleepRowsByPrecedence<T extends SourcedSleepRow>(rows: T[]): T[] {
  const bestSourceByDate = new Map<string, { source: string; priority: number }>();
  for (const r of rows) {
    const p = SLEEP_SOURCE_PRIORITY[r.source] ?? 0;
    const current = bestSourceByDate.get(r.date);
    if (!current || p > current.priority) {
      bestSourceByDate.set(r.date, { source: r.source, priority: p });
    }
  }
  return rows.filter((r) => bestSourceByDate.get(r.date)?.source === r.source);
}
