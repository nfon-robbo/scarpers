import { toast } from "sonner";

let running = false;

export function isStravaImportRunning() {
  return running;
}

export async function startStravaBackgroundImport(accessToken: string) {
  if (running) {
    toast.info("Strava import already running in the background.");
    return;
  }
  running = true;

  const toastId = toast.loading("Importing Strava activities…", {
    description: "This will keep running while you use the app.",
    duration: Infinity,
  });

  let totalImported = 0;
  let totalSkipped = 0;
  let page = 1;

  try {
    while (true) {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-import`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ page, per_page: 50, after: 1735689600 }),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Import failed");
      }

      const result = await res.json();
      totalImported += result.imported || 0;
      totalSkipped += result.skipped || 0;

      toast.loading(`Importing Strava… ${totalImported} so far`, {
        id: toastId,
        description: `Page ${page} processed`,
        duration: Infinity,
      });

      if (!result.has_more) break;
      page++;
    }

    toast.success("Strava import complete", {
      id: toastId,
      description: `${totalImported} new activities imported${totalSkipped > 0 ? `, ${totalSkipped} already existed` : ""}.`,
      duration: 6000,
    });
  } catch (e: any) {
    toast.error("Strava import failed", {
      id: toastId,
      description: e?.message ?? "Unknown error",
      duration: 6000,
    });
  } finally {
    running = false;
  }
}
