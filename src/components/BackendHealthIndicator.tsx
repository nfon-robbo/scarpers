import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "checking" | "ok" | "degraded" | "down";

const CHECK_INTERVAL = 30_000;
const TIMEOUT_MS = 8_000;

const BackendHealthIndicator = () => {
  const [status, setStatus] = useState<Status>("checking");
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const check = async () => {
    const started = performance.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const { error } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .abortSignal(controller.signal)
        .limit(1);
      const ms = Math.round(performance.now() - started);
      setLatency(ms);
      setLastChecked(new Date());
      if (error) {
        setStatus("down");
      } else if (ms > 3000) {
        setStatus("degraded");
      } else {
        setStatus("ok");
      }
    } catch {
      setLatency(Math.round(performance.now() - started));
      setLastChecked(new Date());
      setStatus("down");
    } finally {
      clearTimeout(timer);
    }
  };

  useEffect(() => {
    check();
    const id = setInterval(check, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, []);

  const config = {
    checking: { label: "Checking backend…", color: "bg-muted text-muted-foreground", Icon: Loader2, spin: true },
    ok: { label: "Backend healthy", color: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30", Icon: CheckCircle2, spin: false },
    degraded: { label: "Backend slow", color: "bg-amber-500/10 text-amber-500 border-amber-500/30", Icon: AlertTriangle, spin: false },
    down: { label: "Backend timing out", color: "bg-destructive/10 text-destructive border-destructive/30", Icon: AlertTriangle, spin: false },
  }[status];

  // Hide entirely when healthy after first check, to keep UI clean
  if (status === "ok") return null;

  const { Icon } = config;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium shadow-lg backdrop-blur-md",
        config.color,
      )}
      title={
        lastChecked
          ? `Last check: ${lastChecked.toLocaleTimeString()}${latency ? ` • ${latency}ms` : ""}`
          : "Checking…"
      }
      role="status"
      aria-live="polite"
    >
      <Icon className={cn("h-3.5 w-3.5", config.spin && "animate-spin")} />
      <span>{config.label}</span>
      {latency !== null && status !== "checking" && (
        <span className="opacity-70">· {latency}ms</span>
      )}
      <button
        onClick={check}
        className="ml-1 underline-offset-2 hover:underline opacity-80"
      >
        retry
      </button>
    </div>
  );
};

export default BackendHealthIndicator;
