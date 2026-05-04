import { useState, useEffect } from "react";
import { useUnits, UnitPreferences } from "@/hooks/useUnits";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Ruler, Gauge, Mountain, Thermometer, Weight, Moon, RefreshCw, Loader2, Timer, CheckCircle2, AlertCircle, Apple, Copy, Check, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface UnitOption<K extends keyof UnitPreferences> {
  key: K;
  label: string;
  icon: any;
  description: string;
  options: { value: UnitPreferences[K]; label: string }[];
}

const unitSettings: UnitOption<keyof UnitPreferences>[] = [
  {
    key: "distance",
    label: "Distance",
    icon: Ruler,
    description: "Used for total distance, split distances",
    options: [
      { value: "km", label: "Kilometers (km)" },
      { value: "mi", label: "Miles (mi)" },
    ],
  },
  {
    key: "speed",
    label: "Speed / Pace",
    icon: Gauge,
    description: "Used for avg/max speed, split pace",
    options: [
      { value: "km/h", label: "km/h" },
      { value: "mph", label: "mph" },
      { value: "min/km", label: "min/km (pace)" },
      { value: "min/mi", label: "min/mi (pace)" },
    ],
  },
  {
    key: "elevation",
    label: "Elevation",
    icon: Mountain,
    description: "Used for ascent, descent, altitude",
    options: [
      { value: "m", label: "Meters (m)" },
      { value: "ft", label: "Feet (ft)" },
    ],
  },
  {
    key: "temperature",
    label: "Temperature",
    icon: Thermometer,
    description: "Used for avg temperature readings",
    options: [
      { value: "C", label: "Celsius (°C)" },
      { value: "F", label: "Fahrenheit (°F)" },
    ],
  },
  {
    key: "weight",
    label: "Weight",
    icon: Weight,
    description: "Used for body weight metrics",
    options: [
      { value: "kg", label: "Kilograms (kg)" },
      { value: "lbs", label: "Pounds (lbs)" },
    ],
  },
];

interface SyncSchedule {
  strava_enabled: boolean;
  strava_interval_hours: number;
  intervals_enabled: boolean;
  intervals_interval_hours: number;
  google_fit_enabled: boolean;
  google_fit_hour_utc: number;
}

const defaultSchedule: SyncSchedule = {
  strava_enabled: false,
  strava_interval_hours: 2,
  intervals_enabled: false,
  intervals_interval_hours: 6,
  google_fit_enabled: false,
  google_fit_hour_utc: 8,
};

const Settings = () => {
  const { units, setUnit } = useUnits();
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Personal details
  const [personal, setPersonal] = useState({
    sex: "",
    date_of_birth: "",
    height_cm: "",
    weight_kg: "",
  });
  const [savingPersonal, setSavingPersonal] = useState(false);

  useEffect(() => {
    if (profile) {
      setPersonal({
        sex: profile.sex ?? "",
        date_of_birth: profile.date_of_birth ?? "",
        height_cm: profile.height_cm != null ? String(profile.height_cm) : "",
        weight_kg: profile.weight_kg != null ? String(profile.weight_kg) : "",
      });
    }
  }, [profile]);

  const savePersonal = async () => {
    if (!user) return;
    setSavingPersonal(true);
    try {
      const { error } = await supabase.from("profiles").update({
        sex: personal.sex || null,
        date_of_birth: personal.date_of_birth || null,
        height_cm: personal.height_cm ? Number(personal.height_cm) : null,
        weight_kg: personal.weight_kg ? Number(personal.weight_kg) : null,
      }).eq("user_id", user.id);
      if (error) throw error;
      toast({ title: "Personal details saved" });
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingPersonal(false);
    }
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apple-health-sleep`;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  // Auto-sync state
  const [schedule, setSchedule] = useState<SyncSchedule>(defaultSchedule);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [googleFitConnected, setGoogleFitConnected] = useState(false);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Load schedule and connection status in parallel
    const load = async () => {
      const [schedRes, stravaRes, gfRes] = await Promise.all([
        supabase.from("sync_schedules").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("strava_tokens").select("id").eq("user_id", user.id).maybeSingle(),
        supabase.from("google_fit_tokens").select("id").eq("user_id", user.id).maybeSingle(),
      ]);
      if (schedRes.data) {
        setSchedule({
          strava_enabled: schedRes.data.strava_enabled,
          strava_interval_hours: schedRes.data.strava_interval_hours,
          intervals_enabled: schedRes.data.intervals_enabled,
          intervals_interval_hours: schedRes.data.intervals_interval_hours,
          google_fit_enabled: schedRes.data.google_fit_enabled,
          google_fit_hour_utc: schedRes.data.google_fit_hour_utc,
        });
      }
      setStravaConnected(!!stravaRes.data);
      setGoogleFitConnected(!!gfRes.data);
      setScheduleLoaded(true);
    };
    load();
  }, [user]);

  const saveSchedule = async () => {
    if (!user) return;
    setSavingSchedule(true);
    try {
      const { data: existing } = await supabase
        .from("sync_schedules").select("id").eq("user_id", user.id).maybeSingle();

      if (existing) {
        await supabase.from("sync_schedules").update(schedule).eq("user_id", user.id);
      } else {
        await supabase.from("sync_schedules").insert({ user_id: user.id, ...schedule });
      }
      toast({ title: "Auto-sync schedule saved" });
    } catch (e: any) {
      toast({ title: "Failed to save schedule", description: e.message, variant: "destructive" });
    } finally {
      setSavingSchedule(false);
    }
  };

  const syncWellness = async () => {
    if (!user) return;
    setSyncing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Session expired", variant: "destructive" });
        return;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intervals-wellness`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({}),
        }
      );

      const data = await resp.json();

      if (!resp.ok) {
        toast({ title: "Sync failed", description: data.error, variant: "destructive" });
        return;
      }

      toast({
        title: "Wellness data synced",
        description: `${data.synced} days updated from Intervals.icu (last 90 days)`,
      });
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const formatHourUtc = (hour: number) => {
    const date = new Date();
    date.setUTCHours(hour, 0, 0, 0);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Customize how your data is displayed</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Units of Measurement</CardTitle>
          <CardDescription>Choose your preferred units for each metric type</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {unitSettings.map(({ key, label, icon: Icon, description, options }) => (
            <div key={key} className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
              </div>
              <Select
                value={units[key]}
                onValueChange={(v) => setUnit(key, v as any)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Auto-Sync Schedule Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Timer className="w-5 h-5" />
            Auto-Sync Schedule
          </CardTitle>
          <CardDescription>
            Enable automatic background syncing for your connected data sources
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Strava */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">
                <Switch
                  checked={schedule.strava_enabled}
                  onCheckedChange={(v) => setSchedule((s) => ({ ...s, strava_enabled: v }))}
                  disabled={!stravaConnected}
                />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Strava Activities</p>
                  {!stravaConnected && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <AlertCircle className="w-3 h-3" /> Not connected
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Import new activities automatically</p>
              </div>
            </div>
            <Select
              value={String(schedule.strava_interval_hours)}
              onValueChange={(v) => setSchedule((s) => ({ ...s, strava_interval_hours: Number(v) }))}
              disabled={!schedule.strava_enabled}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Every 1 hour</SelectItem>
                <SelectItem value="2">Every 2 hours</SelectItem>
                <SelectItem value="4">Every 4 hours</SelectItem>
                <SelectItem value="6">Every 6 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Intervals.icu */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">
                <Switch
                  checked={schedule.intervals_enabled}
                  onCheckedChange={(v) => setSchedule((s) => ({ ...s, intervals_enabled: v }))}
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Intervals.icu Wellness</p>
                <p className="text-xs text-muted-foreground">Sync HRV, resting HR, steps, weight & more</p>
              </div>
            </div>
            <Select
              value={String(schedule.intervals_interval_hours)}
              onValueChange={(v) => setSchedule((s) => ({ ...s, intervals_interval_hours: Number(v) }))}
              disabled={!schedule.intervals_enabled}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">Every 4 hours</SelectItem>
                <SelectItem value="6">Every 6 hours</SelectItem>
                <SelectItem value="12">Every 12 hours</SelectItem>
                <SelectItem value="24">Every 24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Google Fit */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">
                <Switch
                  checked={schedule.google_fit_enabled}
                  onCheckedChange={(v) => setSchedule((s) => ({ ...s, google_fit_enabled: v }))}
                  disabled={!googleFitConnected}
                />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Google Fit Sleep</p>
                  {!googleFitConnected && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <AlertCircle className="w-3 h-3" /> Not connected
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Sync sleep stages once daily</p>
              </div>
            </div>
            <Select
              value={String(schedule.google_fit_hour_utc)}
              onValueChange={(v) => setSchedule((s) => ({ ...s, google_fit_hour_utc: Number(v) }))}
              disabled={!schedule.google_fit_enabled}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Time">
                  {formatHourUtc(schedule.google_fit_hour_utc)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {formatHourUtc(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Syncs run automatically in the background. You can still trigger manual syncs anytime.
            </p>
            <Button onClick={saveSchedule} disabled={savingSchedule} size="sm">
              {savingSchedule ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {savingSchedule ? "Saving..." : "Save & Apply"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Moon className="w-5 h-5" />
            Sleep & Wellness Sync
          </CardTitle>
          <CardDescription>
            Sync sleep, steps, HRV, resting HR, and weight from Intervals.icu (last 90 days)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={syncWellness} disabled={syncing}>
            {syncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {syncing ? "Syncing..." : "Sync Wellness Data"}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Pulls sleep duration, sleep score, HRV, resting heart rate, steps, weight, and stress data.
          </p>
        </CardContent>
      </Card>

      {/* Apple Health Setup Card */}
      {user && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Apple className="w-5 h-5" />
              Apple Health (Auto Export)
            </CardTitle>
            <CardDescription>
              Connect sleep data from your iPhone using the{" "}
              <a href="https://apps.apple.com/app/health-auto-export/id1115567461" target="_blank" rel="noopener noreferrer" className="underline text-primary">
                Health Auto Export
              </a>{" "}app
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Webhook URL</label>
              <div className="flex gap-2">
                <Input value={webhookUrl} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl, "url")}>
                  {copiedField === "url" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Your User ID</label>
              <div className="flex gap-2">
                <Input value={user.id} readOnly className="font-mono text-xs" />
                <Button variant="outline" size="icon" onClick={() => copyToClipboard(user.id, "uid")}>
                  {copiedField === "uid" ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            </div>
            <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Setup in Health Auto Export:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>New Automation → REST API</li>
                <li>Paste the <strong>Webhook URL</strong> above</li>
                <li>Add header: <code className="bg-background px-1 rounded">X-User-Id</code> → paste your <strong>User ID</strong></li>
                <li>Data Type → Health Metrics → select <strong>Sleep Analysis</strong></li>
                <li>Export Format → JSON, Summarize Data → OFF</li>
              </ol>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Settings;
