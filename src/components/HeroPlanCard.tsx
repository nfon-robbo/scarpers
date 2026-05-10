import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay, parseISO, isAfter, startOfDay } from "date-fns";
import heroRunner from "@/assets/hero-runner.jpg";
import { Cloud, CloudRain, CloudSnow, Sun, CloudSun, CloudFog, Zap, Check, ChevronLeft, ChevronRight } from "lucide-react";

interface HeroPlanCardProps {
  name: string | null;
  raceDistance: string | null;
  planStartDate: string | null;
  nextRunDate: Date | null;
  completedDates?: Set<string>; // yyyy-MM-dd
  plannedDates?: Set<string>;   // yyyy-MM-dd (non-rest planned workout days)
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;


const distanceLabel = (d: string | null) => {
  if (!d) return "Your Goal";
  const map: Record<string, string> = {
    "5k": "5K",
    "10k": "10K",
    "half-marathon": "Half Marathon",
    "marathon": "Marathon",
    "ultra": "Ultra",
  };
  return map[d.toLowerCase()] || d;
};

interface Weather {
  tempC: number;
  code: number;
}

function weatherIcon(code: number) {
  // WMO weather codes (Open-Meteo)
  if (code === 0) return Sun;
  if ([1, 2].includes(code)) return CloudSun;
  if (code === 3) return Cloud;
  if ([45, 48].includes(code)) return CloudFog;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return CloudRain;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return CloudSnow;
  if ([95, 96, 99].includes(code)) return Zap;
  return CloudSun;
}

export default function HeroPlanCard({ name, raceDistance, planStartDate, nextRunDate }: HeroPlanCardProps) {
  const [weather, setWeather] = useState<Weather | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = sessionStorage.getItem("hero_weather");
    if (cached) {
      try {
        const c = JSON.parse(cached);
        if (Date.now() - c.t < 30 * 60 * 1000) {
          setWeather({ tempC: c.tempC, code: c.code });
          return;
        }
      } catch {}
    }
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code`
          );
          const j = await res.json();
          if (cancelled || !j?.current) return;
          const w = { tempC: Math.round(j.current.temperature_2m), code: j.current.weather_code };
          setWeather(w);
          sessionStorage.setItem("hero_weather", JSON.stringify({ ...w, t: Date.now() }));
        } catch {}
      },
      () => {},
      { maximumAge: 30 * 60 * 1000, timeout: 8000 }
    );
    return () => { cancelled = true; };
  }, []);

  // Date to display: next run if plan has started, else plan start date
  const { dateLabel, dateValue } = useMemo(() => {
    const today = startOfDay(new Date());
    const startDate = planStartDate ? parseISO(planStartDate) : null;
    if (startDate && isAfter(startOfDay(startDate), today)) {
      return { dateLabel: "Plan Start Date", dateValue: startDate };
    }
    if (nextRunDate) {
      return { dateLabel: "Next Run", dateValue: nextRunDate };
    }
    if (startDate) {
      return { dateLabel: "Plan Started", dateValue: startDate };
    }
    return { dateLabel: null, dateValue: null };
  }, [planStartDate, nextRunDate]);

  // Days of the week (Mon–Sun), highlight today, mark next run day
  const weekDays = useMemo(() => {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  }, []);

  const WIcon = weather ? weatherIcon(weather.code) : null;

  const titleDistance = distanceLabel(raceDistance);
  const displayName = name?.trim() || "Runner";

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/30 shadow-xl">
      {/* Background image */}
      <img
        src={heroRunner}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        loading="eager"
      />
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/70 to-background/85" />
      <div className="absolute inset-0 bg-primary/20 mix-blend-multiply" />

      <div className="relative p-5 sm:p-6 text-white">
        {/* Title */}
        <h2
          className="text-xl sm:text-2xl font-bold leading-tight pr-24 sm:pr-28 drop-shadow-md"
          style={{ fontFamily: "'Space Grotesk', sans-serif" }}
        >
          {displayName}'s {titleDistance}{raceDistance ? " Training" : ""}
        </h2>

        {/* Weather top-right */}
        {weather && WIcon && (
          <div className="absolute top-5 right-5 sm:top-6 sm:right-6 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/15 backdrop-blur-md border border-white/20">
            <WIcon className="w-4 h-4 text-yellow-200" />
            <span className="text-sm font-semibold">{weather.tempC}°C</span>
          </div>
        )}

        {/* Date */}
        {dateLabel && dateValue && (
          <div className="mt-5">
            <p
              className="text-base sm:text-lg font-bold text-primary drop-shadow"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              {dateLabel}
            </p>
            <p className="text-sm sm:text-base text-white/90 mt-0.5">
              {format(dateValue, "EEEE do MMMM yyyy")}
            </p>
          </div>
        )}

        {/* Week pills */}
        <div className="mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
          {weekDays.map((d) => {
            const isToday = isSameDay(d, new Date());
            const isNextRun = dateValue && isSameDay(d, dateValue);
            const highlight = isNextRun || isToday;
            return (
              <div
                key={d.toISOString()}
                className={`flex items-start justify-center pt-2 rounded-xl h-16 sm:h-20 text-xs sm:text-sm font-semibold border transition-colors ${
                  highlight
                    ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30"
                    : "bg-white/10 backdrop-blur-md text-white border-white/20"
                }`}
              >
                {format(d, "EEE")}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
