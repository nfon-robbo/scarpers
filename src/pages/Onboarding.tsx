import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useUnits, type UnitPreferences } from "@/hooks/useUnits";
import { Activity, ChevronRight, ChevronLeft, ChevronDown, Upload, Loader2 } from "lucide-react";
import GoogleFitConnect from "@/components/GoogleFitConnect";
import StravaConnect from "@/components/StravaConnect";
import { parseFitBuffer } from "@/lib/fit-parser";
import { cn } from "@/lib/utils";

const formatPace = (minPerKm: number): string => {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const STEPS = ["Welcome", "Units", "About You", "Experience & Goals", "Training Schedule", "Integrations"];
const STORAGE_KEY = "scarpers:onboarding-state";
const DAY_OPTIONS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const mapRaceDistance = (d: string): string => (d === "half" ? "half-marathon" : d);

const METRIC_UNITS: UnitPreferences = {
  distance: "km", speed: "min/km", elevation: "m", temperature: "C", weight: "kg", height: "cm",
};
const IMPERIAL_UNITS: UnitPreferences = {
  distance: "mi", speed: "min/mi", elevation: "ft", temperature: "F", weight: "lbs", height: "ft",
};

type UnitSystem = "metric" | "imperial" | "custom" | "";
type HasRace = "yes" | "no" | "";
type ExperienceLevel = "" | "beginner" | "intermediate" | "advanced" | "elite";

type OnboardingState = {
  step: number;
  name: string;
  sex: string;
  dob: string;
  heightCm: string;
  heightFt: string;
  heightIn: string;
  weightKg: string;
  weightLbs: string;
  weightSt: string;
  weightStLbs: string;
  experienceLevel: ExperienceLevel;
  trainingGoals: string;
  injuries: string;
  athleteContext: string;
  unitSystem: UnitSystem;
  hasRace: HasRace;
  raceDate: string;
  raceDistance: string;
  goalTimeMm: string;
  goalTimeSs: string;
  trainingDays: string[];
  currentPaceMin: string;
  currentPaceMax: string;
};

const loadState = (): Partial<OnboardingState> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const goalPlaceholder = (dist: string): { mm: string; ss: string } => {
  switch (dist) {
    case "5k": return { mm: "25", ss: "00" };
    case "10k": return { mm: "55", ss: "00" };
    case "half": return { mm: "120", ss: "00" };
    case "marathon": return { mm: "240", ss: "00" };
    default: return { mm: "mm", ss: "ss" };
  }
};

const Onboarding = () => {
  const { user, loading: authLoading } = useAuth();
  const initial = loadState();
  const [step, setStep] = useState<number>(initial.step ?? 0);
  const [name, setName] = useState(initial.name ?? "");
  const [sex, setSex] = useState<string>(initial.sex ?? "");
  const [dob, setDob] = useState(initial.dob ?? "");
  const [heightCm, setHeightCm] = useState(initial.heightCm ?? "");
  const [heightFt, setHeightFt] = useState(initial.heightFt ?? "");
  const [heightIn, setHeightIn] = useState(initial.heightIn ?? "");
  const [weightKg, setWeightKg] = useState(initial.weightKg ?? "");
  const [weightLbs, setWeightLbs] = useState(initial.weightLbs ?? "");
  const [weightSt, setWeightSt] = useState(initial.weightSt ?? "");
  const [weightStLbs, setWeightStLbs] = useState(initial.weightStLbs ?? "");
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel>(initial.experienceLevel ?? "");
  const [trainingGoals, setTrainingGoals] = useState(initial.trainingGoals ?? "");
  const [injuries, setInjuries] = useState(initial.injuries ?? "");
  const [athleteContext, setAthleteContext] = useState(initial.athleteContext ?? "");
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initial.unitSystem ?? "");
  const [hasRace, setHasRace] = useState<HasRace>(initial.hasRace ?? "");
  const [raceDate, setRaceDate] = useState(initial.raceDate ?? "");
  const [raceDistance, setRaceDistance] = useState(initial.raceDistance ?? "");
  const [goalTimeMm, setGoalTimeMm] = useState(initial.goalTimeMm ?? "");
  const [goalTimeSs, setGoalTimeSs] = useState(initial.goalTimeSs ?? "");
  const [trainingDays, setTrainingDays] = useState<string[]>(initial.trainingDays ?? ["Mon", "Wed", "Fri", "Sat"]);
  const [currentPaceMin, setCurrentPaceMin] = useState(initial.currentPaceMin ?? "");
  const [currentPaceMax, setCurrentPaceMax] = useState(initial.currentPaceMax ?? "");
  const [customOpen, setCustomOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { units, setUnit } = useUnits();

  useEffect(() => {
    const state: OnboardingState = {
      step, name, sex, dob,
      heightCm, heightFt, heightIn,
      weightKg, weightLbs, weightSt, weightStLbs,
      experienceLevel, trainingGoals, injuries, athleteContext,
      unitSystem, hasRace, raceDate, raceDistance, goalTimeMm, goalTimeSs,
      trainingDays, currentPaceMin, currentPaceMax,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [step, name, sex, dob, heightCm, heightFt, heightIn, weightKg, weightLbs, weightSt, weightStLbs, experienceLevel, trainingGoals, injuries, athleteContext, unitSystem, hasRace, raceDate, raceDistance, goalTimeMm, goalTimeSs, trainingDays, currentPaceMin, currentPaceMax]);

  const applyUnitSystem = (system: "metric" | "imperial") => {
    const target = system === "metric" ? METRIC_UNITS : IMPERIAL_UNITS;
    (Object.keys(target) as (keyof UnitPreferences)[]).forEach((k) => setUnit(k, target[k] as any));
    setUnitSystem(system);
  };

  const openCustom = () => {
    // If user dives straight into custom without picking metric/imperial, seed Metric so
    // selects are populated and canNext() passes.
    if (!unitSystem) applyUnitSystem("metric");
    setUnitSystem("custom");
    setCustomOpen(true);
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const contextParts: string[] = [];
      if (injuries.trim()) contextParts.push(`Injuries / niggles: ${injuries.trim()}`);
      if (athleteContext.trim()) contextParts.push(athleteContext.trim());

      // DOB fallback: if user skipped DOB, age defaults to 30 in src/components/RunningIQWidget.tsx
      // (ageYears = 30), which feeds max-HR & VO2 scoring. Encourage users to fill DOB for accuracy.
      const heightCmFinal = (() => {
        if (units.height === "ft") {
          const ft = Number(heightFt) || 0;
          const inches = Number(heightIn) || 0;
          const total = ft * 30.48 + inches * 2.54;
          return total > 0 ? Math.round(total) : null;
        }
        return heightCm ? Number(heightCm) : null;
      })();
      const weightKgFinal = (() => {
        if (units.weight === "lbs") {
          const lbs = Number(weightLbs) || 0;
          return lbs > 0 ? +(lbs / 2.20462).toFixed(2) : null;
        }
        if (units.weight === "st") {
          const st = Number(weightSt) || 0;
          const lbs = Number(weightStLbs) || 0;
          const totalLbs = st * 14 + lbs;
          return totalLbs > 0 ? +(totalLbs / 2.20462).toFixed(2) : null;
        }
        return weightKg ? Number(weightKg) : null;
      })();
      const raceGoalSeconds = hasRace === "yes" && goalTimeMm
        ? Number(goalTimeMm) * 60 + (Number(goalTimeSs) || 0)
        : null;

      const { error } = await supabase
        .from("profiles")
        .update({
          name,
          primary_sport: "running",
          experience_level: experienceLevel || "intermediate",
          training_goals: trainingGoals,
          athlete_context: contextParts.join("\n\n"),
          sex: sex || null,
          date_of_birth: dob || null,
          height_cm: heightCmFinal,
          weight_kg: weightKgFinal,
          race_date: hasRace === "yes" && raceDate ? raceDate : null,
          race_distance: hasRace === "yes" && raceDistance ? raceDistance : null,
          race_goal_time_seconds: raceGoalSeconds,
          onboarding_completed: true,
        } as any)
        .eq("user_id", user.id);

      if (error) throw error;
      try { localStorage.removeItem(STORAGE_KEY); } catch {}

      // If user has a race, jump straight into plan generation so onboarding
      // actually delivers a plan instead of dumping them on the dashboard.
      if (hasRace === "yes" && raceDistance && raceDate && trainingDays.length > 0) {
        navigate("/training-plan", {
          state: {
            autoGenerate: true,
            raceDistance: mapRaceDistance(raceDistance),
            raceDate,
            goalTime: goalTimeMm ? `${goalTimeMm}:${(goalTimeSs || "00").padStart(2, "0")}` : "",
            trainingDays,
            currentPaceMin,
            currentPaceMax,
          },
        });
      } else {
        navigate("/training-plan", {
          state: {
            autoGenerate: true,
            raceDistance: "half-marathon",
            letAIDecide: true,
            trainingDays,
            currentPaceMin,
            currentPaceMax,
          },
        });
      }
    } catch (error: any) {
      toast({
        title: "Error saving profile",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return unitSystem !== "";
    if (step === 3) {
      if (!experienceLevel) return false;
      if (hasRace === "") return false;
      if (hasRace === "yes" && (!raceDate || !raceDistance)) return false;
      return true;
    }
    if (step === 4) return trainingDays.length > 0;
    return true;
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;

  const expOptions: { value: ExperienceLevel; label: string; sub: string }[] = [
    { value: "beginner", label: "Beginner", sub: "New to running" },
    { value: "intermediate", label: "Intermediate", sub: "Run regularly" },
    { value: "advanced", label: "Advanced", sub: "Race competitively" },
    { value: "elite", label: "Elite", sub: "High-performance" },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Activity className="w-8 h-8 text-primary" />
            <span className="text-xl font-bold">Scarpers</span>
          </div>
          <CardTitle>Let's set up your profile</CardTitle>
          <CardDescription>Step {step + 1} of {STEPS.length} — {STEPS[step]}</CardDescription>
          <div className="flex gap-2 mt-4">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {step === 0 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" placeholder="e.g. Alex Johnson" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                <p className="text-xs text-muted-foreground">We use this to set your heart-rate zones.</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Pick how you want measurements shown across the app.</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { applyUnitSystem("metric"); setCustomOpen(false); }}
                  className={cn(
                    "rounded-xl border-2 p-4 text-left transition-all",
                    unitSystem === "metric" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  )}
                >
                  <div className="text-lg font-semibold">Metric</div>
                  <div className="text-xs text-muted-foreground mt-1">km · min/km · kg · °C</div>
                </button>
                <button
                  type="button"
                  onClick={() => { applyUnitSystem("imperial"); setCustomOpen(false); }}
                  className={cn(
                    "rounded-xl border-2 p-4 text-left transition-all",
                    unitSystem === "imperial" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  )}
                >
                  <div className="text-lg font-semibold">Imperial</div>
                  <div className="text-xs text-muted-foreground mt-1">mi · min/mi · lbs · °F</div>
                </button>
              </div>

              <Collapsible open={customOpen} onOpenChange={(o) => { if (o) openCustom(); else setCustomOpen(false); }}>
                <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                  <ChevronDown className={cn("w-4 h-4 transition-transform", customOpen && "rotate-180")} />
                  Customise units
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Distance</Label>
                      <Select value={units.distance} onValueChange={(v) => { setUnit("distance", v as any); setUnitSystem("custom"); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="km">Kilometres</SelectItem>
                          <SelectItem value="mi">Miles</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Pace / Speed</Label>
                      <Select value={units.speed} onValueChange={(v) => { setUnit("speed", v as any); setUnitSystem("custom"); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="min/km">min/km</SelectItem>
                          <SelectItem value="min/mi">min/mi</SelectItem>
                          <SelectItem value="km/h">km/h</SelectItem>
                          <SelectItem value="mph">mph</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Elevation</Label>
                      <Select value={units.elevation} onValueChange={(v) => { setUnit("elevation", v as any); setUnitSystem("custom"); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="m">Metres</SelectItem>
                          <SelectItem value="ft">Feet</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Temperature</Label>
                      <Select value={units.temperature} onValueChange={(v) => { setUnit("temperature", v as any); setUnitSystem("custom"); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="C">Celsius</SelectItem>
                          <SelectItem value="F">Fahrenheit</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Weight</Label>
                      <Select value={units.weight} onValueChange={(v) => { setUnit("weight", v as any); setUnitSystem("custom"); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kg">Kilograms</SelectItem>
                          <SelectItem value="lbs">Pounds</SelectItem>
                          <SelectItem value="st">Stone</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Height</Label>
                      <Select value={units.height} onValueChange={(v) => { setUnit("height", v as any); setUnitSystem("custom"); }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cm">Centimetres</SelectItem>
                          <SelectItem value="ft">Feet / inches</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">These power your race predictions and recovery scores.</p>
              <div className="space-y-2">
                <Label>Sex</Label>
                <Select value={sex} onValueChange={setSex}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                    <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Height</Label>
                {units.height === "ft" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" inputMode="numeric" placeholder="ft" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} />
                    <Input type="number" inputMode="numeric" placeholder="in" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} />
                  </div>
                ) : (
                  <Input type="number" inputMode="numeric" placeholder="175 cm" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
                )}
              </div>
              <div className="space-y-2">
                <Label>Weight</Label>
                {units.weight === "lbs" ? (
                  <Input type="number" inputMode="decimal" placeholder="lbs" value={weightLbs} onChange={(e) => setWeightLbs(e.target.value)} />
                ) : units.weight === "st" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" inputMode="numeric" placeholder="st" value={weightSt} onChange={(e) => setWeightSt(e.target.value)} />
                    <Input type="number" inputMode="numeric" placeholder="lbs" value={weightStLbs} onChange={(e) => setWeightStLbs(e.target.value)} />
                  </div>
                ) : (
                  <Input type="number" inputMode="decimal" placeholder="70 kg" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} />
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Running experience</Label>
                <div className="grid grid-cols-2 gap-2">
                  {expOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setExperienceLevel(opt.value)}
                      className={cn(
                        "rounded-xl border-2 p-3 text-left transition-all",
                        experienceLevel === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      )}
                    >
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{opt.sub}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Do you have a race coming up?</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setHasRace("yes")}
                    className={cn(
                      "rounded-xl border-2 p-3 font-semibold transition-all",
                      hasRace === "yes" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    )}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => { setHasRace("no"); setRaceDate(""); setRaceDistance(""); setGoalTimeMm(""); setGoalTimeSs(""); }}
                    className={cn(
                      "rounded-xl border-2 p-3 font-semibold transition-all",
                      hasRace === "no" ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    )}
                  >
                    Not yet
                  </button>
                </div>
              </div>

              {hasRace === "yes" && (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="space-y-2">
                    <Label htmlFor="raceDate">Race date</Label>
                    <Input id="raceDate" type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Distance</Label>
                    <Select value={raceDistance} onValueChange={setRaceDistance}>
                      <SelectTrigger><SelectValue placeholder="Select distance" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="5k">5K</SelectItem>
                        <SelectItem value="10k">10K</SelectItem>
                        <SelectItem value="half">Half Marathon</SelectItem>
                        <SelectItem value="marathon">Marathon</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Goal time (optional)</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Input type="number" inputMode="numeric" placeholder={goalPlaceholder(raceDistance).mm} value={goalTimeMm} onChange={(e) => setGoalTimeMm(e.target.value)} />
                      <Input type="number" inputMode="numeric" placeholder={goalPlaceholder(raceDistance).ss} value={goalTimeSs} onChange={(e) => setGoalTimeSs(e.target.value)} />
                    </div>
                    <p className="text-xs text-muted-foreground">Minutes : seconds</p>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="goals">Training goals (optional)</Label>
                <Input id="goals" placeholder="e.g. Build base, hit a PB, stay injury-free" value={trainingGoals} onChange={(e) => setTrainingGoals(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="injuries">Injuries or niggles</Label>
                <Textarea id="injuries" placeholder="Anything the AI coach should know — knee pain, plantar fasciitis, etc." value={injuries} onChange={(e) => setInjuries(e.target.value)} rows={2} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="context">Anything else?</Label>
                <Textarea id="context" placeholder="Schedule constraints, recent training history, preferences..." value={athleteContext} onChange={(e) => setAthleteContext(e.target.value)} rows={2} />
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <p className="text-sm text-muted-foreground">
                We'll use this to build your personalised plan. You can tweak it any time.
              </p>
              <div className="space-y-2">
                <Label>Which days can you train?</Label>
                <div className="grid grid-cols-7 gap-1.5">
                  {DAY_OPTIONS.map((d) => {
                    const active = trainingDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        onClick={() =>
                          setTrainingDays((prev) =>
                            prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]
                          )
                        }
                        className={cn(
                          "rounded-lg border-2 py-2 text-xs font-semibold transition-all",
                          active ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-primary/50"
                        )}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">{trainingDays.length} day(s) selected</p>
              </div>

              <div className="space-y-2">
                <Label>Current easy pace (optional)</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    placeholder="Fastest e.g. 5:30"
                    value={currentPaceMin}
                    onChange={(e) => setCurrentPaceMin(e.target.value)}
                  />
                  <Input
                    placeholder="Slowest e.g. 6:30"
                    value={currentPaceMax}
                    onChange={(e) => setCurrentPaceMax(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground">min/km — helps the AI pitch your plan correctly.</p>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your accounts to pull in runs and sleep data automatically. You can skip and add these later in Settings.
              </p>
              <GoogleFitConnect />
              <StravaConnect />
            </div>
          )}

          <div className="flex gap-3">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} className="flex-1" disabled={!canNext()}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={loading} className="flex-1">
                {loading ? "Saving..." : "Build my plan"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
