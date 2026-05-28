import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, Unlink, RefreshCw } from "lucide-react";

const GoogleFitConnect = () => {
  const { session } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const checkStatus = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-fit-auth?action=status`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const result = await res.json();
      setConnected(result.connected);
    } catch {
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    checkStatus();

    const expectedOrigin = new URL(import.meta.env.VITE_SUPABASE_URL).origin;
    const handler = (e: MessageEvent) => {
      if (e.origin !== expectedOrigin) return;
      if (e.data === "google-fit-connected") {
        setConnected(true);
        toast({ title: "Google Fit connected!", description: "You can now sync sleep stage data." });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [checkStatus, toast]);

  const handleConnect = async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-fit-auth?action=authorize`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const { url } = await res.json();
      const popup = window.open(url, "google-fit-auth", "width=600,height=700");

      // COOP can block postMessage from the callback page, so also poll
      // status until we see "connected" or the popup closes.
      let attempts = 0;
      let notified = false;
      const interval = setInterval(async () => {
        attempts++;
        const popupClosed = !popup || popup.closed;
        await checkStatus();
        setConnected((prev) => {
          if (prev && !notified) {
            notified = true;
            toast({ title: "Google Fit connected!", description: "You can now sync sleep stage data." });
            try { popup?.close(); } catch { /* ignore */ }
            clearInterval(interval);
          }
          return prev;
        });
        if (popupClosed || attempts > 60) {
          clearInterval(interval);
        }
      }, 2000);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleDisconnect = async () => {
    if (!session?.access_token) return;
    try {
      await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-fit-auth?action=disconnect`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        }
      );
      setConnected(false);
      toast({ title: "Google Fit disconnected" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleSync = async () => {
    if (!session?.access_token) return;
    setSyncing(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-fit-sleep`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ days: 14 }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Sync failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Sleep stages synced", description: `${data.synced} segments from ${data.sessions} sessions` });
        // Notify parent to refresh
        window.dispatchEvent(new CustomEvent("sleep-stages-synced"));
      }
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Checking Google Fit connection...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          Google Fit – Sleep Stages
          {connected && <CheckCircle2 className="w-4 h-4 text-primary" />}
        </CardTitle>
        <CardDescription>
          {connected
            ? "Connected — sync to get Deep, Light, REM & Awake breakdown"
            : "Connect Google Fit for granular sleep stage data from your watch"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {connected ? (
          <div className="flex flex-wrap gap-3">
            <Button size="sm" onClick={handleSync} disabled={syncing}>
              {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              Sync Sleep Stages
            </Button>
            <Button size="sm" variant="outline" onClick={handleDisconnect}>
              <Unlink className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={handleConnect}>
            Connect Google Fit
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default GoogleFitConnect;
