import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, Unlink, Trash2 } from "lucide-react";
import { startStravaBackgroundImport, isStravaImportRunning } from "@/lib/strava-background-import";

const StravaConnect = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(isStravaImportRunning());
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [importTypes, setImportTypes] = useState<Record<string, boolean>>({
    Run: true,
    Walk: true,
    Ride: false,
    Swim: false,
    Hike: false,
  });

  const checkStatus = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-auth?action=status`,
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

    const handler = (e: MessageEvent) => {
      if (e.data === "strava-connected") {
        setConnected(true);
        toast({ title: "Strava connected!", description: "You can now import your activities." });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [checkStatus, toast]);

  const handleConnect = async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-auth?action=authorize`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      const { url } = await res.json();
      const popup = window.open(url, "strava-auth", "width=600,height=700");

      // Fallback: COOP can block postMessage, so poll status until connected or popup closes
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const popupClosed = !popup || popup.closed;
        await checkStatus();
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
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-auth?action=disconnect`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        }
      );
      setConnected(false);
      toast({ title: "Strava disconnected" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleImport = async () => {
    if (!session?.access_token) return;
    setImporting(true);
    setImportResult(null);
    // Fire-and-forget: keeps running across navigation/unmount
    startStravaBackgroundImport(session.access_token).finally(() => {
      setImporting(false);
    });
    toast({
      title: "Strava import started",
      description: "It'll keep running in the background — feel free to continue.",
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Checking Strava connection...</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Strava
          {connected && <CheckCircle2 className="w-4 h-4 text-primary" />}
        </CardTitle>
        <CardDescription>
          {connected ? "Your Strava account is connected" : "Connect your Strava account to import activities"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="flex flex-wrap gap-4">
              {Object.entries(importTypes).map(([type, checked]) => (
                <div key={type} className="flex items-center gap-2">
                  <Checkbox
                    id={`strava-${type}`}
                    checked={checked}
                    onCheckedChange={(v) => setImportTypes(prev => ({ ...prev, [type]: !!v }))}
                  />
                  <Label htmlFor={`strava-${type}`} className="text-sm cursor-pointer">{type}s</Label>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button onClick={handleImport} disabled={importing || !Object.values(importTypes).some(Boolean)}>
                {importing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {importing ? "Importing..." : "Import Activities"}
              </Button>
              <Button variant="outline" onClick={handleDisconnect}>
                <Unlink className="w-4 h-4 mr-2" />
                Disconnect
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  if (!confirm("Delete all Strava-imported activities? This cannot be undone.")) return;
                  setDeleting(true);
                  try {
                    const { count, error } = await supabase
                      .from("activities")
                      .delete({ count: "exact" })
                      .eq("user_id", user!.id)
                      .like("source_file", "strava:%");
                    if (error) throw error;
                    toast({ title: "Deleted", description: `${count ?? 0} Strava activities removed.` });
                    setImportResult(null);
                  } catch (e: any) {
                    toast({ title: "Error", description: e.message, variant: "destructive" });
                  } finally {
                    setDeleting(false);
                  }
                }}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
                Delete All Strava Workouts
              </Button>
            </div>
            {importResult && (
              <p className="text-sm text-muted-foreground">
                Imported {importResult.imported} activities
                {importResult.skipped > 0 && `, skipped ${importResult.skipped} duplicates`}
              </p>
            )}
          </>
        ) : (
          <Button onClick={handleConnect} className="bg-[#FC4C02] hover:bg-[#e04400] text-white">
            Connect Strava
          </Button>
        )}
      </CardContent>
    </Card>
  );
};

export default StravaConnect;
