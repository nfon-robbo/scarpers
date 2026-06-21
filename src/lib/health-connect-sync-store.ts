// Module-level singleton so the Health Connect sync survives tab changes
// (component unmount/remount). The sync promise runs in the background; this
// store keeps progress + result state and notifies subscribers.

import {
  syncHealthConnect,
  type HealthConnectProgress,
} from "@/lib/health-connect";

export type HealthConnectSyncState = {
  syncing: boolean;
  progress: HealthConnectProgress | null;
  errors: { type: string; message: string }[];
  fatalError: string | null;
  lastResult: { metricsCount: number; sleepCount: number } | null;
};

type Listener = (state: HealthConnectSyncState) => void;

let state: HealthConnectSyncState = {
  syncing: false,
  progress: null,
  errors: [],
  fatalError: null,
  lastResult: null,
};

const listeners = new Set<Listener>();

const setState = (patch: Partial<HealthConnectSyncState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
};

export const getHealthConnectSyncState = () => state;

export const subscribeHealthConnectSync = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export type StartHealthConnectSyncResult = Awaited<
  ReturnType<typeof syncHealthConnect>
> & { skipped?: false };

export const startHealthConnectSync = async (
  userId: string,
  days = 3650,
): Promise<StartHealthConnectSyncResult | { skipped: true }> => {
  if (state.syncing) return { skipped: true };
  setState({
    syncing: true,
    progress: { phase: "Starting…", percent: 1 },
    errors: [],
    fatalError: null,
  });
  try {
    const result = await syncHealthConnect(userId, days, (p) =>
      setState({ progress: p }),
    );
    setState({
      progress: { phase: "Done", percent: 100 },
      errors: result.readErrors ?? [],
      lastResult: {
        metricsCount: result.metricsCount,
        sleepCount: result.sleepCount,
      },
      syncing: false,
    });
    window.dispatchEvent(new CustomEvent("sleep-stages-synced"));
    window.dispatchEvent(new CustomEvent("daily-metrics-synced"));
    // Hide progress bar shortly after completion
    setTimeout(() => {
      if (!state.syncing) setState({ progress: null });
    }, 2000);
    return { ...result, skipped: false } as StartHealthConnectSyncResult;
  } catch (e: unknown) {
    const msg =
      e instanceof Error
        ? e.message
        : typeof e === "string"
        ? e
        : (() => {
            try {
              return JSON.stringify(e);
            } catch {
              return String(e);
            }
          })();
    setState({
      syncing: false,
      progress: null,
      fatalError: msg,
    });
    throw e;
  }
};
