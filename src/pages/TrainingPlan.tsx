import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Calendar, Loader2, RotateCcw, Target, Layers, Clock, CalendarIcon, Trash2, Upload, RefreshCw, FileDown, Watch, ChevronDown, ChevronUp, ClipboardCheck, MoreVertical, ThumbsDown, ThumbsUp, Check, X, Sun, Activity, Moon, Brain, Dumbbell, Search, FileUp } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import PlanDayList from "@/components/PlanDayList";
import PlanOverview from "@/components/PlanOverview";
import { parseWorkoutsFromPlan, ParsedSegment, generateIcsCalendar, downloadText } from "@/lib/plan-export";
import { expandWorkoutSteps, parseDurationSeconds as sharedParseDuration, normalizePaceInput as sharedNormalizePace } from "@/lib/plan-step-expand";
import { importDocxPlan } from "@/lib/docx-plan-import";
import { importFitPlan } from "@/lib/fit-plan-import";

interface ApiStep {
  duration: number;
  hrLow: number;
  hrHigh: number;
  hrZone?: string;
  intensity: string;
  pace?: string;
}

const WALK_PACE = "13:00/km";

function parseDurationSeconds(duration: string): number {
  const clockMatch = duration.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (clockMatch) return parseInt(clockMatch[1], 10) * 60 + parseInt(clockMatch[2], 10);
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
  if (total === 0 && /^\d+(?:\.\d+)?$/.test(duration.trim())) total = Math.round(parseFloat(duration.trim()) * 60);
  return total || 600;
}

function zoneNumberToBpm(zone: number): { low: number; high: number } {
  switch (zone) {
    case 1: return { low: 100, high: 120 };
    case 2: return { low: 120, high: 140 };
    case 3: return { low: 140, high: 160 };
    case 4: return { low: 160, high: 175 };
    case 5: return { low: 175, high: 200 };
    default: return { low: 100, high: 140 };
  }
}

function normalizeHrZone(hrZone: string): string {
  const matches = Array.from(hrZone.matchAll(/Z(\d)/gi)).map((match) => parseInt(match[1], 10));
  if (matches.length === 0) return "Z2";
  if (matches.length === 1) return `Z${matches[0]}`;
  return `Z${matches[0]}-Z${matches[matches.length - 1]}`;
}

function hrZoneToBpm(hrZone: string): { low: number; high: number } {
  const matches = Array.from(hrZone.matchAll(/Z(\d)/gi)).map((match) => parseInt(match[1], 10));
  if (matches.length === 0) return zoneNumberToBpm(2);

  const lowZone = zoneNumberToBpm(matches[0]);
  const highZone = zoneNumberToBpm(matches[matches.length - 1]);

  return { low: lowZone.low, high: highZone.high };
}

function paceForSegment(seg: ParsedSegment, intensity: string): string {
  const txt = `${seg.segment} ${seg.duration} ${seg.target} ${seg.notes || ""}`.toLowerCase();
  const explicit = txt.match(/(\d{1,2}:\d{2})\s*(?:\/\s*(?:km|mi)|\b)/i);
  if (explicit) return `${explicit[1]}/km`;
  if (/recovery|rest/i.test(intensity) || /recovery|rest/.test(txt)) return WALK_PACE;
  if (/warmup|cooldown/i.test(intensity)) return /walk/.test(txt) ? WALK_PACE : "6:27/km";
  if (/walk/.test(txt) && !/run|interval|tempo|stride|fast/.test(txt)) return WALK_PACE;
  if (/z5|vo2|sprint|fast/.test(txt)) return "4:30/km";
  if (/z4|threshold|race\s*pace|5k/.test(txt)) return "5:00/km";
  if (/z3|tempo|steady/.test(txt)) return "5:30/km";
  return "6:27/km";
}

function normalizePaceInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/\/\s*(km|mi)$/i.test(trimmed)) return trimmed.replace(/\s+/g, "");
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? `${trimmed}/km` : trimmed;
}

/**
 * Expand a segment into API steps.
 * Handles repeat patterns like "5 x 2 min run / 1 min walk"
 */
function expandSegmentToSteps(seg: ParsedSegment): ApiStep[] {
  const hrZone = normalizeHrZone(seg.hrZone);
  const { low, high } = hrZoneToBpm(hrZone);

  // Determine step type from segment name
  const segName = seg.segment.toLowerCase();
  let stepType = "Active";
  if (/warm/i.test(segName)) stepType = "Warmup";
  else if (/cool/i.test(segName)) stepType = "Cooldown";
  else if (/rest/i.test(segName)) stepType = "Rest";
  else if (/recover/i.test(segName)) stepType = "Recovery";
  const workPace = paceForSegment(seg, stepType);
  const restPace = WALK_PACE;

  // Normalize duration: strip parentheses and extra text like "Run", "Walk" etc.
  const cleanDuration = seg.duration.replace(/[()]/g, "").trim();

  // Check for repeat/interval pattern: "10 x 1m Run / 1m Walk", "5 x 2 min / 1 min", etc.
  const repeatMatch = cleanDuration.match(/(\d+)\s*x\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b[^/]*?)\s*\/\s*([\d.]+\s*(?:m(?:in)?|sec|h|km)\b.*)/i);
  if (repeatMatch) {
    const reps = parseInt(repeatMatch[1], 10);
    const workDuration = parseDurationSeconds(repeatMatch[2]);
    const restDuration = parseDurationSeconds(repeatMatch[3]);
    const workZoneNumber = parseInt(hrZone.match(/Z(\d)/i)?.[1] || "2", 10);
    const restZone = `Z${Math.max(1, workZoneNumber - 1)}`;
    const restHr = hrZoneToBpm(restZone);
    
    const steps: ApiStep[] = [];
    for (let i = 0; i < reps; i++) {
      steps.push({ duration: workDuration, hrLow: low, hrHigh: high, hrZone, intensity: "Interval", pace: workPace });
      steps.push({ duration: restDuration, hrLow: restHr.low, hrHigh: restHr.high, hrZone: restZone, intensity: "Recovery", pace: restPace });
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
    const restZone = "Z1";
    const restHr = hrZoneToBpm(restZone);
    
    const steps: ApiStep[] = [];
    for (let i = 0; i < reps; i++) {
      steps.push({ duration: workDuration, hrLow: low, hrHigh: high, hrZone, intensity: "Interval", pace: workPace });
      // Always emit a recovery step after every rep so step indices match the UI's
      // expandSegments() output exactly. PlanDayList relies on positional indices
      // when applying user overrides — drop one walk and the cool-down override
      // lands on the wrong step.
      steps.push({ duration: restDuration, hrLow: restHr.low, hrHigh: restHr.high, hrZone: restZone, intensity: "Recovery", pace: restPace });
    }
    return steps;
  }

  // Simple single step
  const duration = parseDurationSeconds(seg.duration);
  return [{ duration, hrLow: low, hrHigh: high, hrZone, intensity: stepType, pace: workPace }];
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
  const [goalTime, setGoalTime] = useState<string>("");
  const [currentPaceMin, setCurrentPaceMin] = useState<string>("");
  const [currentPaceMax, setCurrentPaceMax] = useState<string>("");
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
  const [completedDates, setCompletedDates] = useState<Set<string>>(new Set());
  const [linkedActivities, setLinkedActivities] = useState<Record<string, any>>({});
  const [showPostAnalysis, setShowPostAnalysis] = useState(false);
  const [postAnalysisResult, setPostAnalysisResult] = useState<string | null>(null);
  const [postAnalyzing, setPostAnalyzing] = useState(false);
  const [postAnalysisPlanContent, setPostAnalysisPlanContent] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fitInputRef = useRef<HTMLInputElement>(null);

  // Load existing plan on mount
  const loadSavedPlan = useCallback(async () => {
    if (!user) { setInitialLoading(false); return; }
    try {
      const { data } = await supabase
        .from("training_plans")
        .select("*")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        setContent(data.content);
        setSavedPlanId(data.id);
        setRaceDistance(data.race_distance);
        setGoalTime((data as any).goal_time || "");
        setTrainingDays(data.training_days);
        setStartDate(parseLocalISODate(data.start_date));
        if (data.race_date && data.race_date !== "ai-recommend") {
          setRaceDate(parseLocalISODate(data.race_date));
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

  // Fetch activities linked to this plan to track completion
  const fetchLinkedActivities = useCallback(async () => {
    if (!savedPlanId || !user) { setCompletedDates(new Set()); setLinkedActivities({}); return; }
    const { data } = await supabase
      .from("activities")
      .select("start_time, distance_meters, duration_seconds, avg_heart_rate, max_heart_rate, avg_speed, avg_cadence, calories, activity_type")
      .eq("user_id", user.id)
      .eq("training_plan_id", savedPlanId);
    if (data) {
      const dates = new Set<string>();
      const actMap: Record<string, any> = {};
      for (const a of data) {
        if (a.start_time) {
          const key = format(new Date(a.start_time), "yyyy-MM-dd");
          dates.add(key);
          actMap[key] = a;
        }
      }
      setCompletedDates(dates);
      setLinkedActivities(actMap);
    }
  }, [savedPlanId, user]);

  useEffect(() => { fetchLinkedActivities(); }, [fetchLinkedActivities]);

  // Re-fetch when window regains focus (e.g. after linking activity on another page)
  useEffect(() => {
    const onFocus = () => { fetchLinkedActivities(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchLinkedActivities]);

  const savePlan = async (planContent: string) => {
    if (!user) return;
    const raceDateValue = letAIDecide ? "ai-recommend" : (raceDate ? toLocalISODate(raceDate) : undefined) || null;

    // Archive old plan instead of deleting, then insert new one
    if (savedPlanId) {
      await supabase.from("training_plans").update({ archived: true }).eq("id", savedPlanId);
    }

    const { data, error } = await supabase
      .from("training_plans")
      .insert({
        user_id: user.id,
        race_distance: raceDistance,
        goal_time: goalTime || null,
        training_days: trainingDays,
        start_date: toLocalISODate(startDate),
        race_date: raceDateValue,
        content: planContent,
      } as any)
      .select("id")
      .single();

    if (!error && data) {
      setSavedPlanId(data.id);
    }
  };

  const deletePlan = async () => {
    if (!savedPlanId) return;
    // Archive (soft delete) so the plan is preserved under Settings → Previous Plans
    await supabase.from("training_plans").update({ archived: true }).eq("id", savedPlanId);
    setSavedPlanId(null);
    setContent("");
    toast({ title: "Plan archived", description: "Find it under Settings → Previous Plans" });
  };

  // Floating start/end date editor
  const [updatingDates, setUpdatingDates] = useState(false);
  const [datePopoverOpen, setDatePopoverOpen] = useState(false);
  const [pendingStart, setPendingStart] = useState<Date | undefined>(undefined);
  const [pendingEnd, setPendingEnd] = useState<Date | undefined>(undefined);

  // Format a Date as YYYY-MM-DD using LOCAL components (avoids UTC off-by-one)
  const toLocalISODate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  // Parse YYYY-MM-DD as a local date (avoids UTC midnight drift)
  const parseLocalISODate = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };

  useEffect(() => {
    if (datePopoverOpen) {
      setPendingStart(startDate);
      setPendingEnd(raceDate);
    }
  }, [datePopoverOpen, startDate, raceDate]);

  const shiftPlanDates = (markdown: string, deltaDays: number): string => {
    if (!deltaDays) return markdown;
    return markdown.replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (_m, d, mo, y) => {
      const date = new Date(Number(y), Number(mo) - 1, Number(d));
      if (isNaN(date.getTime())) return _m;
      date.setDate(date.getDate() + deltaDays);
      const dd = String(date.getDate()).padStart(2, "0");
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const yy = date.getFullYear();
      return `${dd}/${mm}/${yy}`;
    });
  };

  // Move a single workout from one date to another by rewriting the bold date marker in the markdown
  const moveWorkoutDate = async (fromIso: string, toIso: string) => {
    if (!content) return;
    const fromParts = fromIso.split("-");
    const toParts = toIso.split("-");
    if (fromParts.length !== 3 || toParts.length !== 3) return;
    const fromDmy = `${fromParts[2]}/${fromParts[1]}/${fromParts[0]}`;
    const toDmy = `${toParts[2]}/${toParts[1]}/${toParts[0]}`;

    // Replace inside **...DD/MM/YYYY...** date headers only
    const lines = content.split("\n");
    let replaced = false;
    const newLines = lines.map((ln) => {
      if (replaced) return ln;
      const headerRe = /\*\*[^*]*\b(\d{1,2}\/\d{1,2}\/\d{4})\b[^*]*\*\*/;
      const m = ln.match(headerRe);
      if (m && m[1] === fromDmy) {
        replaced = true;
        return ln.replace(fromDmy, toDmy);
      }
      return ln;
    });
    if (!replaced) {
      toast({ title: "Could not move workout", description: "Workout header not found.", variant: "destructive" });
      return;
    }
    const newContent = newLines.join("\n");
    setContent(newContent);
    if (savedPlanId && user) {
      await supabase.from("training_plans").update({ content: newContent }).eq("id", savedPlanId);
    }
    toast({ title: "Workout moved", description: `Rescheduled to ${toParts[2]}/${toParts[1]}/${toParts[0]}.` });
  };

  const persistStartDateShift = async (newStart: Date) => {
    setUpdatingDates(true);
    try {
      const deltaDays = Math.round((newStart.getTime() - startDate.getTime()) / 86400000);
      const newContent = shiftPlanDates(content, deltaDays);
      setContent(newContent);
      setStartDate(newStart);
      if (savedPlanId && user) {
        await supabase.from("training_plans")
          .update({
            start_date: toLocalISODate(newStart),
            content: newContent,
          })
          .eq("id", savedPlanId);
      }
      toast({ title: "Start date updated", description: "Workouts shifted to the new start date." });
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    } finally {
      setUpdatingDates(false);
    }
  };

  const regenerateForNewEndDate = async (newStart: Date, newEnd: Date) => {
    if (!user) return;
    if (newEnd <= newStart) {
      toast({ title: "Invalid dates", description: "End date must be after start date.", variant: "destructive" });
      return;
    }
    setDatePopoverOpen(false);
    if (savedPlanId) {
      await supabase.from("training_plans").update({ archived: true }).eq("id", savedPlanId);
      setSavedPlanId(null);
    }
    setStartDate(newStart);
    setRaceDate(newEnd);
    setLetAIDecide(false);
    setContent("");
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    let accumulated = "";
    streamAICoach({
      type: "training-plan",
      token: session.access_token,
      raceDistance,
      goalTime,
      currentPaceMin,
      currentPaceMax,
      trainingDays,
      startDate: toLocalISODate(newStart),
      raceDate: toLocalISODate(newEnd),
      onDelta: (text) => { accumulated += text; setContent(accumulated); },
      onDone: () => {
        setLoading(false);
        savePlan(accumulated);
        toast({ title: "Plan regenerated", description: "New plan built for updated end date." });
      },
      onError: (err) => {
        toast({ title: "Regeneration failed", description: err, variant: "destructive" });
        setLoading(false);
      },
    });
  };

  const applyDateChanges = () => {
    if (!pendingStart) return;
    const startChanged = pendingStart.toDateString() !== startDate.toDateString();
    const endChanged = (pendingEnd?.toDateString() || "") !== (raceDate?.toDateString() || "");
    if (endChanged && pendingEnd) {
      regenerateForNewEndDate(pendingStart, pendingEnd);
    } else if (startChanged) {
      persistStartDateShift(pendingStart);
      setDatePopoverOpen(false);
    } else {
      setDatePopoverOpen(false);
    }
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
      goalTime,
      currentPaceMin,
      currentPaceMax,
      trainingDays,
      startDate: toLocalISODate(startDate),
      raceDate: letAIDecide ? "ai-recommend" : (raceDate ? toLocalISODate(raceDate) : undefined),
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
      goalTime,
      currentPaceMin,
      currentPaceMax,
      trainingDays,
      startDate: toLocalISODate(startDate),
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
      goalTime,
      currentPaceMin,
      currentPaceMax,
      trainingDays,
      startDate: toLocalISODate(startDate),
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

  const runPostPlanAnalysis = async () => {
    if (!user || !postAnalysisPlanContent) return;
    setPostAnalyzing(true);
    setPostAnalysisResult(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", variant: "destructive" });
      setPostAnalyzing(false);
      return;
    }

    let accumulated = "";
    streamAICoach({
      type: "post-plan-analysis",
      token: session.access_token,
      raceDistance,
      goalTime,
      currentPaceMin,
      currentPaceMax,
      currentPlan: postAnalysisPlanContent,
      onDelta: (text) => {
        accumulated += text;
        setPostAnalysisResult(accumulated);
      },
      onDone: () => {
        setPostAnalyzing(false);
        const needsChanges = /Verdict:\s*CHANGES RECOMMENDED/i.test(accumulated);
        if (needsChanges) {
          // Store for the review/adjust flow
          setOriginalPlanBeforeReview(postAnalysisPlanContent);
          setReviewResult(accumulated);
        }
      },
      onError: (err) => {
        toast({ title: "Analysis failed", description: err, variant: "destructive" });
        setPostAnalyzing(false);
      },
    });
  };

  const dismissPostAnalysis = () => {
    setShowPostAnalysis(false);
    setPostAnalysisResult(null);
    setPostAnalysisPlanContent(null);
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

  const [dayAdjustIsModified, setDayAdjustIsModified] = useState(false);
  const [dayAdjustDialogOpen, setDayAdjustDialogOpen] = useState(false);
  const [dayAdjustPhase, setDayAdjustPhase] = useState<"sleep" | "metrics" | "analyzing" | "done">("sleep");

  const assessDayAhead = async () => {
    if (!user || !content) return;
    const todayWorkout = extractTodayWorkout();
    if (!todayWorkout) {
      toast({ title: "No workout today", description: "There's no planned workout for today in your training plan.", variant: "destructive" });
      return;
    }

    // Open dialog immediately with progress
    setDayAdjustDialogOpen(true);
    setDayAdjusting(true);
    setDayAdjustResult(null);
    setDayAdjustIsModified(false);
    setDayAdjustPhase("sleep");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", variant: "destructive" });
      setDayAdjusting(false);
      setDayAdjustDialogOpen(false);
      return;
    }

    // Simulate progress phases as the AI processes
    setTimeout(() => setDayAdjustPhase("metrics"), 1500);
    setTimeout(() => setDayAdjustPhase("analyzing"), 3500);

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
        if (dayAdjustPhase !== "done") setDayAdjustPhase("analyzing");
      },
      onDone: () => {
        setDayAdjusting(false);
        setDayAdjustPhase("done");
        const isAdjusted = /Decision:\s*ADJUSTED/i.test(accumulated);
        setDayAdjustIsModified(isAdjusted);
      },
      onError: (err) => {
        toast({ title: "Day assessment failed", description: err, variant: "destructive" });
        setDayAdjusting(false);
        setDayAdjustDialogOpen(false);
      },
    });
  };

  const applyDayAdjustment = () => {
    if (!dayAdjustResult || !content) return;

    const today = new Date();
    const todayStr = format(today, "yyyy-MM-dd");
    const workouts = parseWorkoutsFromPlan(content);
    const todayWorkout = workouts.find(w => w.dateObj && format(w.dateObj, "yyyy-MM-dd") === todayStr);

    if (!todayWorkout || !todayWorkout.rawText) {
      toast({ title: "Could not find today's workout in plan", variant: "destructive" });
      return;
    }

    const workoutSection = dayAdjustResult.match(/##\s*📝\s*Workout for Today\s*\n([\s\S]*?)(?=\n##\s|$)/i);
    if (!workoutSection) {
      toast({ title: "Could not extract adjusted workout", description: "The AI response format was unexpected. Please try again.", variant: "destructive" });
      return;
    }

    const rawLines = todayWorkout.rawText.split("\n");
    const dateLine = rawLines[0];
    const adjustedContent = workoutSection[1].trim();

    const newTitleMatch = adjustedContent.match(/\*\*([^*]+)\*\*/);
    const newTitle = newTitleMatch ? newTitleMatch[1] : todayWorkout.title;

    const datePrefix = dateLine.match(/(\*\*[^*]*\d{1,2}\/\d{1,2}\/\d{4}\*\*\s*[-–:]\s*)/);
    const newDateLine = datePrefix ? `${datePrefix[1]}${newTitle}` : dateLine;

    const adjustedWithoutTitle = adjustedContent.replace(/^\*\*[^*]+\*\*\s*\n?/, "").trim();
    const replacement = `${newDateLine}\n\n${adjustedWithoutTitle}`;

    const idx = content.indexOf(todayWorkout.rawText);
    if (idx === -1) {
      toast({ title: "Could not locate workout in plan to replace", variant: "destructive" });
      return;
    }

    const updatedContent = content.slice(0, idx) + replacement + content.slice(idx + todayWorkout.rawText.length);

    setContent(updatedContent);
    savePlan(updatedContent);
    setDayAdjustIsModified(false);
    setDayAdjustResult(null);
    setDayAdjustDialogOpen(false);
    toast({
      title: "Workout updated!",
      description: "Syncing adjusted workout to Intervals.icu...",
    });

    // Auto-sync to Intervals.icu after applying adjustment
    setTimeout(() => {
      handleSyncToIntervals(true);
    }, 500);
  };

  const dismissDayAdjust = () => {
    setDayAdjustResult(null);
    setDayAdjustIsModified(false);
    setDayAdjustDialogOpen(false);
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

      const stepOverrides = JSON.parse(localStorage.getItem("plan-step-overrides") || "{}") as Record<string, Record<number, { duration?: string; pace?: string }>>;

      // Convert parsed workouts to API format, expanding intervals
      const apiWorkouts = withSegments.map(w => {
        const d = w.dateObj!;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        const overridesForWorkout = stepOverrides[dateStr] || {};
        const expanded = expandWorkoutSteps(w.segments, w.title, w.rawText ?? "");
        const steps = expanded.map((step, idx) => ({
          duration: overridesForWorkout[idx]?.duration ? sharedParseDuration(overridesForWorkout[idx].duration!) : step.duration,
          hrLow: step.hrLow,
          hrHigh: step.hrHigh,
          hrZone: step.hrZone,
          intensity: step.intensity,
          pace: overridesForWorkout[idx]?.pace ? sharedNormalizePace(overridesForWorkout[idx].pace!) : step.pace,
        }));
        const description = w.segments.map(s => `${s.segment}: ${s.duration} ${s.hrZone}`).join(" | ");
        const notes = w.segments
          .map(s => s.notes?.trim())
          .filter(Boolean)
          .join("\n");
        const totalSecs = steps.reduce((sum, s) => sum + s.duration, 0);
        const totalMins = Math.round(totalSecs / 60);
        const correctedName = w.title.replace(/\(Total:\s*\d+\s*min\)/i, `(Total: ${totalMins} min)`);
        return {
          date: dateStr,
          name: correctedName,
          description,
          steps,
          notes,
          rawDescription: w.intervalsText,
        };
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
    const dates = withDates.map(w => {
      const d = w.dateObj!;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }).sort();
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

  const handleExportDocx = async () => {
    const workouts = parseWorkoutsFromPlan(content);
    if (workouts.length === 0) {
      toast({ title: "No workouts found", variant: "destructive" });
      return;
    }
    try {
      const { generatePlanDocx, downloadBlob } = await import("@/lib/plan-docx");
      const blob = await generatePlanDocx(workouts, raceDistance);
      downloadBlob(blob, "training-plan.docx");
      toast({ title: "Word document downloaded!" });
    } catch (e: any) {
      toast({ title: "Export failed", description: e?.message || String(e), variant: "destructive" });
    }
  };
  const handleImportDocx = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    // Reset input so same file can be re-selected
    e.target.value = "";

    if (!file.name.endsWith(".docx")) {
      toast({ title: "Invalid file", description: "Please select a .docx Word document.", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
      const result = await importDocxPlan(file);
      
      // Update state with imported plan metadata
      setRaceDistance(result.raceDistance);
      setTrainingDays(result.trainingDays);
      setStartDate(new Date(result.startDate));
      setRaceDate(new Date(result.endDate));
      setLetAIDecide(false);
      setContent(result.markdown);
      
      // Save to database
      await savePlan(result.markdown);

      toast({
        title: `Imported ${result.workoutCount} workouts!`,
        description: `Plan from ${result.startDate} to ${result.endDate}. You can now sync to intervals.icu.`,
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Could not parse the document.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleImportFit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length || !user) return;

    const valid = files.filter(f => /\.(fit|zip)$/i.test(f.name));
    if (valid.length === 0) {
      toast({ title: "Invalid files", description: "Please select .fit files or a .zip archive.", variant: "destructive" });
      return;
    }

    setImporting(true);
    try {
      const result = await importFitPlan(valid);
      setRaceDistance(result.raceDistance);
      setTrainingDays(result.trainingDays);
      setStartDate(new Date(result.startDate));
      setRaceDate(new Date(result.endDate));
      setLetAIDecide(false);
      setContent(result.markdown);
      await savePlan(result.markdown);

      toast({
        title: `Imported ${result.workoutCount} workouts!`,
        description: result.errors.length
          ? `Some files couldn't be parsed (${result.errors.length}).`
          : `Plan from ${result.startDate} to ${result.endDate}.`,
      });
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Could not parse the FIT files.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
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
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="default"
                size="sm"
                onClick={() => handleSyncToIntervals(true)}
                disabled={syncing}
                className="gap-2"
                title="Rebuild all workouts on intervals.icu so graphs refresh"
              >
                {syncing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Refresh on intervals.icu</span>
                <span className="sm:hidden">Refresh</span>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon">
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
                <DropdownMenuItem onClick={handleExportDocx}>
                  <FileDown className="w-4 h-4 mr-2" />
                  Export plan (Word .docx)
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
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {letAIDecide
            ? "Full fitness assessment + complete plan to race day"
            : "Your personal season strategy and tailored training plan"
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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="w-full sm:w-auto" variant="outline" disabled={syncing || reviewing || dayAdjusting || loading}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Regenerate Plan
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Regenerate plan?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will archive your current plan and generate a new one using the same race distance, training days, start date and race date. Your latest fitness data will be used.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => generatePlan()}>Regenerate</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                <AlertDialogDescription>This will archive your current plan (you can resume it later from Settings → Previous Plans) and take you back to the configuration screen.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={async () => {
                  if (savedPlanId) {
                    await supabase.from("training_plans").update({ archived: true }).eq("id", savedPlanId);
                  }
                  setContent("");
                  setSavedPlanId(null);
                  setShowNewPlanDialog(false);
                  toast({ title: "Plan archived", description: "Find it under Settings → Previous Plans" });
                }}>Continue</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
      {(showConfig || loading) && (
        <div className="flex flex-wrap gap-3">
          <Button onClick={generatePlan} disabled={loading || importing} size="lg" className="w-full sm:w-auto">
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".docx"
            onChange={handleImportDocx}
            className="hidden"
          />
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            disabled={loading || importing}
            onClick={() => fileInputRef.current?.click()}
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4 mr-2" />
                Import .docx Plan
              </>
            )}
          </Button>
          <input
            ref={fitInputRef}
            type="file"
            accept=".fit,.zip"
            multiple
            onChange={handleImportFit}
            className="hidden"
          />
          <Button
            variant="outline"
            size="lg"
            className="w-full sm:w-auto"
            disabled={loading || importing}
            onClick={() => fitInputRef.current?.click()}
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <FileUp className="w-4 h-4 mr-2" />
                Import .fit / .zip
              </>
            )}
          </Button>
        </div>
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
                <Label className="text-sm font-medium">Goal Time <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  type="text"
                  placeholder="e.g. 30:00 or 1:45:00"
                  value={goalTime}
                  onChange={(e) => setGoalTime(e.target.value)}
                  className="max-w-[220px]"
                />
                <p className="text-xs text-muted-foreground">
                  Target finish time — the AI will build pace targets and intervals around hitting this.
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-border/50 p-4 bg-muted/20">
                <Label className="text-sm font-medium">Current Easy Run Pace <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <p className="text-xs text-muted-foreground">
                  If you know your current easy/Z2 pace, enter the range here (min:sec per km). The plan will start at this pace and gradually progress toward your goal. Leave blank and we'll estimate from your Strava history.
                </p>
                <div className="flex items-center gap-2 max-w-[360px]">
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 7:00"
                    value={currentPaceMin}
                    onChange={(e) => setCurrentPaceMin(e.target.value)}
                    className="text-center"
                  />
                  <span className="text-muted-foreground text-sm">to</span>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 7:30"
                    value={currentPaceMax}
                    onChange={(e) => setCurrentPaceMax(e.target.value)}
                    className="text-center"
                  />
                  <span className="text-xs text-muted-foreground whitespace-nowrap">/km</span>
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
            <FeatureCard icon={Target} title="Tailored to You" desc="Built around your goals, experience, and weekly availability" />
            <FeatureCard icon={Layers} title="Fully Personalised" desc="Daily workouts adapted to your fitness, recovery, and schedule" />
            <FeatureCard icon={Clock} title="Smart Progression" desc="Build and recovery balanced around your race date" />
          </div>
        </>
      )}

      {(content || loading) && (<>
        {content && !loading && (
          <>
            <PlanOverview
              workouts={parseWorkoutsFromPlan(content)}
              planStartDate={startDate}
              raceDistance={raceDistance}
              raceDate={raceDate}
              completedDates={completedDates}
              linkedActivities={linkedActivities}
              headerAction={
                <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="gap-2 bg-white/15 hover:bg-white/25 text-primary-foreground border-0 backdrop-blur"
                    >
                      <CalendarIcon className="w-3.5 h-3.5" />
                      {format(new Date(), "dd MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" sideOffset={8} collisionPadding={12} className="w-[min(92vw,360px)] max-h-[80vh] overflow-y-auto p-4 space-y-4 z-50">
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">Start date</Label>
                      <CalendarComponent
                        mode="single"
                        selected={pendingStart}
                        onSelect={(d) => d && setPendingStart(d)}
                        initialFocus
                        className={cn("p-3 pointer-events-auto rounded-md border")}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wide text-muted-foreground">End date (race day)</Label>
                      <CalendarComponent
                        mode="single"
                        selected={pendingEnd}
                        onSelect={(d) => d && setPendingEnd(d)}
                        disabled={(date) => !!pendingStart && date <= pendingStart}
                        className={cn("p-3 pointer-events-auto rounded-md border")}
                      />
                      <p className="text-xs text-muted-foreground max-w-[260px]">
                        Changing the end date regenerates the whole plan. Changing only the start date shifts existing workouts.
                      </p>
                    </div>
                    <div className="flex justify-end gap-2 pt-2 border-t">
                      <Button variant="ghost" size="sm" onClick={() => setDatePopoverOpen(false)}>Cancel</Button>
                      <Button size="sm" onClick={applyDateChanges} disabled={updatingDates}>
                        {updatingDates && <Loader2 className="w-3 h-3 mr-2 animate-spin" />}
                        Apply
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
              }
            />
            <PlanDayList
              workouts={parseWorkoutsFromPlan(content)}
              planStartDate={startDate}
              planEndDate={raceDate}
              completedDates={completedDates}
              onMoveWorkout={moveWorkoutDate}
              onSyncWorkout={() => handleSyncToIntervals(true)}
              syncing={syncing}
            />
          </>
        )}

        {!content && (
          <Card>
            <CardContent className="p-4 sm:p-6">
              <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Generating your personalised training plan...</span>
              </div>
            </CardContent>
          </Card>
        )}
        {loading && content && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground justify-center">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Still generating...</span>
          </div>
        )}

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

        {/* Day Ahead Assessment Dialog */}
        <Dialog open={dayAdjustDialogOpen} onOpenChange={(open) => { if (!open && !dayAdjusting) dismissDayAdjust(); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-primary" />
                Day Ahead Assessment
              </DialogTitle>
              <DialogDescription>
                Analyzing your readiness for today's workout
              </DialogDescription>
            </DialogHeader>

            {/* Progress Steps */}
            {dayAdjusting && (
              <div className="space-y-3 py-2">
                {([
                  { phase: "sleep", icon: Moon, label: "Checking last night's sleep..." },
                  { phase: "metrics", icon: Activity, label: "Reading HRV, resting HR & stress..." },
                  { phase: "analyzing", icon: Brain, label: "Analyzing workout suitability..." },
                ] as const).map(({ phase, icon: Icon, label }) => {
                  const phases = ["sleep", "metrics", "analyzing", "done"] as const;
                  const currentIdx = phases.indexOf(dayAdjustPhase);
                  const stepIdx = phases.indexOf(phase);
                  const isDone = currentIdx > stepIdx;
                  const isActive = currentIdx === stepIdx;
                  return (
                    <div key={phase} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${
                        isDone ? "bg-primary text-primary-foreground" : isActive ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                      }`}>
                        {isDone ? <Check className="w-4 h-4" /> : isActive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
                      </div>
                      <span className={`text-sm ${isDone ? "text-foreground" : isActive ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                        {isDone ? label.replace("...", " ✓") : label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* AI Result */}
            {dayAdjustResult && (
              <div className="prose prose-sm max-w-none dark:prose-invert mt-2">
                <MarkdownRenderer content={dayAdjustResult} />
              </div>
            )}

            {/* Action Buttons */}
            {!dayAdjusting && dayAdjustResult && (
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                {dayAdjustIsModified ? (
                  <>
                    <Button size="sm" onClick={applyDayAdjustment}>
                      <Check className="w-4 h-4 mr-2" />
                      Apply Adjusted Workout
                    </Button>
                    <Button size="sm" variant="outline" onClick={dismissDayAdjust}>
                      <Dumbbell className="w-4 h-4 mr-2" />
                      Keep Original
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" onClick={dismissDayAdjust}>
                    <Check className="w-4 h-4 mr-2" />
                    Got it, let's go!
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Post-Plan Analysis Dialog */}
        <Dialog open={showPostAnalysis} onOpenChange={(open) => { if (!open && !postAnalyzing) dismissPostAnalysis(); }}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Search className="w-5 h-5 text-primary" />
                Analyse Your Workouts
              </DialogTitle>
              <DialogDescription>
                {postAnalysisResult
                  ? "Here's how your recent activity compares to the new plan"
                  : "Would you like me to check your recent workouts against this plan to see if anything needs adjusting?"
                }
              </DialogDescription>
            </DialogHeader>

            {!postAnalysisResult && !postAnalyzing && (
              <div className="space-y-3 py-2">
                <p className="text-sm text-muted-foreground">
                  I'll compare your recent training history against the plan to check for pacing, volume, or intensity mismatches — and suggest amendments if needed.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={runPostPlanAnalysis}>
                    <Search className="w-4 h-4 mr-2" />
                    Yes, analyse my workouts
                  </Button>
                  <Button size="sm" variant="ghost" onClick={dismissPostAnalysis}>
                    No thanks
                  </Button>
                </div>
              </div>
            )}

            {postAnalyzing && !postAnalysisResult && (
              <div className="flex items-center gap-3 py-4 justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Analysing your recent workouts...</span>
              </div>
            )}

            {postAnalysisResult && (
              <div className="prose prose-sm max-w-none dark:prose-invert mt-2">
                <MarkdownRenderer content={postAnalysisResult} />
              </div>
            )}

            {!postAnalyzing && postAnalysisResult && (
              <div className="flex flex-wrap gap-2 pt-3 border-t">
                {/Verdict:\s*CHANGES RECOMMENDED/i.test(postAnalysisResult) ? (
                  <>
                    <Button size="sm" onClick={() => { dismissPostAnalysis(); applyAdjustment("apply"); }}>
                      <Check className="w-4 h-4 mr-2" />
                      Apply Changes
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { dismissPostAnalysis(); applyAdjustment("easier"); }}>
                      <ThumbsDown className="w-4 h-4 mr-2" />
                      Make Easier
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { dismissPostAnalysis(); applyAdjustment("harder"); }}>
                      <ThumbsUp className="w-4 h-4 mr-2" />
                      Make Harder
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { dismissPostAnalysis(); keepCurrentPlan(); }}>
                      <X className="w-4 h-4 mr-2" />
                      Keep Current Plan
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="secondary" onClick={dismissPostAnalysis}>
                    <Check className="w-4 h-4 mr-2" />
                    Great, let's go!
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>


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
                <li>Connect your watch account in intervals.icu settings to sync planned workouts to your watch</li>
              </ol>
              <p className="text-xs text-muted-foreground mt-3">intervals.icu is free and supports direct sync to Garmin, Wahoo, and other devices.</p>
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
