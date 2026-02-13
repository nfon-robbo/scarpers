import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, RotateCcw, Target, Layers, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const RACE_DISTANCES = [
  { value: "5k", label: "5K" },
  { value: "10k", label: "10K" },
  { value: "half-marathon", label: "Half Marathon" },
  { value: "marathon", label: "Marathon" },
] as const;

const DAYS_OF_WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const TrainingPlanPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);
  const [raceDistance, setRaceDistance] = useState<string>("half-marathon");
  const [trainingDays, setTrainingDays] = useState<string[]>(["Mon", "Wed", "Fri", "Sat"]);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    // Default to next Monday
    const day = d.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split("T")[0];
  });

  const toggleDay = (day: string) => {
    setTrainingDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const generatePlan = async () => {
    if (!user) return;
    if (trainingDays.length === 0) {
      toast({ title: "Select training days", description: "Pick at least one day to work out.", variant: "destructive" });
      return;
    }
    setLoading(true);
    setContent("");
    setHasRun(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setLoading(false);
      return;
    }

    let accumulated = "";
    streamAICoach({
      type: "training-plan",
      token: session.access_token,
      raceDistance,
      trainingDays,
      startDate,
      onDelta: (text) => {
        accumulated += text;
        setContent(accumulated);
      },
      onDone: () => setLoading(false),
      onError: (err) => {
        toast({ title: "Plan generation failed", description: err, variant: "destructive" });
        setLoading(false);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="w-8 h-8 text-primary" />
            Training Plan
          </h1>
          <p className="text-muted-foreground mt-1">
            Season strategy + detailed 4-week periodized plan
          </p>
        </div>
        <Button onClick={generatePlan} disabled={loading} size="lg">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : hasRun ? (
            <>
              <RotateCcw className="w-4 h-4 mr-2" />
              Regenerate
            </>
          ) : (
            <>
              <Calendar className="w-4 h-4 mr-2" />
              Generate Plan
            </>
          )}
        </Button>
      </div>

      {!hasRun && !loading && (
        <>
          <Card>
            <CardContent className="p-5 space-y-5">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Race Distance</Label>
                <div className="flex flex-wrap gap-2">
                  {RACE_DISTANCES.map((d) => (
                    <Button
                      key={d.value}
                      variant={raceDistance === d.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => setRaceDistance(d.value)}
                    >
                      {d.label}
                    </Button>
                  ))}
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
                      onClick={() => toggleDay(day)}
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

              <div className="space-y-2">
                <Label htmlFor="start-date" className="text-sm font-medium">Start Date</Label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-fit"
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3">
            <FeatureCard icon={Target} title="Season Strategy" desc="12-24 week macro-cycle with race anchors and phase architecture" />
            <FeatureCard icon={Layers} title="4-Week Block" desc="28-day detailed plan with daily workouts, zones, and targets" />
            <FeatureCard icon={Clock} title="Periodization" desc="Build weeks + recovery week with progressive overload" />
          </div>
        </>
      )}

      {(content || loading) && (
        <Card>
          <CardContent className="p-6">
            {content ? (
              <MarkdownRenderer content={content} />
            ) : (
              <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Generating your personalized training plan...</span>
              </div>
            )}
            {loading && content && (
              <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Still generating...</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const FeatureCard = ({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) => (
  <Card className="border-dashed">
    <CardHeader className="p-4">
      <div className="rounded-lg bg-primary/10 p-2 w-fit mb-2">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <CardTitle className="text-sm">{title}</CardTitle>
      <CardDescription className="text-xs">{desc}</CardDescription>
    </CardHeader>
  </Card>
);

export default TrainingPlanPage;
