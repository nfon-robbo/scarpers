import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useUnits } from "@/hooks/useUnits";
import { Activity, ChevronRight, ChevronLeft } from "lucide-react";
import GoogleFitConnect from "@/components/GoogleFitConnect";
import StravaConnect from "@/components/StravaConnect";

const STEPS = ["Welcome", "Units", "About You", "Experience & Goals", "Integrations"];

const STORAGE_KEY = "scarpers:onboarding-state";

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
  experienceLevel: string;
  trainingGoals: string;
  injuries: string;
  athleteContext: string;
};

const loadState = (): Partial<OnboardingState> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const Onboarding = () => {
  const initial = loadState();
  const [step, setStep] = useState<number>(initial.step ?? 0);
  // About you
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
  // Experience & goals
  const [experienceLevel, setExperienceLevel] = useState(initial.experienceLevel ?? "intermediate");
  const [trainingGoals, setTrainingGoals] = useState(initial.trainingGoals ?? "");
  const [injuries, setInjuries] = useState(initial.injuries ?? "");
  const [athleteContext, setAthleteContext] = useState(initial.athleteContext ?? "");

  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { units, setUnit } = useUnits();

  // Persist onboarding state so OAuth redirects (Google Fit / Strava) don't reset progress
  useEffect(() => {
    const state: OnboardingState = {
      step, name, sex, dob,
      heightCm, heightFt, heightIn,
      weightKg, weightLbs, weightSt, weightStLbs,
      experienceLevel, trainingGoals, injuries, athleteContext,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }, [step, name, sex, dob, heightCm, heightFt, heightIn, weightKg, weightLbs, weightSt, weightStLbs, experienceLevel, trainingGoals, injuries, athleteContext]);


  const handleComplete = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const contextParts: string[] = [];
      if (injuries.trim()) contextParts.push(`Injuries / niggles: ${injuries.trim()}`);
      if (athleteContext.trim()) contextParts.push(athleteContext.trim());

      const { error } = await supabase
        .from("profiles")
        .update({
          name,
          primary_sport: "running",
          experience_level: experienceLevel,
          training_goals: trainingGoals,
          athlete_context: contextParts.join("\n\n"),
          sex: sex || null,
          date_of_birth: dob || null,
          height_cm: (() => {
            if (units.height === "ft") {
              const ft = Number(heightFt) || 0;
              const inches = Number(heightIn) || 0;
              const total = ft * 30.48 + inches * 2.54;
              return total > 0 ? Math.round(total) : null;
            }
            return heightCm ? Number(heightCm) : null;
          })(),
          weight_kg: (() => {
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
          })(),
          onboarding_completed: true,
        })
        .eq("user_id", user.id);

      if (error) throw error;
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      navigate("/dashboard");
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
    return true;
  };

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
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">Choose how you want measurements displayed throughout the app.</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Distance</Label>
                  <Select value={units.distance} onValueChange={(v) => setUnit("distance", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="km">Kilometres</SelectItem>
                      <SelectItem value="mi">Miles</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pace / Speed</Label>
                  <Select value={units.speed} onValueChange={(v) => setUnit("speed", v as any)}>
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
                  <Select value={units.elevation} onValueChange={(v) => setUnit("elevation", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="m">Metres</SelectItem>
                      <SelectItem value="ft">Feet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Temperature</Label>
                  <Select value={units.temperature} onValueChange={(v) => setUnit("temperature", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="C">Celsius</SelectItem>
                      <SelectItem value="F">Fahrenheit</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Weight</Label>
                  <Select value={units.weight} onValueChange={(v) => setUnit("weight", v as any)}>
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
                  <Select value={units.height} onValueChange={(v) => setUnit("height", v as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cm">Centimetres</SelectItem>
                      <SelectItem value="ft">Feet / inches</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
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
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Running experience</Label>
                <Select value={experienceLevel} onValueChange={setExperienceLevel}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner — new to running</SelectItem>
                    <SelectItem value="intermediate">Intermediate — run regularly</SelectItem>
                    <SelectItem value="advanced">Advanced — race competitively</SelectItem>
                    <SelectItem value="elite">Elite — high-performance athlete</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="goals">Training goals</Label>
                <Input id="goals" placeholder="e.g. Sub-3hr marathon, run a 10K" value={trainingGoals} onChange={(e) => setTrainingGoals(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="injuries">Injuries or niggles</Label>
                <Textarea id="injuries" placeholder="Any current or recurring injuries the AI coach should know about — knee pain, plantar fasciitis, etc." value={injuries} onChange={(e) => setInjuries(e.target.value)} rows={3} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="context">Anything else?</Label>
                <Textarea id="context" placeholder="Schedule constraints, recent training history, preferences..." value={athleteContext} onChange={(e) => setAthleteContext(e.target.value)} rows={3} />
              </div>
            </div>
          )}

          {step === 4 && (
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
                {loading ? "Saving..." : "Go to Dashboard"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
