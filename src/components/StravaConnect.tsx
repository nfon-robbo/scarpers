import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle2, Unlink } from "lucide-react";

const StravaConnect = () => {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const checkStatus = useCallback(async () => {
    if (!session?.access_token) return;
    try {
      const { data, error } = await supabase.functions.invoke("strava-auth", {
        body: null,
        method: "GET",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      // Use fetch directly because invoke doesn't support query params well
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
      window.open(url, "strava-auth", "width=600,height=700");
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

    try {
      let totalImported = 0;
      let totalSkipped = 0;
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strava-import`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ page, per_page: 50 }),
          }
        );

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Import failed");
        }

        const result = await res.json();
        totalImported += result.imported;
        totalSkipped += result.skipped || 0;
        hasMore = result.has_more;
        page++;
      }

      setImportResult({ imported: totalImported, skipped: totalSkipped });
      toast({
        title: "Strava import complete",
        description: `${totalImported} new activities imported${totalSkipped > 0 ? `, ${totalSkipped} already existed` : ""}.`,
      });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
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
            <div className="flex gap-3">
              <Button onClick={handleImport} disabled={importing}>
                {importing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                {importing ? "Importing..." : "Import Activities"}
              </Button>
              <Button variant="outline" onClick={handleDisconnect}>
                <Unlink className="w-4 h-4 mr-2" />
                Disconnect
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
