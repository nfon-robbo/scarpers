import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Calendar, Loader2, RotateCcw, Target, Layers, Clock, CalendarIcon, Trash2, Upload, RefreshCw, FileDown, Watch, ChevronDown, ChevronUp, ClipboardCheck, MoreVertical, ThumbsDown, ThumbsUp, Check, X, Sun } from "lucide-react";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import PlanCalendarView from "@/components/PlanCalendarView";
import { parseWorkoutsFromPlan, ParsedSegment, generateIcsCalendar, downloadText } from "@/lib/plan-export";

interface ApiStep {
  duration: number;
  hrLow: number;
  hrHigh: number;
  intensity: string;
}

function parseDurationSeconds(duration: string): number {
  const hourMatch = duration.match(/([\d.]+)\s*h(?:r|our)?s?\b/i);
  const minMatch = duration.match(/(\d+)\s*m(?:in(?:ute)?s?)?\b/i);
  const secMatch = duration.match(/(\d+)\s*s(?:ec(?:ond)?s?)?\b/i);
  let total = 0;
  if (hourMatch) total += parseFloat(hourMatch[1]) * 3600;
  if (minMatch) total += parseInt(minMatch[1], 10) * 60;
  if (secMatch) total += parseInt(secMatch[1], 10);
  if (total === 0) {
    const kmMatch = duration.match(/([\d.]+)\s*km/i);
    if (kmMatch) total = Math.round(parseFloat(kmMatch[1]) * 360);
  }
  return total || 600;
}

function hrZoneToBpm(hrZone: string): { low: number; high: number } {
  const match = hrZone.match(/Z(\d)/i);
  if (!match) return { low: 100, high: 140 };
  const zone = parseInt(match[1], 10);
  switch (zone) {
    case 1: return { low: 100, high: 120 };
    case 2: return { low: 120, high: 140 };
    case 3: return { low: 140, high: 160 };
    case 4: return { low: 160, high: 175 };
    case 5: return { low: 175, high: 200 };
    default: return { low: 100, high: 140 };
  }
}

/**
 * Expand a segment into API steps.
 * Handles repeat patterns like "5 x 2 min run / 1 min walk"
 */
function expandSegmentToSteps(seg: ParsedSegment): ApiStep[] {
  const { low, high } = hrZoneToBpm(seg.hrZone);

  // Determine step type from segment name
  const segName = seg.segment.toLowerCase();
  let stepType = "Active";
  if (/warm/i.test(segName)) stepType = "Warmup";
  else if (/cool/i.test(segName)) stepType = "Cooldown";
  else if (/rest/i.test(segName)) stepType = "Rest";
  else if (/recover/i.test(segName)) stepType = "Recovery";

  // Normalize duration: strip parentheses and extra text like "Run", "Walk" etc.
  const cleanDuration = seg.duration.replace(/[()]/g, "").trim();

  // Check for repeat/interval pattern: "10 x 1m Run / 1m Walk", "5 x 2 min / 1 min", etc.
  const repeatMatch = cleanDuration.match(/(\d+)\s*x\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b[^/]*?)\s*\/\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b.*)/i);
  if (repeatMatch) {
    const reps = parseInt(repeatMatch[1], 10);
    const workDuration = parseDurationSeconds(repeatMatch[2]);
    const restDuration = parseDurationSeconds(repeatMatch[3]);
    const restHr = hrZoneToBpm(`Z${Math.max(1, (parseInt(seg.hrZone.match(/Z(\d)/i)?.[1] || "2", 10)) - 1)}`);
    
    const steps: ApiStep[] = [];
    for (let i = 0; i < reps; i++) {
      steps.push({ duration: workDuration, hrLow: low, hrHigh: high, intensity: "Interval" });
      steps.push({ duration: restDuration, hrLow: restHr.low, hrHigh: restHr.high, intensity: "Recovery" });
    }
    return steps;
  }

  // Also check for "5 x 2 min" without rest component
  const simpleRepeatMatch = cleanDuration.match(/(\d+)\s*x\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b)/i);
  if (simpleRepeatMatch) {
    const reps = parseInt(simpleRepeatMatch[1], 10);
    const workDuration = parseDurationSeconds(simpleRepeatMatch[2]);
    const restMatch = seg.target?.match(/([\d.]+)\s*(?:min|sec)/i);
    const restDuration = restMatch ? parseDurationSeconds(restMatch[0]) : 60;
    const restHr = hrZoneToBpm("Z1");
    
    const steps: ApiStep[] = [];
    for (let i = 0; i < reps; i++) {
      steps.push({ duration: workDuration, hrLow: low, hrHigh: high, intensity: "Interval" });
      if (i < reps - 1 || restMatch) {
        steps.push({ duration: restDuration, hrLow: restHr.low, hrHigh: restHr.high, intensity: "Recovery" });
      }
    }
    return steps;
  }

  // Simple single step
  const duration = parseDurationSeconds(seg.duration);
  return [{ duration, hrLow: low, hrHigh: high, intensity: stepType }];
}

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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showNewPlanDialog, setShowNewPlanDialog] = useState(false);

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

  const [reviewing, setReviewing] = useState(false);
  const [reviewResult, setReviewResult] = useState<string | null>(null);
  const [originalPlanBeforeReview, setOriginalPlanBeforeReview] = useState<string | null>(null);
  const [dayAdjustResult, setDayAdjustResult] = useState<string | null>(null);
  const [dayAdjusting, setDayAdjusting] = useState(false);

  const reviewProgress = async () => {
    if (!user || !content) return;
    setReviewing(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setReviewing(false);
      return;
    }

    // Store original plan for reference
    const originalPlan = content;
    setOriginalPlanBeforeReview(originalPlan);
    setContent("");
    setLoading(true);

    let accumulated = "";
    streamAICoach({
      type: "plan-review",
      token: session.access_token,
      raceDistance,
      trainingDays,
      startDate: startDate.toISOString().split("T")[0],
      currentPlan: originalPlan,
      onDelta: (text) => {
        accumulated += text;
        setContent(accumulated);
      },
      onDone: () => {
        setLoading(false);
        setReviewing(false);
        setReviewResult(accumulated);
        // Don't auto-save — let user decide
      },
      onError: (err) => {
        toast({ title: "Review failed", description: err, variant: "destructive" });
        setContent(originalPlan); // Restore original on failure
        setOriginalPlanBeforeReview(null);
        setLoading(false);
        setReviewing(false);
      },
    });
  };

  const applyAdjustment = async (adjustment: "apply" | "easier" | "harder") => {
    if (!user || !reviewResult || !originalPlanBeforeReview) return;
    
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", variant: "destructive" });
      return;
    }

    setLoading(true);
    setContent("");

    let accumulated = "";
    streamAICoach({
      type: "plan-adjust",
      token: session.access_token,
      raceDistance,
      trainingDays,
      startDate: startDate.toISOString().split("T")[0],
      currentPlan: originalPlanBeforeReview,
      adjustment,
      reviewText: reviewResult,
      onDelta: (text) => {
        accumulated += text;
        setContent(accumulated);
      },
      onDone: () => {
        setLoading(false);
        setReviewResult(null);
        setOriginalPlanBeforeReview(null);
        savePlan(accumulated);
        toast({ title: "Plan updated", description: "Your adjusted training plan has been saved." });
      },
      onError: (err) => {
        toast({ title: "Adjustment failed", description: err, variant: "destructive" });
        setContent(originalPlanBeforeReview);
        setLoading(false);
      },
    });
  };

  const keepCurrentPlan = () => {
    if (originalPlanBeforeReview) {
      setContent(originalPlanBeforeReview);
    }
    setReviewResult(null);
    setOriginalPlanBeforeReview(null);
    toast({ title: "Keeping current plan" });
  };

  const extractTodayWorkout = (): string | null => {
    if (!content) return null;
    const today = new Date();
    const workouts = parseWorkoutsFromPlan(content);
    const todayStr = format(today, "yyyy-MM-dd");
    const todayWorkout = workouts.find(w => {
      if (!w.dateObj) return false;
      return format(w.dateObj, "yyyy-MM-dd") === todayStr;
    });
    if (!todayWorkout) return null;
    // Reconstruct the workout text from title + segments
    let text = `**${todayWorkout.title}**\n`;
    if (todayWorkout.segments.length > 0) {
      text += "| Segment | Duration | Target | HR Zone | Notes |\n";
      text += "|---------|----------|--------|---------|-------|\n";
      for (const s of todayWorkout.segments) {
        text += `| ${s.segment} | ${s.duration} | ${s.target} | ${s.hrZone} | ${s.notes || ""} |\n`;
      }
    }
    return text;
  };

  const assessDayAhead = async () => {
    if (!user || !content) return;
    const todayWorkout = extractTodayWorkout();
    if (!todayWorkout) {
      toast({ title: "No workout today", description: "There's no planned workout for today in your training plan.", variant: "destructive" });
      return;
    }

    setDayAdjusting(true);
    setDayAdjustResult(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", variant: "destructive" });
      setDayAdjusting(false);
      return;
    }

    const todayStr = format(new Date(), "yyyy-MM-dd");
    let accumulated = "";
    streamAICoach({
      type: "day-adjust",
      token: session.access_token,
      targetDate: todayStr,
      todayWorkout,
      onDelta: (text) => {
        accumulated += text;
        setDayAdjustResult(accumulated);
      },
      onDone: () => {
        setDayAdjusting(false);
      },
      onError: (err) => {
        toast({ title: "Day assessment failed", description: err, variant: "destructive" });
        setDayAdjusting(false);
      },
    });
  };

  const [showSyncInstructions, setShowSyncInstructions] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleSyncToIntervals = async (refresh = false) => {
    const workouts = parseWorkoutsFromPlan(content);
    const withSegments = workouts.filter(w => w.segments.length > 0 && w.dateObj);
    if (withSegments.length === 0) {
      toast({ title: "No structured workouts found", description: "The plan needs workout tables with Segment/Duration/HR Zone columns.", variant: "destructive" });
      return;
    }

    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Session expired", variant: "destructive" });
        setSyncing(false);
        return;
      }

      // Convert parsed workouts to API format, expanding intervals
      const apiWorkouts = withSegments.map(w => {
        const dateStr = w.dateObj!.toISOString().split("T")[0];
        const steps = w.segments.flatMap(seg => expandSegmentToSteps(seg));
        const description = w.segments.map(s => `${s.segment}: ${s.duration} ${s.hrZone}`).join(" | ");
        // Compute actual total duration and fix the title to match
        const totalSecs = steps.reduce((sum, s) => sum + s.duration, 0);
        const totalMins = Math.round(totalSecs / 60);
        const correctedName = w.title.replace(/\(Total:\s*\d+\s*min\)/i, `(Total: ${totalMins} min)`);
        return { date: dateStr, name: correctedName, description, steps };
      });

      // Calculate date range for clearing
      const dates = apiWorkouts.map(w => w.date).sort();
      const clearRange = refresh && dates.length > 0
        ? { oldest: dates[0], newest: dates[dates.length - 1] }
        : undefined;

      const resp = await supabase.functions.invoke("intervals-sync", {
        body: { workouts: apiWorkouts, clearRange },
      });

      if (resp.error) {
        toast({ title: "Sync failed", description: resp.error.message, variant: "destructive" });
      } else {
        const { succeeded, failed } = resp.data;
        const action = refresh ? "Refreshed" : "Synced";
        if (failed > 0) {
          toast({ title: `${action} ${succeeded} workouts`, description: `${failed} failed. Check intervals.icu for details.` });
        } else {
          toast({ title: `${action} ${succeeded} workouts to intervals.icu!` });
        }
      }
    } catch (e) {
      toast({ title: "Sync error", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleDeleteFromIntervals = async () => {
    const workouts = parseWorkoutsFromPlan(content);
    const withDates = workouts.filter(w => w.dateObj);
    if (withDates.length === 0) {
      toast({ title: "No workouts with dates found", variant: "destructive" });
      return;
    }
    const dates = withDates.map(w => w.dateObj!.toISOString().split("T")[0]).sort();
    setSyncing(true);
    try {
      const resp = await supabase.functions.invoke("intervals-sync", {
        body: { deleteRange: { oldest: dates[0], newest: dates[dates.length - 1] } },
      });
      if (resp.error) {
        toast({ title: "Delete failed", description: resp.error.message, variant: "destructive" });
      } else {
        toast({ title: `Deleted ${resp.data.deleted} workouts from intervals.icu` });
      }
    } catch (e) {
      toast({ title: "Delete error", description: e instanceof Error ? e.message : "Unknown error", variant: "destructive" });
    } finally {
      setSyncing(false);
    }
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
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="w-6 h-6 sm:w-8 sm:h-8 text-primary shrink-0" />
            Training Plan
          </h1>
          {content && !loading && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleSyncToIntervals(false)} disabled={syncing}>
                  <Upload className="w-4 h-4 mr-2" />
                  Sync to intervals.icu
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSyncToIntervals(true)} disabled={syncing}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh on intervals.icu
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDeleteFromIntervals} disabled={syncing}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete from intervals.icu
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExportIcs}>
                  <FileDown className="w-4 h-4 mr-2" />
                  Export calendar (.ics)
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowNewPlanDialog(true)}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  New Plan
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowDeleteDialog(true)} className="text-destructive focus:text-destructive">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Plan
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {letAIDecide
            ? "Full fitness assessment + complete plan to race day"
            : "Season strategy + detailed 4-week periodized plan"
          }
        </p>
        {content && !loading && (
          <div className="flex flex-wrap gap-2">
            <Button className="w-full sm:w-auto" onClick={reviewProgress} disabled={syncing || reviewing || dayAdjusting}>
              {reviewing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-2" />}
              {reviewing ? "Reviewing..." : "Review Progress"}
            </Button>
            <Button className="w-full sm:w-auto" variant="secondary" onClick={assessDayAhead} disabled={syncing || reviewing || dayAdjusting}>
              {dayAdjusting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sun className="w-4 h-4 mr-2" />}
              {dayAdjusting ? "Assessing..." : "Assess Day Ahead"}
            </Button>
          </div>
        )}
      </div>
      {content && !loading && (
        <>
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete training plan?</AlertDialogTitle>
                <AlertDialogDescription>This will permanently delete your current training plan. This action cannot be undone.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { deletePlan(); setShowDeleteDialog(false); }}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog open={showNewPlanDialog} onOpenChange={setShowNewPlanDialog}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start a new plan?</AlertDialogTitle>
                <AlertDialogDescription>This will discard your current plan and take you back to the configuration screen. Your saved plan will still be in the database until you generate a new one.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { setContent(""); setSavedPlanId(null); setShowNewPlanDialog(false); }}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {(showConfig || loading) && (
        <Button onClick={generatePlan} disabled={loading} size="lg" className="w-full sm:w-auto">
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
        {content && !loading && (
          <PlanCalendarView
            workouts={parseWorkoutsFromPlan(content)}
            planStartDate={startDate}
          />
        )}

        <Card>
          <CardContent className="p-4 sm:p-6">
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

        {reviewResult && !loading && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <p className="text-sm font-medium mb-3">What would you like to do?</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => applyAdjustment("apply")}>
                  <Check className="w-4 h-4 mr-2" />
                  Apply Suggestions
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyAdjustment("easier")}>
                  <ThumbsDown className="w-4 h-4 mr-2" />
                  Make Easier
                </Button>
                <Button size="sm" variant="outline" onClick={() => applyAdjustment("harder")}>
                  <ThumbsUp className="w-4 h-4 mr-2" />
                  Make Harder
                </Button>
                <Button size="sm" variant="ghost" onClick={keepCurrentPlan}>
                  <X className="w-4 h-4 mr-2" />
                  Keep Current Plan
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Day Ahead Assessment Result */}
        {(dayAdjustResult || dayAdjusting) && (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Sun className="w-4 h-4 text-primary" />
                Day Ahead Assessment
                {dayAdjusting && <Loader2 className="w-3 h-3 animate-spin" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {dayAdjustResult ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <MarkdownRenderer content={dayAdjustResult} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Analyzing your sleep, recovery, and readiness…</p>
              )}
              {!dayAdjusting && dayAdjustResult && (
                <Button size="sm" variant="ghost" className="mt-3" onClick={() => setDayAdjustResult(null)}>
                  <X className="w-4 h-4 mr-2" />
                  Dismiss
                </Button>
              )}
            </CardContent>
          </Card>
        )}

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
                <li>Click <strong className="text-foreground">Sync to intervals.icu</strong> above to push all workouts directly to your intervals.icu calendar</li>
                <li>Open <a href="https://intervals.icu" target="_blank" rel="noopener noreferrer" className="text-primary underline">intervals.icu</a> → check your <strong className="text-foreground">Calendar</strong> to see the planned workouts</li>
                <li>Connect your <strong className="text-foreground">Garmin/Amazfit</strong> account in intervals.icu settings to sync planned workouts to your watch</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-3">intervals.icu is free and supports direct sync to Garmin, Wahoo, and other devices. For Amazfit, you can also use the "Copy for Zepp" buttons to manually enter workouts in the Zepp app.</p>
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
