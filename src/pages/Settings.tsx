import { useState } from "react";
import { useUnits, UnitPreferences } from "@/hooks/useUnits";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Ruler, Gauge, Mountain, Thermometer, Weight, Moon, RefreshCw, Loader2, CheckCircle2 } from "lucide-react";
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

const Settings = () => {
  const { units, setUnit } = useUnits();
  const { user } = useAuth();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);

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
    </div>
  );
};

export default Settings;
