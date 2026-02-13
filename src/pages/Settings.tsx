import { useUnits, UnitPreferences } from "@/hooks/useUnits";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ruler, Gauge, Mountain, Thermometer, Weight } from "lucide-react";

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
    </div>
  );
};

export default Settings;
