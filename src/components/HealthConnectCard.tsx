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
  getGrantedHealthConnectPermissions,
  syncHealthConnect,
  HEALTH_CONNECT_ALL_HISTORY_START_ISO,
  HEALTH_CONNECT_HISTORY_PERMISSION,
} from "@/lib/health-connect";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown; errorMessage?: unknown }).message ??
      (error as { message?: unknown; errorMessage?: unknown }).errorMessage;
    if (typeof message === "string") return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const HealthConnectCard = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [supported, setSupported] = useState(false);
  const [availability, setAvailability] = useState<string>("");
  const [granted, setGranted] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [errors, setErrors] = useState<{ type: string; message: string }[]>([]);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [hasHistoryAccess, setHasHistoryAccess] = useState(false);

  const refreshGranted = async () => {
    const list = await getGrantedHealthConnectPermissions();
    setGranted(list.length > 0);
    setHasHistoryAccess(list.includes(HEALTH_CONNECT_HISTORY_PERMISSION));
  };

  useEffect(() => {
    if (!isHealthConnectPlatform()) return;
    setSupported(true);
    ensureHealthConnectAvailable()
      .then((a) => {
        setAvailability(a);
        if (a === "Available") refreshGranted();
      })
      .catch(() => setAvailability("NotSupported"));
  }, []);

  if (!supported) return null;

  const handleConnect = async () => {
    try {
      await requestHealthConnectPermissions();
      await refreshGranted();
      const list = await getGrantedHealthConnectPermissions();
      if (list.length > 0) toast({ title: `Health Connect granted (${list.length} permissions)` });
      else toast({ title: "Permissions denied", variant: "destructive" });
    } catch (e: unknown) {
      toast({ title: "Permission error", description: getErrorMessage(e), variant: "destructive" });
    }
  };

  const handleSync = async () => {
    if (!user) return;
    setSyncing(true);
    setErrors([]);
    setFatalError(null);
    try {
      const { metricsCount, sleepCount, readErrors } = await syncHealthConnect(user.id, 3650);
      setErrors(readErrors ?? []);
      toast({
        title: "Health Connect synced",
        description: `From 01/01/2016 · ${metricsCount} days updated · ${sleepCount} sleep segments${
          readErrors?.length ? ` · ${readErrors.length} type(s) failed` : ""
        }`,
      });
      window.dispatchEvent(new CustomEvent("sleep-stages-synced"));
    } catch (e: unknown) {
      const msg = getErrorMessage(e);
      setFatalError(String(msg));
      toast({ title: "Sync failed", description: msg, variant: "destructive" });
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
            ? "Sync sleep stages, resting HR, steps and active calories from Garmin Connect (via Health Connect)."
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
            Sync all history
          </Button>
        </div>

        {(fatalError || errors.length > 0) && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
            <div className="text-xs font-semibold text-destructive">
              Health Connect sync errors
            </div>
            {fatalError && (
              <div className="text-xs">
                <div className="font-medium">Fatal:</div>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                  {fatalError}
                </pre>
              </div>
            )}
            {errors.map((er, i) => (
              <div key={i} className="text-xs">
                <div className="font-medium">{er.type}</div>
                <pre className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                  {er.message}
                </pre>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-3">
          Pulls all available history from {new Date(HEALTH_CONNECT_ALL_HISTORY_START_ISO).toLocaleDateString("en-GB")}. {hasHistoryAccess ? "History access is granted." : "Tap Grant access and approve history access, otherwise Android may only return recent data."}
        </p>
      </CardContent>
    </Card>
  );
};

export default HealthConnectCard;
