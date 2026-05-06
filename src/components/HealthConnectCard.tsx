import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, CheckCircle2, Smartphone } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  isHealthConnectPlatform,
  ensureHealthConnectAvailable,
  requestHealthConnectPermissions,
  syncHealthConnect,
} from "@/lib/health-connect";

const HealthConnectCard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [supported, setSupported] = useState(false);
  const [availability, setAvailability] = useState<string>("");
  const [granted, setGranted] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!isHealthConnectPlatform()) return;
    setSupported(true);
    ensureHealthConnectAvailable()
      .then((a) => setAvailability(a))
      .catch(() => setAvailability("NotSupported"));
  }, []);

  if (!supported) return null;

  const handleConnect = async () => {
    try {
      const res: any = await requestHealthConnectPermissions();
      const ok = res?.grantedPermissions?.length > 0 || res?.hasAllPermissions;
      setGranted(!!ok);
      if (ok) toast({ title: "Health Connect granted" });
      else toast({ title: "Permissions denied", variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Permission error", description: e?.message, variant: "destructive" });
    }
  };

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    try {
      const { metricsCount } = await syncHealthConnect(user.id, 7);
      toast({
        title: "Health Connect synced",
        description: `${metricsCount} days updated (steps, calories, resting HR)`,
      });
      window.dispatchEvent(new CustomEvent("sleep-stages-synced"));
    } catch (e: any) {
      toast({ title: "Sync failed", description: e?.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Smartphone className="w-5 h-5" />
          Health Connect (Android)
          {granted && <CheckCircle2 className="w-4 h-4 text-primary" />}
        </CardTitle>
        <CardDescription>
          {availability === "Available"
            ? "Sync resting HR, steps and active calories from your phone (sleep stages coming soon)"
            : availability === "NotInstalled"
            ? "Install Health Connect from the Play Store first"
            : availability === "NotSupported"
            ? "Health Connect not supported on this device"
            : "Checking…"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          <Button size="sm" onClick={handleConnect} disabled={availability !== "Available"}>
            Grant access
          </Button>
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing || availability !== "Available"}>
            {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Sync now
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default HealthConnectCard;
