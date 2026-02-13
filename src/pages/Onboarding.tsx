import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Activity, ChevronRight, ChevronLeft } from "lucide-react";

const STEPS = ["About You", "Your Sport", "Goals & Context"];

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [primarySport, setPrimarySport] = useState("running");
  const [experienceLevel, setExperienceLevel] = useState("intermediate");
  const [trainingGoals, setTrainingGoals] = useState("");
  const [athleteContext, setAthleteContext] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleComplete = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("profiles")
        .update({
          name,
          primary_sport: primarySport,
          experience_level: experienceLevel,
          training_goals: trainingGoals,
          athlete_context: athleteContext,
          onboarding_completed: true,
        })
        .eq("user_id", user.id);

      if (error) throw error;
      navigate("/");
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

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Activity className="w-8 h-8 text-primary" />
            <span className="text-xl font-bold">Garmin AI Coach</span>
          </div>
          <CardTitle>Let's set up your profile</CardTitle>
          <CardDescription>Step {step + 1} of {STEPS.length} — {STEPS[step]}</CardDescription>
          {/* Progress bar */}
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
                <Input
                  id="name"
                  placeholder="e.g. Alex Johnson"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Primary sport</Label>
                <Select value={primarySport} onValueChange={setPrimarySport}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="cycling">Cycling</SelectItem>
                    <SelectItem value="triathlon">Triathlon</SelectItem>
                    <SelectItem value="swimming">Swimming</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Experience level</Label>
                <Select value={experienceLevel} onValueChange={setExperienceLevel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="beginner">Beginner</SelectItem>
                    <SelectItem value="intermediate">Intermediate</SelectItem>
                    <SelectItem value="advanced">Advanced</SelectItem>
                    <SelectItem value="elite">Elite</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="goals">Training goals</Label>
                <Input
                  id="goals"
                  placeholder="e.g. Sub-3hr marathon, complete first Ironman"
                  value={trainingGoals}
                  onChange={(e) => setTrainingGoals(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="context">Athlete context</Label>
                <Textarea
                  id="context"
                  placeholder="Anything the AI coach should know — injuries, schedule constraints, recent training history..."
                  value={athleteContext}
                  onChange={(e) => setAthleteContext(e.target.value)}
                  rows={4}
                />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-1">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep(step + 1)} className="flex-1">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={loading} className="flex-1">
                {loading ? "Saving..." : "Complete Setup"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Onboarding;
