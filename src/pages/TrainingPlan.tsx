import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Loader2, RotateCcw, Target, Layers, Clock, CalendarIcon } from "lucide-react";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
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
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : 8 - day;
    d.setDate(d.getDate() + diff);
    return d;
  });
  const [raceDate, setRaceDate] = useState<Date | undefined>(undefined);
  const [letAIDecide, setLetAIDecide] = useState(false);

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
    if (!letAIDecide && !raceDate) {
      toast({ title: "Set a race date", description: "Pick a race date or let the AI recommend one.", variant: "destructive" });
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
      startDate: startDate.toISOString().split("T")[0],
      raceDate: letAIDecide ? "ai-recommend" : raceDate?.toISOString().split("T")[0],
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

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Start Date</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal")}>
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
                        className={cn("p-3 pointer-events-auto")}
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
                            !raceDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {raceDate ? format(raceDate, "dd/MM/yyyy") : "Pick a race date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <CalendarComponent
                          mode="single"
                          selected={raceDate}
                          onSelect={setRaceDate}
                          disabled={(date) => date < startDate}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
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
                        if (v) setRaceDate(undefined);
                      }}
                    />
                    <Label htmlFor="ai-decide" className="text-sm cursor-pointer text-muted-foreground">
                      Let the AI recommend a race date based on my fitness
                    </Label>
                  </div>
                </div>
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
