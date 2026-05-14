import { useEffect, useMemo, useRef, useState } from "react";
import { format, isSameDay, parseISO, isAfter, startOfDay } from "date-fns";
import heroRunner from "@/assets/hero-runner.jpg";
import { Cloud, CloudRain, CloudSnow, Sun, CloudSun, CloudFog, Zap, Check, ChevronLeft, ChevronRight, Dumbbell, Clock, Activity } from "lucide-react";
import type { ParsedWorkout } from "@/lib/plan-export";
import { describeWorkoutLabel } from "@/lib/workout-title";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import WorkoutIntervalChart from "@/components/WorkoutIntervalChart";
import { expandWorkoutSteps, expandedToSegments } from "@/lib/plan-step-expand";

interface HeroPlanCardProps {
  name: string | null;
  raceDistance: string | null;
  planStartDate: string | null;
  nextRunDate: Date | null;
  workouts?: ParsedWorkout[];
  completedDates?: Set<string>; // yyyy-MM-dd of days with a logged run
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
  if (code === 0) return Sun;
  if ([1, 2].includes(code)) return CloudSun;
  if (code === 3) return Cloud;
  if ([45, 48].includes(code)) return CloudFog;
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return CloudRain;
  if ([71, 73, 75, 77, 85, 86].includes(code)) return CloudSnow;
  if ([95, 96, 99].includes(code)) return Zap;
  return CloudSun;
}

function weatherLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mainly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if ([45, 48].includes(code)) return "Fog";
  if ([51, 53, 55].includes(code)) return "Drizzle";
  if ([56, 57].includes(code)) return "Freezing drizzle";
  if ([61, 63, 65].includes(code)) return "Rain";
  if ([66, 67].includes(code)) return "Freezing rain";
  if ([71, 73, 75, 77].includes(code)) return "Snow";
  if ([80, 81, 82].includes(code)) return "Showers";
  if ([85, 86].includes(code)) return "Snow showers";
  if ([95, 96, 99].includes(code)) return "Thunderstorm";
  return "—";
}

function shortLabel(workout: ParsedWorkout): string {
  if (/rest/i.test(workout.title)) return "Rest";
  return describeWorkoutLabel(workout.title, workout.segments);
}

export default function HeroPlanCard({ name, raceDistance, planStartDate, nextRunDate, workouts = [], completedDates }: HeroPlanCardProps) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<ParsedWorkout | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather(lat: number, lon: number) {
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code`
        );
        const j = await res.json();
        if (cancelled || !j?.current) return;
        const w = { tempC: Math.round(j.current.temperature_2m), code: j.current.weather_code };
        setWeather(w);
        sessionStorage.setItem("hero_weather", JSON.stringify({ ...w, t: Date.now() }));
      } catch {}
    }

    async function fetchByIp() {
      try {
        const r = await fetch("https://get.geojs.io/v1/ip/geo.json");
        const g = await r.json();
        const lat = parseFloat(g.latitude);
        const lon = parseFloat(g.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          await fetchWeather(lat, lon);
        }
      } catch {}
    }

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

    const isNative = !!(window as any).Capacitor?.isNativePlatform?.();
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    if ((isNative || isMobileUA) && "geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => fetchWeather(pos.coords.latitude, pos.coords.longitude),
        () => { fetchByIp(); },
        { maximumAge: 30 * 60 * 1000, timeout: 6000 }
      );
    } else {
      fetchByIp();
    }
    return () => { cancelled = true; };
  }, []);

  // Date to display
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
    return { dateLabel: null as string | null, dateValue: null as Date | null };
  }, [planStartDate, nextRunDate]);

  // Map workouts by yyyy-MM-dd for quick lookup
  const workoutByDate = useMemo(() => {
    const m = new Map<string, ParsedWorkout>();
    for (const w of workouts) {
      if (w.dateObj && !/rest/i.test(w.title)) m.set(ymd(w.dateObj), w);
    }
    return m;
  }, [workouts]);

  // Build a full date strip: 21 days before today → 60 days after
  const stripDays = useMemo(() => {
    const today = startOfDay(new Date());
    const days: Date[] = [];
    for (let i = -21; i <= 60; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push(d);
    }
    return days;
  }, []);

  const today = startOfDay(new Date());

  // Auto-scroll to center today on mount
  useEffect(() => {
    if (scrollerRef.current && focusRef.current) {
      const s = scrollerRef.current;
      const t = focusRef.current;
      s.scrollLeft = t.offsetLeft - s.clientWidth / 2 + t.clientWidth / 2;
    }
  }, [stripDays.length]);

  const scrollBy = (delta: number) => {
    scrollerRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const WIcon = weather ? weatherIcon(weather.code) : null;
  const titleDistance = distanceLabel(raceDistance);
  const displayName = name?.trim() || "Runner";

  // HR zone to BPM range (for dialog)
  function hrZoneBpm(zone: string): string | null {
    const m = zone.match(/Z(\d)/i);
    if (!m) return null;
    switch (parseInt(m[1], 10)) {
      case 1: return "100–120 bpm";
      case 2: return "120–140 bpm";
      case 3: return "140–160 bpm";
      case 4: return "160–175 bpm";
      case 5: return "175–200 bpm";
      default: return null;
    }
  }

  return (
    <div className="relative overflow-hidden rounded-b-3xl border-b border-border/30 shadow-xl">
      <img src={heroRunner} alt="" className="absolute inset-0 w-full h-full object-cover" loading="eager" />
      <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/70 to-background/85" />
      <div className="absolute inset-0 bg-primary/20 mix-blend-multiply" />

      <div className="relative p-5 sm:p-6 text-white">
        <h2
          className="text-xl sm:text-2xl font-bold leading-tight pr-24 sm:pr-28 drop-shadow-md"
          style={{ fontFamily: "'Bebas Neue', sans-serif" }}
        >
          {displayName}'s {titleDistance}{raceDistance ? " Training" : ""}
        </h2>

        {weather && WIcon && (
          <div className="absolute top-5 right-5 sm:top-6 sm:right-6 flex flex-col items-end gap-0.5 px-2.5 py-1.5 rounded-xl bg-white/15 backdrop-blur-md border border-white/20">
            <div className="flex items-center gap-1.5">
              <WIcon className="w-4 h-4 text-yellow-200" />
              <span className="text-sm font-semibold">{weather.tempC}°C</span>
            </div>
            <span className="text-[10px] font-medium text-white/85 leading-none">
              {weatherLabel(weather.code)}
            </span>
          </div>
        )}

        {dateLabel && dateValue && (
          <div className="mt-5">
            <p className="text-base sm:text-lg font-bold text-primary drop-shadow" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
              {dateLabel}
            </p>
            <p className="text-sm sm:text-base text-white/90 mt-0.5">
              {format(dateValue, "EEEE do MMMM yyyy")}
            </p>
          </div>
        )}

        {/* Day strip — all days; highlight + clickable when there's a workout */}
        <div className="mt-5 relative">
          <button
            type="button"
            aria-label="Previous"
            onClick={() => scrollBy(-200)}
            className="hidden sm:flex absolute -left-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 items-center justify-center rounded-full bg-background/70 backdrop-blur border border-white/20 text-white hover:bg-background/90"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => scrollBy(200)}
            className="hidden sm:flex absolute -right-2 top-1/2 -translate-y-1/2 z-10 w-7 h-7 items-center justify-center rounded-full bg-background/70 backdrop-blur border border-white/20 text-white hover:bg-background/90"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div
            ref={scrollerRef}
            className="flex gap-1.5 sm:gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x [&::-webkit-scrollbar]:hidden"
            style={{ scrollbarWidth: "none" }}
          >
            {stripDays.map((d, idx) => {
              const key = ymd(d);
              const isToday = isSameDay(d, today);
              const isPast = d < today && !isToday;
              const workout = workoutByDate.get(key);
              const hasWorkout = !!workout;
              const isCompleted = hasWorkout && (completedDates?.has(key) ?? false);
              const showMonth = d.getDate() === 1 || idx === 0;

              const baseClasses = "shrink-0 snap-start flex flex-col items-center justify-between py-2 px-0.5 rounded-xl border transition-all w-12 sm:w-14 h-20 sm:h-24 text-center";
              let toneClasses: string;
              if (isCompleted) {
                toneClasses = "bg-emerald-500/30 border-emerald-400/60 text-white shadow-md shadow-emerald-500/20";
              } else if (hasWorkout && isToday) {
                toneClasses = "bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30";
              } else if (hasWorkout && !isPast) {
                toneClasses = "bg-primary/30 border-primary/60 text-white shadow-md shadow-primary/20";
              } else if (hasWorkout && isPast) {
                toneClasses = "bg-destructive/20 border-destructive/40 text-white/85";
              } else if (isToday) {
                toneClasses = "bg-white/20 border-white/40 text-white";
              } else if (isPast) {
                toneClasses = "bg-white/5 backdrop-blur-md text-white/60 border-white/10";
              } else {
                toneClasses = "bg-white/10 backdrop-blur-md text-white border-white/20";
              }
              const interactClasses = hasWorkout ? "cursor-pointer hover:scale-[1.05] active:scale-95" : "cursor-default";

              const inner = (
                <>
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-[10px] font-semibold uppercase tracking-wide opacity-90">
                      {format(d, "EEE")}
                    </span>
                    <span className="text-sm sm:text-base font-bold">{format(d, "d")}</span>
                    {showMonth && (
                      <span className="text-[9px] opacity-80">{format(d, "MMM")}</span>
                    )}
                  </div>
                  <div className="h-4 flex items-center justify-center">
                    {isCompleted ? (
                      <div className="w-4 h-4 rounded-full bg-emerald-400 flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-emerald-950" strokeWidth={3} />
                      </div>
                    ) : hasWorkout ? (
                      <span
                        aria-label={shortLabel(workout!)}
                        title={shortLabel(workout!)}
                        className="w-4 h-4 rounded-full bg-white/95 text-primary flex items-center justify-center text-[10px] font-extrabold shadow-sm"
                        style={{ fontFamily: "'Bebas Neue', sans-serif" }}
                      >
                        S
                      </span>
                    ) : null}
                  </div>
                </>
              );

              return hasWorkout ? (
                <button
                  type="button"
                  key={key}
                  ref={isToday ? focusRef : undefined}
                  onClick={() => setSelectedWorkout(workout!)}
                  className={`${baseClasses} ${toneClasses} ${interactClasses}`}
                >
                  {inner}
                </button>
              ) : (
                <div
                  key={key}
                  ref={isToday ? (focusRef as unknown as React.RefObject<HTMLDivElement>) : undefined}
                  className={`${baseClasses} ${toneClasses}`}
                >
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Workout detail dialog */}
      <Dialog open={!!selectedWorkout} onOpenChange={(o) => !o && setSelectedWorkout(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          {selectedWorkout && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Dumbbell className="w-5 h-5 text-primary" />
                  {shortLabel(selectedWorkout)}
                </DialogTitle>
                <DialogDescription>
                  {selectedWorkout.dateObj ? format(selectedWorkout.dateObj, "EEEE, d MMMM yyyy") : selectedWorkout.date}
                  {selectedWorkout.dateObj && completedDates?.has(ymd(selectedWorkout.dateObj)) && (
                    <span className="ml-2 inline-flex items-center gap-1 text-emerald-500 font-semibold">
                      <Check className="w-3 h-3" /> Completed
                    </span>
                  )}
                </DialogDescription>
              </DialogHeader>

              {selectedWorkout.segments.length > 0 ? (
                <div className="space-y-2 mt-2">
                  <WorkoutIntervalChart segments={expandedToSegments(expandWorkoutSteps(selectedWorkout.segments, selectedWorkout.title, selectedWorkout.rawText ?? "", { raceDistance: raceDistance ?? undefined }))} />

                  {selectedWorkout.segments.map((seg, i) => (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold">{seg.segment}</span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {seg.duration}
                        </span>
                      </div>
                      {seg.target && !/warm\s*-?\s*up|cool\s*-?\s*down|rest|recovery|walk/i.test(seg.segment) && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Target:</span> {seg.target}
                        </p>
                      )}
                      {seg.hrZone && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Activity className="w-3 h-3" /> {seg.hrZone}{hrZoneBpm(seg.hrZone) && ` (${hrZoneBpm(seg.hrZone)})`}
                        </p>
                      )}
                      {seg.notes && <p className="text-xs text-muted-foreground italic">{seg.notes}</p>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">
                  {selectedWorkout.rawText}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
