import { createContext, useContext, useState, useEffect, ReactNode } from "react";

export interface UnitPreferences {
  distance: "km" | "mi";
  speed: "km/h" | "mph" | "min/km" | "min/mi";
  elevation: "m" | "ft";
  temperature: "C" | "F";
  weight: "kg" | "lbs";
}

const defaultUnits: UnitPreferences = {
  distance: "km",
  speed: "km/h",
  elevation: "m",
  temperature: "C",
  weight: "kg",
};

interface UnitsContextType {
  units: UnitPreferences;
  setUnit: <K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) => void;
  fmt: {
    distance: (meters: number | null | undefined) => string | null;
    speed: (kmh: number | null | undefined) => string | null;
    elevation: (meters: number | null | undefined) => string | null;
    temperature: (celsius: number | null | undefined) => string | null;
    weight: (kg: number | null | undefined) => string | null;
    pace: (kmh: number | null | undefined) => string | null;
  };
  label: {
    distance: string;
    speed: string;
    elevation: string;
    temperature: string;
    weight: string;
    pace: string;
  };
}

const UnitsContext = createContext<UnitsContextType | null>(null);

const STORAGE_KEY = "unit-preferences";

function formatMinSec(totalMin: number): string {
  const m = Math.floor(totalMin);
  const s = Math.round((totalMin - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [units, setUnits] = useState<UnitPreferences>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? { ...defaultUnits, ...JSON.parse(stored) } : defaultUnits;
    } catch {
      return defaultUnits;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(units));
  }, [units]);

  const setUnit = <K extends keyof UnitPreferences>(key: K, value: UnitPreferences[K]) => {
    setUnits((prev) => ({ ...prev, [key]: value }));
  };

  const KM_TO_MI = 0.621371;
  const M_TO_FT = 3.28084;
  const KG_TO_LBS = 2.20462;

  const fmt = {
    distance: (meters: number | null | undefined): string | null => {
      if (meters == null) return null;
      if (units.distance === "mi") return `${(meters / 1000 * KM_TO_MI).toFixed(2)} mi`;
      return `${(meters / 1000).toFixed(2)} km`;
    },
    speed: (kmh: number | null | undefined): string | null => {
      if (kmh == null) return null;
      if (units.speed === "mph") return `${(Number(kmh) * KM_TO_MI).toFixed(1)} mph`;
      if (units.speed === "min/km") {
        if (Number(kmh) <= 0) return null;
        return `${formatMinSec(60 / Number(kmh))} /km`;
      }
      if (units.speed === "min/mi") {
        if (Number(kmh) <= 0) return null;
        return `${formatMinSec(60 / (Number(kmh) * KM_TO_MI))} /mi`;
      }
      return `${Number(kmh).toFixed(1)} km/h`;
    },
    pace: (kmh: number | null | undefined): string | null => {
      if (kmh == null || Number(kmh) <= 0) return null;
      if (units.speed === "min/mi" || units.distance === "mi") {
        return `${formatMinSec(60 / (Number(kmh) * KM_TO_MI))} /mi`;
      }
      return `${formatMinSec(60 / Number(kmh))} /km`;
    },
    elevation: (meters: number | null | undefined): string | null => {
      if (meters == null) return null;
      if (units.elevation === "ft") return `${Math.round(Number(meters) * M_TO_FT)} ft`;
      return `${Math.round(Number(meters))} m`;
    },
    temperature: (celsius: number | null | undefined): string | null => {
      if (celsius == null) return null;
      if (units.temperature === "F") return `${Math.round(Number(celsius) * 9 / 5 + 32)}°F`;
      return `${Number(celsius)}°C`;
    },
    weight: (kg: number | null | undefined): string | null => {
      if (kg == null) return null;
      if (units.weight === "lbs") return `${(Number(kg) * KG_TO_LBS).toFixed(1)} lbs`;
      return `${Number(kg)} kg`;
    },
  };

  const label = {
    distance: units.distance === "mi" ? "mi" : "km",
    speed: units.speed,
    elevation: units.elevation === "ft" ? "ft" : "m",
    temperature: units.temperature === "F" ? "°F" : "°C",
    weight: units.weight === "lbs" ? "lbs" : "kg",
    pace: units.distance === "mi" || units.speed === "min/mi" ? "min/mi" : "min/km",
  };

  return (
    <UnitsContext.Provider value={{ units, setUnit, fmt, label }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used within UnitsProvider");
  return ctx;
}
