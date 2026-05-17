import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Cookie, X } from "lucide-react";

const STORAGE_KEY = "scarpers_cookie_consent_v1";

type Prefs = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  timestamp: string;
};

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    openCookieSettings?: () => void;
  }
}

const applyConsent = (prefs: Prefs) => {
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;
  window.gtag("consent", "update", {
    ad_storage: prefs.marketing ? "granted" : "denied",
    ad_user_data: prefs.marketing ? "granted" : "denied",
    ad_personalization: prefs.marketing ? "granted" : "denied",
    analytics_storage: prefs.analytics ? "granted" : "denied",
  });
};

const save = (prefs: Prefs) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  applyConsent(prefs);
};

const CookieConsent = () => {
  const [open, setOpen] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [analytics, setAnalytics] = useState(true);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setOpen(true);
    } else {
      try {
        const p = JSON.parse(saved) as Prefs;
        setAnalytics(!!p.analytics);
        setMarketing(!!p.marketing);
      } catch {}
    }
    window.openCookieSettings = () => {
      const cur = localStorage.getItem(STORAGE_KEY);
      if (cur) {
        try {
          const p = JSON.parse(cur) as Prefs;
          setAnalytics(!!p.analytics);
          setMarketing(!!p.marketing);
        } catch {}
      }
      setCustomising(true);
      setOpen(true);
    };
    return () => {
      delete window.openCookieSettings;
    };
  }, []);

  const acceptAll = () => {
    save({ necessary: true, analytics: true, marketing: true, timestamp: new Date().toISOString() });
    setOpen(false);
    setCustomising(false);
  };

  const rejectAll = () => {
    save({ necessary: true, analytics: false, marketing: false, timestamp: new Date().toISOString() });
    setOpen(false);
    setCustomising(false);
  };

  const saveChoices = () => {
    save({ necessary: true, analytics, marketing, timestamp: new Date().toISOString() });
    setOpen(false);
    setCustomising(false);
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie preferences"
      className="fixed inset-x-0 bottom-0 z-[100] p-3 sm:p-4 md:p-6 pointer-events-none"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl">
        <div className="p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="hidden sm:flex h-10 w-10 shrink-0 rounded-xl bg-primary/10 text-primary items-center justify-center">
              <Cookie className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="font-['Barlow_Condensed'] text-xl sm:text-2xl font-bold tracking-wide uppercase text-foreground">
                We use cookies
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                We use cookies to keep Scarpers running and to understand how it's used. You can accept all,
                reject non-essential, or choose what to allow. See our{" "}
                <a href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                  Privacy Policy
                </a>
                .
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={rejectAll}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {customising && (
            <div className="mt-4 space-y-3 border-t border-border/50 pt-4">
              <Row
                title="Strictly necessary"
                desc="Required for the site to work (sign in, security). Always on."
                checked
                disabled
              />
              <Row
                title="Analytics"
                desc="Google Analytics to understand usage and improve the app."
                checked={analytics}
                onChange={setAnalytics}
              />
              <Row
                title="Marketing"
                desc="Used to measure ad performance. Off by default."
                checked={marketing}
                onChange={setMarketing}
              />
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row sm:justify-end gap-2">
            {!customising ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setCustomising(true)}>
                  Customise
                </Button>
                <Button variant="outline" size="sm" onClick={rejectAll}>
                  Reject non-essential
                </Button>
                <Button size="sm" onClick={acceptAll}>
                  Accept all
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={rejectAll}>
                  Reject non-essential
                </Button>
                <Button variant="outline" size="sm" onClick={acceptAll}>
                  Accept all
                </Button>
                <Button size="sm" onClick={saveChoices}>
                  Save choices
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Row = ({
  title,
  desc,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
}) => (
  <div className="flex items-start justify-between gap-3">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{desc}</p>
    </div>
    <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
  </div>
);

export default CookieConsent;
