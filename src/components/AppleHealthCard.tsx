import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Apple, Copy, KeyRound, Loader2, RefreshCw, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

const ENDPOINT = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apple-health-ingest`;

type TokenRow = {
  id: string;
  token_hint: string | null;
  created_at: string;
  last_seen_at: string | null;
  last_payload_summary: string | null;
};

const randomToken = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const sha256Hex = async (value: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const copy = async (value: string, label: string) => {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy — select the text and copy manually");
  }
};

const AppleHealthCard = () => {
  const { user } = useAuth();
  const [row, setRow] = useState<TokenRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("apple_health_tokens")
      .select("id, token_hint, created_at, last_seen_at, last_payload_summary")
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setRow((data as TokenRow) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const createToken = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const token = randomToken();
      const token_hash = await sha256Hex(token);
      // Revoke any previous key so only one is ever live.
      await supabase
        .from("apple_health_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("revoked_at", null);

      const { error } = await supabase.from("apple_health_tokens").insert({
        user_id: user.id,
        token_hash,
        token_hint: `…${token.slice(-6)}`,
      });
      if (error) throw error;
      setFreshToken(token);
      await load();
      toast.success("Key created — copy it now, it's only shown once");
    } catch (e) {
      toast.error("Couldn't create key", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Apple className="w-5 h-5" />
          Apple Health (iPhone)
          {row?.last_seen_at && <CheckCircle2 className="w-4 h-4 text-primary" />}
        </CardTitle>
        <CardDescription>
          Send sleep stages, resting heart rate, HRV, steps, calories and workouts from your iPhone automatically,
          using the Health Auto Export app.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="text-xs text-muted-foreground space-y-1 list-decimal pl-4">
          <li>Install <strong>Health Auto Export — JSON/CSV</strong> from the App Store and allow it to read Apple Health.</li>
          <li>Create your key below and copy it.</li>
          <li>In the app, create <strong>two automations</strong> (Health Auto Export only allows one data type per automation):</li>
          <li className="list-none pl-4">
            <strong>Automation 1 — Metrics:</strong> Sleep Analysis, Resting Heart Rate, Heart Rate Variability, Step Count, Active Energy.
          </li>
          <li className="list-none pl-4">
            <strong>Automation 2 — Workouts:</strong> Workouts. In the Workout Configuration, turn on <strong>Include Route Data</strong> so maps draw your route.
          </li>
          <li>For each automation: paste the web address below, set format to <strong>JSON</strong>, and add a header
            <strong> Authorization</strong> with value <strong>Bearer YOUR-KEY</strong>.</li>
          <li>Set both to run automatically (hourly or each morning) and save.</li>
        </ol>

        <div className="space-y-1">
          <div className="text-xs font-medium">Web address</div>
          <div className="flex gap-2">
            <Input readOnly value={ENDPOINT} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button size="icon" variant="outline" onClick={() => copy(ENDPOINT, "Web address")}>
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {freshToken && (
          <div className="space-y-1">
            <div className="text-xs font-medium">Your key (shown once)</div>
            <div className="flex gap-2">
              <Input readOnly value={freshToken} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="icon" variant="outline" onClick={() => copy(freshToken, "Key")}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              In Health Auto Export, the header value is: Bearer {freshToken}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={createToken} disabled={creating || loading}>
            {creating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : row ? <RefreshCw className="w-4 h-4 mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
            {row ? "Create a new key" : "Create key"}
          </Button>
          {row && !freshToken && (
            <span className="text-xs text-muted-foreground">Key ending {row.token_hint ?? "—"} is active.</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          {loading
            ? "Checking…"
            : row?.last_seen_at
            ? `Last data received ${format(new Date(row.last_seen_at), "dd/MM/yyyy HH:mm")}${row.last_payload_summary ? ` · ${row.last_payload_summary}` : ""}.`
            : "No data received yet. Once your iPhone sends its first batch, it'll show here."}
        </p>
      </CardContent>
    </Card>
  );
};

export default AppleHealthCard;
