import { useEffect, useState, useRef } from "react";
import { AlertTriangle, X, RefreshCw } from "lucide-react";

const SUPABASE_HOST = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL).host;
  } catch {
    return "";
  }
})();

const HIDE_AFTER_MS = 8_000;

const SupabaseErrorBanner = () => {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const [count, setCount] = useState(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (msg: string) => {
    setMessage(msg);
    setVisible(true);
    setCount((c) => c + 1);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_AFTER_MS);
  };

  useEffect(() => {
    const origFetch = window.fetch.bind(window);

    const isSupabase = (input: RequestInfo | URL) => {
      try {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        return SUPABASE_HOST && url.includes(SUPABASE_HOST);
      } catch {
        return false;
      }
    };

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      try {
        const res = await origFetch(input as any, init);
        if (isSupabase(input) && res.status >= 500) {
          show(`Backend returned ${res.status}. Some data may not load.`);
        }
        return res;
      } catch (err: any) {
        if (isSupabase(input)) {
          const msg = err?.name === "AbortError"
            ? "Backend request timed out. Please retry."
            : "Can't reach the backend. Check your connection or try again.";
          show(msg);
        }
        throw err;
      }
    };

    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const text = String(reason?.message || reason || "");
      if (/Failed to fetch|NetworkError|timeout|ECONNREFUSED/i.test(text)) {
        show("Network issue talking to the backend. Retrying may help.");
      }
    };
    window.addEventListener("unhandledrejection", onRejection);

    return () => {
      window.fetch = origFetch;
      window.removeEventListener("unhandledrejection", onRejection);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[100] flex items-center justify-center px-4 py-2 bg-destructive/95 text-destructive-foreground text-sm font-medium shadow-lg backdrop-blur-md animate-fade-in"
    >
      <AlertTriangle className="w-4 h-4 mr-2 flex-shrink-0" />
      <span className="truncate">{message}</span>
      {count > 1 && (
        <span className="ml-2 opacity-80 text-xs">×{count}</span>
      )}
      <button
        onClick={() => window.location.reload()}
        className="ml-3 inline-flex items-center gap-1 rounded-md bg-background/15 hover:bg-background/25 px-2 py-0.5 text-xs"
        aria-label="Reload"
      >
        <RefreshCw className="w-3 h-3" /> Reload
      </button>
      <button
        onClick={() => setVisible(false)}
        className="ml-2 p-1 rounded-md hover:bg-background/15"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default SupabaseErrorBanner;
