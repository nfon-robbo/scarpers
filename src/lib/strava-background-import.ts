import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { autoLinkActivitiesToPlan } from "@/lib/auto-link-activities";
import { format } from "date-fns";

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

  toast.success("Strava import started", {
    description: "Running in the background — we'll let you know when it's done.",
    duration: 4000,
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

      if (!result.has_more) break;
      page++;
    }

    toast.success("Strava import complete", {
      description: `${totalImported} new activities imported${totalSkipped > 0 ? `, ${totalSkipped} already existed` : ""}.`,
      duration: 6000,
    });

    // Auto-link any newly synced activities to the active training plan
    if (totalImported > 0) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const result = await autoLinkActivitiesToPlan(user.id);
          if (result.matches.length > 0) {
            const lines = result.matches.slice(0, 5).map((m) => {
              const day = format(new Date(m.date + "T00:00:00"), "EEE d MMM");
              return `${day}: ${m.plannedTitle}`;
            });
            const more = result.matches.length > 5 ? `\n+${result.matches.length - 5} more` : "";
            toast.success(
              `Auto-marked ${result.matches.length} planned session${result.matches.length === 1 ? "" : "s"} complete`,
              { description: lines.join("\n") + more, duration: 8000 }
            );
          }
        }
      } catch (linkErr) {
        console.error("[strava-import] auto-link failed", linkErr);
      }
    }
  } catch (e: any) {
    toast.error("Strava import failed", {
      description: e?.message ?? "Unknown error",
      duration: 6000,
    });
  } finally {
    running = false;
  }
}

