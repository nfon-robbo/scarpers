import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Loader2, RotateCcw, Target, Layers, Clock, CalendarIcon, Trash2, Download, FileDown, Watch, ChevronDown, ChevronUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { parseWorkoutsFromPlan, generateWorkoutZip, generateIcsCalendar, downloadBlob, downloadText } from "@/lib/plan-export";

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
  const [initialLoading, setInitialLoading] = useState(true);
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
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

  // Load existing plan on mount
  const loadSavedPlan = useCallback(async () => {
    if (!user) { setInitialLoading(false); return; }
    try {
      const { data } = await supabase
        .from("training_plans")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setContent(data.content);
        setSavedPlanId(data.id);
        setRaceDistance(data.race_distance);
        setTrainingDays(data.training_days);
        setStartDate(new Date(data.start_date));
        if (data.race_date && data.race_date !== "ai-recommend") {
          setRaceDate(new Date(data.race_date));
        } else if (data.race_date === "ai-recommend") {
          setLetAIDecide(true);
        }
      }
    } catch (e) {
      console.error("Failed to load plan:", e);
    } finally {
      setInitialLoading(false);
    }
  }, [user]);

  useEffect(() => { loadSavedPlan(); }, [loadSavedPlan]);

  const savePlan = async (planContent: string) => {
    if (!user) return;
    const raceDateValue = letAIDecide ? "ai-recommend" : raceDate?.toISOString().split("T")[0] || null;

    // Delete old plan, insert new one
    if (savedPlanId) {
      await supabase.from("training_plans").delete().eq("id", savedPlanId);
    }

    const { data, error } = await supabase
      .from("training_plans")
      .insert({
        user_id: user.id,
        race_distance: raceDistance,
        training_days: trainingDays,
        start_date: startDate.toISOString().split("T")[0],
        race_date: raceDateValue,
        content: planContent,
      })
      .select("id")
      .single();

    if (!error && data) {
      setSavedPlanId(data.id);
    }
  };

  const deletePlan = async () => {
    if (!savedPlanId) return;
    await supabase.from("training_plans").delete().eq("id", savedPlanId);
    setSavedPlanId(null);
    setContent("");
    toast({ title: "Plan deleted" });
  };

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
      onDone: () => {
        setLoading(false);
        savePlan(accumulated);
        toast({ title: "Plan saved", description: "Your training plan has been saved." });
      },
      onError: (err) => {
        toast({ title: "Plan generation failed", description: err, variant: "destructive" });
        setLoading(false);
      },
    });
  };

  const [showSyncInstructions, setShowSyncInstructions] = useState(false);

  const handleExportFit = async () => {
    const workouts = parseWorkoutsFromPlan(content);
    if (workouts.length === 0 || workouts.every(w => w.segments.length === 0)) {
      toast({ title: "No structured workouts found", description: "The plan needs workout tables with Segment/Duration/HR Zone columns.", variant: "destructive" });
      return;
    }
    const blob = await generateWorkoutZip(workouts);
    downloadBlob(blob, "training-plan-workouts.zip");
    toast({ title: "Downloaded!", description: `${workouts.filter(w => w.segments.length > 0).length} workout files exported.` });
  };

  const handleExportIcs = () => {
    const workouts = parseWorkoutsFromPlan(content);
    if (workouts.length === 0) {
      toast({ title: "No workouts found", variant: "destructive" });
      return;
    }
    const ics = generateIcsCalendar(workouts);
    downloadText(ics, "training-plan.ics", "text/calendar");
    toast({ title: "Calendar downloaded!" });
  };

  const showConfig = !content && !loading;

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
        <div className="flex gap-2">
          {content && !loading && (
            <>
              <Button variant="outline" size="sm" onClick={handleExportFit}>
                <Download className="w-4 h-4 mr-2" />
                Export for TrainingPeaks (.tcx)
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportIcs}>
                <FileDown className="w-4 h-4 mr-2" />
                Calendar (.ics)
              </Button>
              <Button variant="outline" size="sm" onClick={deletePlan}>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => { setContent(""); setSavedPlanId(null); }}>
                <RotateCcw className="w-4 h-4 mr-2" />
                New Plan
              </Button>
            </>
          )}
          {(showConfig || loading) && (
            <Button onClick={generatePlan} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Calendar className="w-4 h-4 mr-2" />
                  Generate Plan
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {showConfig && (
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

      {(content || loading) && (<>
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

        <Card className="border-dashed">
          <CardHeader className="p-4 cursor-pointer" onClick={() => setShowSyncInstructions(!showSyncInstructions)}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Watch className="w-5 h-5 text-primary" />
                <CardTitle className="text-sm">How to sync workouts to your watch</CardTitle>
              </div>
              {showSyncInstructions ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </div>
          </CardHeader>
          {showSyncInstructions && (
            <CardContent className="pt-0 px-4 pb-4">
              <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                <li>Click <strong className="text-foreground">Export for TrainingPeaks (.tcx)</strong> above to download a ZIP of .TCX workout files</li>
                <li>Open <a href="https://www.trainingpeaks.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">TrainingPeaks</a> and import the .TCX files into your calendar</li>
                <li>Open the <strong className="text-foreground">Zepp app</strong> on your phone</li>
                <li>Go to <strong className="text-foreground">Profile → 3rd-Party Account Linking → TrainingPeaks</strong></li>
                <li>Connect your TrainingPeaks account — workouts will automatically sync to your Amazfit watch</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-3">Each workout's segments (warm-up, intervals, cool-down) with HR zone targets will appear as executable structured workouts on your watch.</p>
            </CardContent>
          )}
        </Card>
      </>)}
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
