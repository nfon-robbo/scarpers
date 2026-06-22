// Automatically syncs Health Connect (sleep + metrics) on Android whenever
// the app is opened or resumed from background. Throttled to once per hour
// to avoid hammering Health Connect. No user action required.

import { useEffect } from "react";

import {
  isHealthConnectPlatform,
  ensureHealthConnectAvailable,
  getGrantedHealthConnectPermissions,
} from "@/lib/health-connect";
import { startHealthConnectSync } from "@/lib/health-connect-sync-store";
import { useAuth } from "@/hooks/useAuth";

const THROTTLE_MS = 60 * 60 * 1000; // 1 hour
const KEY = (uid: string) => `hcAutoSync:${uid}`;

const shouldRun = (uid: string) => {
  try {
    const last = Number(localStorage.getItem(KEY(uid)) || 0);
    return Date.now() - last > THROTTLE_MS;
  } catch {
    return true;
  }
};

const markRan = (uid: string) => {
  try { localStorage.setItem(KEY(uid), String(Date.now())); } catch { /* noop */ }
};

const tryAutoSync = async (uid: string) => {
  if (!isHealthConnectPlatform()) return;
  if (!shouldRun(uid)) return;
  try {
    const availability = await ensureHealthConnectAvailable();
    if (availability !== "Available") return;
    const granted = await getGrantedHealthConnectPermissions();
    if (granted.length === 0) return; // user hasn't granted access yet
    markRan(uid);
    // 7-day lookback is enough to catch any missed nights without overloading.
    await startHealthConnectSync(uid, 7);
  } catch {
    // Silent — manual sync card is still available as a fallback.
  }
};

export const useAutoHealthConnectSync = () => {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const uid = user.id;

    // Run on mount / login.
    tryAutoSync(uid);

    // Run again whenever the app/tab regains focus (e.g. user wakes up,
    // glances at the watch, then opens Scarpers).
    const onVisible = () => {
      if (document.visibilityState === "visible") tryAutoSync(uid);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user]);
};
