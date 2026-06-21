// Silent multi-service sync used on navigation. Fires Strava, Google Fit
// sleep, and Intervals.icu wellness in parallel. Each service is throttled
// individually so rapid navigation between pages does not spam the APIs.

import { supabase } from "@/integrations/supabase/client";
import { autoLinkActivitiesToPlan } from "@/lib/auto-link-activities";

const THROTTLE_MS = 60_000; // 60s between syncs of the same service per session
const lastRun: Record<string, number> = {};
let inFlight: Promise<void> | null = null;

function shouldRun(key: string) {
  const now = Date.now();
  if (lastRun[key] && now - lastRun[key] < THROTTLE_MS) return false;
  lastRun[key] = now;
  return true;
}

async function syncStrava(accessToken: string, apikey: string, baseUrl: string) {
  if (!shouldRun("strava")) return;
  const after = Math.floor((Date.now() - 7 * 86400_000) / 1000);
  try {
    await fetch(`${baseUrl}/functions/v1/strava-import`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page: 1, per_page: 30, after }),
    });
  } catch {
    // silent
  }
}

async function syncGoogleFit(accessToken: string, apikey: string, baseUrl: string) {
  if (!shouldRun("google-fit")) return;
  try {
    await fetch(`${baseUrl}/functions/v1/google-fit-sleep`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ days: 30 }),
    });
  } catch { /* silent */ }
}

async function syncIntervals(accessToken: string, apikey: string, baseUrl: string) {
  if (!shouldRun("intervals")) return;
  try {
    await fetch(`${baseUrl}/functions/v1/intervals-wellness`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey,
        "Content-Type": "application/json",
      },
    });
  } catch { /* silent */ }
}

export async function runAllSyncs(): Promise<void> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !session.user) return;

    const baseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    const apikey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const accessToken = session.access_token;
    const userId = session.user.id;

    // Check which integrations are connected before firing requests.
    const [stravaTok, gfitTok, intervalsCreds] = await Promise.all([
      supabase.from("strava_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("google_fit_tokens").select("user_id").eq("user_id", userId).maybeSingle(),
      supabase.from("intervals_credentials").select("user_id").eq("user_id", userId).maybeSingle(),
    ]);

    const tasks: Promise<void>[] = [];
    if (stravaTok.data) tasks.push(syncStrava(accessToken, apikey, baseUrl));
    if (gfitTok.data) tasks.push(syncGoogleFit(accessToken, apikey, baseUrl));
    if (intervalsCreds.data) tasks.push(syncIntervals(accessToken, apikey, baseUrl));

    await Promise.allSettled(tasks);

    // Always link any unlinked activities to the active plan so the workout
    // of the day appears as completed everywhere (Plan, Dashboard, etc.).
    try {
      const result = await autoLinkActivitiesToPlan(userId);
      if (result.matches.length > 0) {
        window.dispatchEvent(new CustomEvent("plan-link-changed"));
      }
    } catch { /* silent */ }
  })();

  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}
