// Runs once per browser session per user when they land on the Dashboard
// after logging in. Triggers all integration syncs silently and broadcasts
// start/done events so widgets (e.g. ReadinessWidget) can show "awaiting"
// states until fresh data has landed.

import type { Session } from "@supabase/supabase-js";

export const AUTO_SYNC_STARTED = "auto-sync-started";
export const AUTO_SYNC_DONE = "auto-sync-done";

const KEY = (userId: string) => `autoSyncDone:${userId}`;

let inFlight: Promise<void> | null = null;

export function isAutoSyncDoneThisSession(userId: string): boolean {
  try {
    return sessionStorage.getItem(KEY(userId)) === "1";
  } catch {
    return false;
  }
}

export function markAutoSyncDone(userId: string) {
  try {
    sessionStorage.setItem(KEY(userId), "1");
  } catch {
    // ignore
  }
}

export async function runAutoSyncOnce(
  userId: string,
  session: Session | null
): Promise<void> {
  if (!session?.access_token) return;
  if (isAutoSyncDoneThisSession(userId)) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    window.dispatchEvent(new CustomEvent(AUTO_SYNC_STARTED));

    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    const headers = {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
    };

    // Fan out — each call swallows its own errors so one missing
    // integration never blocks the others. Strava is intentionally excluded
    // here (it's covered by manual / scheduled sync paths).
    await Promise.allSettled([
      fetch(`${baseUrl}/functions/v1/intervals-wellness`, {
        method: "POST",
        headers,
      }).catch(() => null),
      fetch(`${baseUrl}/functions/v1/google-fit-sleep`, {
        method: "POST",
        headers,
        body: JSON.stringify({ days: 90 }),
      }).catch(() => null),
    ]);

    markAutoSyncDone(userId);
    window.dispatchEvent(new CustomEvent(AUTO_SYNC_DONE));
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
