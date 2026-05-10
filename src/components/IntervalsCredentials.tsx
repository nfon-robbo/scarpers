import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, Unlink } from "lucide-react";

const IntervalsCredentials = ({ bare = false }: { bare?: boolean } = {}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [athleteId, setAthleteId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [hasExisting, setHasExisting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const { data } = await supabase
        .from("intervals_credentials")
        .select("athlete_id, api_key")
        .eq("user_id", user.id)
        .maybeSingle();
      if (data) {
        setAthleteId(data.athlete_id);
        setApiKey(data.api_key);
        setHasExisting(true);
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const save = async () => {
    if (!user) return;
    if (!athleteId.trim() || !apiKey.trim()) {
      toast({ title: "Missing details", description: "Enter both athlete ID and API key.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("intervals_credentials")
        .upsert(
          { user_id: user.id, athlete_id: athleteId.trim(), api_key: apiKey.trim() },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      setHasExisting(true);
      toast({ title: "Intervals.icu connected" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!user) return;
    if (!confirm("Remove your intervals.icu credentials?")) return;
    const { error } = await supabase.from("intervals_credentials").delete().eq("user_id", user.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    setAthleteId("");
    setApiKey("");
    setHasExisting(false);
    toast({ title: "Intervals.icu disconnected" });
  };

  if (loading) {
    const inner = (
      <div className="flex items-center gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">Loading intervals.icu settings…</span>
      </div>
    );
    if (bare) return inner;
    return (
      <Card>
        <CardContent className="p-6">{inner}</CardContent>
      </Card>
    );
  }

  const body = (
    <>
      <div className="space-y-2">
        <Label htmlFor="intervals-athlete">Athlete ID</Label>
        <Input id="intervals-athlete" placeholder="i123456" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="intervals-key">API Key</Label>
        <Input id="intervals-key" type="password" placeholder="••••••••" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
          {hasExisting ? "Update" : "Save"}
        </Button>
        {hasExisting && (
          <Button variant="outline" onClick={disconnect}>
            <Unlink className="w-4 h-4 mr-2" /> Disconnect
          </Button>
        )}
      </div>
    </>
  );

  if (bare) return <div className="space-y-3">{body}</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          intervals.icu
          {hasExisting && <CheckCircle2 className="w-4 h-4 text-primary" />}
        </CardTitle>
        <CardDescription>
          Connect using your own intervals.icu API key so wellness data and workout sync use your account. Find your API key under{" "}
          <a href="https://intervals.icu/settings" target="_blank" rel="noreferrer" className="underline">
            intervals.icu → Settings → Developer
          </a>
          . Your athlete ID is shown there too (e.g. <code>i123456</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">{body}</CardContent>
    </Card>
  );
};

export default IntervalsCredentials;
