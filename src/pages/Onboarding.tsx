import { useState, useEffect, useRef } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useUnits, type UnitPreferences } from "@/hooks/useUnits";
import {
  Activity, ChevronRight, ChevronLeft, ChevronDown,
  Upload, Loader2, Calendar as CalendarIcon, Sparkles,
} from "lucide-react";

import StravaConnect from "@/components/StravaConnect";
import { parseFitBuffer, parseZipFile, type ParsedActivity } from "@/lib/fit-parser";
import { streamAICoach } from "@/lib/ai-stream";
import { cn } from "@/lib/utils";

const RACE_DISTANCES = [
  { value: "5k", label: "5K" },
  { value: "10k", label: "10K" },
  { value: "half-marathon", label: "Half Marathon" },
  { value: "marathon", label: "Marathon" },
];
const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const formatPace = (minPerKm: number): string => {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};
const toLocalISODate = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const nextMonday = () => {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  d.setDate(d.getDate() + diff);
  return d;
};

const STEPS = ["Welcome", "Units", "About You", "Experience & Goals", "Training Schedule", "Integrations"];
const STORAGE_KEY = "scarpers:onboarding-state";
const DAY_OPTIONS = DAYS_OF_WEEK;




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
  const [goalTimeFree, setGoalTimeFree] = useState<string>("");
  const [startDate, setStartDate] = useState<Date>(() => nextMonday());
  const [planRaceDate, setPlanRaceDate] = useState<Date | undefined>(undefined);
  const [letAIDecide, setLetAIDecide] = useState(false);
  const [planBuilding, setPlanBuilding] = useState(false);
  const [planContent, setPlanContent] = useState("");
  const [fitParsing, setFitParsing] = useState(false);
  const [fitSummary, setFitSummary] = useState<string | null>(null);
  const fitInputRef = useRef<HTMLInputElement>(null);


  const handleFitUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setFitParsing(true);
    setFitSummary(null);
    try {
      const paces: number[] = []; // min/km per activity
      let runCount = 0;

      const collect = (acts: ParsedActivity[]) => {
        for (const a of acts) {
          const isRun = (a.activity_type || "").toLowerCase().includes("run");
          if (!isRun) continue;
          if (a.distance_meters && a.duration_seconds && a.distance_meters > 800) {
            const pace = (a.duration_seconds / 60) / (a.distance_meters / 1000);
            if (pace > 3 && pace < 12) { paces.push(pace); runCount++; }
          } else if (a.avg_speed && a.avg_speed > 4 && a.avg_speed < 25) {
            paces.push(60 / a.avg_speed);
            runCount++;
          }
        }
      };

      for (const file of Array.from(files)) {
        try {
          if (/\.zip$/i.test(file.name)) {
            const result = await parseZipFile(file);
            collect(result.activities);
          } else if (/\.fit$/i.test(file.name)) {
            const buf = await file.arrayBuffer();
            const acts = await parseFitBuffer(buf, file.name);
            collect(acts);
          }
        } catch (e) {
          console.warn("Upload parse failed", file.name, e);
        }
      }
      if (paces.length === 0) {
        toast({ title: "No runs detected", description: "Couldn't find any running activities in those files.", variant: "destructive" });
        return;
      }
      paces.sort((a, b) => a - b);
      // 25th / 75th percentile for a sensible easy-pace range.
      const q = (p: number) => paces[Math.min(paces.length - 1, Math.floor(paces.length * p))];
      const fast = q(0.25);
      const slow = q(0.75);
      setCurrentPaceMin(formatPace(fast));
      setCurrentPaceMax(formatPace(slow));
      setFitSummary(`Analysed ${runCount} run(s) — easy pace ${formatPace(fast)}–${formatPace(slow)} min/km`);
      toast({ title: "Pace detected", description: `From ${runCount} run(s).` });
    } finally {
      setFitParsing(false);
      if (fitInputRef.current) fitInputRef.current.value = "";
    }
  };
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

  // Seed plan-builder fields from earlier steps the first time we enter step 4.
  useEffect(() => {
    if (step !== 4) return;
    if (!goalTimeFree && goalTimeMm) {
      setGoalTimeFree(`${goalTimeMm}:${(goalTimeSs || "00").padStart(2, "0")}`);
    }
    if (!planRaceDate && hasRace === "yes" && raceDate) {
      try { setPlanRaceDate(new Date(raceDate)); } catch {}
    }
    if (!raceDistance && hasRace !== "yes") {
      setRaceDistance("half-marathon");
    } else if (raceDistance === "half") {
      setRaceDistance("half-marathon");
    } else if (raceDistance === "other") {
      setRaceDistance("half-marathon");
    }
    if (hasRace !== "yes" && !letAIDecide && !planRaceDate) {
      setLetAIDecide(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);


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

  const saveProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const contextParts: string[] = [];
    if (injuries.trim()) contextParts.push(`Injuries / niggles: ${injuries.trim()}`);
    if (athleteContext.trim()) contextParts.push(athleteContext.trim());

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
        race_distance: hasRace === "yes" && raceDistance ? mapRaceDistance(raceDistance) : null,
        race_goal_time_seconds: raceGoalSeconds,
        onboarding_completed: true,
      } as any)
      .eq("user_id", user.id);

    if (error) throw error;
    return user.id;
  };

  const handleComplete = async () => {
    if (planBuilding) return;
    if (trainingDays.length === 0) {
      toast({ title: "Pick at least one training day", variant: "destructive" });
      return;
    }
    if (!letAIDecide && !planRaceDate) {
      toast({ title: "Pick a race date", description: "Or let the AI recommend one.", variant: "destructive" });
      return;
    }

    setLoading(true);
    setPlanBuilding(true);
    setPlanContent("");

    try {
      const userId = await saveProfile();
      try { localStorage.removeItem(STORAGE_KEY); } catch {}

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Session expired — please sign in again.");

      const effectiveRaceDistance = raceDistance && raceDistance !== "" && raceDistance !== "other"
        ? mapRaceDistance(raceDistance)
        : "half-marathon";

      await new Promise<void>((resolve, reject) => {
        let accumulated = "";
        streamAICoach({
          type: "training-plan",
          token: session.access_token,
          raceDistance: effectiveRaceDistance,
          goalTime: goalTimeFree || "",
          currentPaceMin,
          currentPaceMax,
          trainingDays,
          startDate: toLocalISODate(startDate),
          raceDate: letAIDecide ? "ai-recommend" : (planRaceDate ? toLocalISODate(planRaceDate) : undefined),
          onDelta: (text) => {
            accumulated += text;
            setPlanContent(accumulated);
          },
          onDone: async () => {
            try {
              const { error: insertErr } = await supabase.from("training_plans").insert({
                user_id: userId,
                race_distance: effectiveRaceDistance,
                goal_time: goalTimeFree || null,
                training_days: trainingDays,
                start_date: toLocalISODate(startDate),
                race_date: letAIDecide ? "ai-recommend" : (planRaceDate ? toLocalISODate(planRaceDate) : null),
                content: accumulated,
              } as any);
              if (insertErr) throw insertErr;
              resolve();
            } catch (e) { reject(e); }
          },
          onError: (err) => reject(new Error(err)),
        });
      });

      toast({ title: "Plan ready!", description: "Welcome to Scarpers." });
      navigate("/training-plan");
    } catch (error: any) {
      toast({
        title: "Couldn't finish setup",
        description: error.message,
        variant: "destructive",
      });
      setPlanBuilding(false);
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
                Same builder you'll see in-app. Pick your race, your days, and we'll generate your plan when you finish.
              </p>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Race Distance</Label>
                <div className="flex flex-wrap gap-2">
                  {RACE_DISTANCES.map((d) => (
                    <Button
                      key={d.value}
                      variant={raceDistance === d.value || (d.value === "half-marathon" && raceDistance === "half") ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRaceDistance(d.value)}
                    >
                      {d.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Goal Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="text"
                  placeholder="e.g. 30:00 or 1:45:00"
                  value={goalTimeFree}
                  onChange={(e) => setGoalTimeFree(e.target.value)}
                  className="max-w-[220px]"
                />
                <p className="text-xs text-muted-foreground">
                  Target finish time — the AI will build pace targets around hitting this.
                </p>
              </div>

              <div className="space-y-2 rounded-lg border border-border/50 p-4 bg-muted/20">
                <Label className="text-sm font-medium">Current Easy Run Pace <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground">
                  If you know your current easy/Z2 pace, enter the range (min:sec per km). The plan will start here and progress toward your goal.
                </p>
                <div className="flex items-center gap-2 max-w-[360px]">
                  <Input
                    type="text"
                    placeholder="e.g. 7:00"
                    value={currentPaceMin}
                    onChange={(e) => setCurrentPaceMin(e.target.value)}
                    className="text-center"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="text"
                    placeholder="e.g. 7:30"
                    value={currentPaceMax}
                    onChange={(e) => setCurrentPaceMax(e.target.value)}
                    className="text-center"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/km</span>
                </div>
                <div className="pt-2">
                  <input
                    ref={fitInputRef}
                    type="file"
                    accept=".fit,.zip"
                    multiple
                    className="hidden"
                    onChange={(e) => handleFitUpload(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fitInputRef.current?.click()}
                    disabled={fitParsing}
                    className="w-full h-auto whitespace-normal text-center py-2"
                  >
                    {fitParsing ? (
                      <><Loader2 className="w-4 h-4 mr-2 shrink-0 animate-spin" /> Reading…</>
                    ) : (
                      <><Upload className="w-4 h-4 mr-2 shrink-0" /> <span className="break-words">Upload .FIT / Garmin ZIP to auto-detect</span></>
                    )}
                  </Button>
                  {fitSummary && (
                    <p className="text-xs text-primary font-medium mt-2">{fitSummary}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Training Days</Label>
                <div className="flex flex-wrap gap-2">
                  {DAYS_OF_WEEK.map((day) => (
                    <Button
                      key={day}
                      variant={trainingDays.includes(day) ? "default" : "outline"}
                      size="sm"
                      onClick={() =>
                        setTrainingDays((prev) =>
                          prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day]
                        )
                      }
                      className="w-12"
                    >
                      {day}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {trainingDays.length} days selected — rest days will be scheduled on the others
                </p>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start text-left font-normal">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(startDate, "dd/MM/yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={startDate}
                        onSelect={(d) => d && setStartDate(d)}
                        initialFocus
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Race Date</Label>
                  {!letAIDecide && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !planRaceDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {planRaceDate ? format(planRaceDate, "dd/MM/yyyy") : "Pick a race date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={planRaceDate}
                          onSelect={setPlanRaceDate}
                          disabled={(date) => date < startDate}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Checkbox
                      id="ai-decide"
                      checked={letAIDecide}
                      onCheckedChange={(v) => {
                        setLetAIDecide(!!v);
                        if (v) setPlanRaceDate(undefined);
                      }}
                    />
                    <Label htmlFor="ai-decide" className="text-sm cursor-pointer text-muted-foreground">
                      Let the AI recommend a race date
                    </Label>
                  </div>
                </div>
              </div>
            </div>
          )}


          {step === 5 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Connect your accounts to pull in runs and sleep data automatically. You can skip and add these later in Settings.
              </p>
              
              <StravaConnect />
            </div>
          )}

          {planBuilding && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Sparkles className="w-4 h-4 animate-pulse" />
                Building your personalised plan…
              </div>
              {planContent && (
                <pre className="text-[11px] leading-relaxed text-muted-foreground max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
                  {planContent.slice(-1200)}
                </pre>
              )}
            </div>
          )}

          <div className="flex gap-3">
            {step > 0 && !planBuilding && (
              <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} className="flex-1" disabled={!canNext()}>
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={loading || planBuilding} className="flex-1">
                {planBuilding ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating…</>
                ) : loading ? "Saving…" : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Build my plan</>
                )}
              </Button>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
