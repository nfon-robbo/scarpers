import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useUnits } from "@/hooks/useUnits";
import { supabase } from "@/integrations/supabase/client";
import BenchmarkConfirmCard from "@/components/BenchmarkConfirmCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Heart, Timer, Zap, TrendingUp, Mountain,
  Trash2, ChevronRight,
} from "lucide-react";
import ActivityDetailDialog from "@/components/ActivityDetailDialog";
import UndoGarminImportButton from "@/components/UndoGarminImportButton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { getScheduledBenchmarksInRange } from "@/lib/benchmark-scheduled";
import {
  findBenchmarkCandidates,
  type ActivityForDetection,
  type CandidateActivity,
} from "@/lib/benchmark-detection";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

type BenchmarkPrompt = {
  isoDate: string;
  protocol: BenchmarkProtocol;
  candidates: CandidateActivity[];
};

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const Activities = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { fmt } = useUnits();
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(searchParams.get("activity"));
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [togglingPlan, setTogglingPlan] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"date" | "distance">("date");
  const [benchmarkRefreshKey, setBenchmarkRefreshKey] = useState(0);

  const LIST_COLUMNS =
    "id,user_id,start_time,activity_type,source_file,training_effect,training_load,training_plan_id," +
    "distance_meters,duration_seconds,avg_heart_rate,max_heart_rate,avg_speed,max_speed," +
    "avg_power,max_power,avg_cadence,total_ascent,total_descent,calories,avg_temperature," +
    "latitude,longitude";

  useEffect(() => {
    if (!user) return;
    Promise.all([
      supabase
        .from("activities")
        .select(LIST_COLUMNS)
        .eq("user_id", user.id)
        .order("start_time", { ascending: false }),
      supabase
        .from("training_plans")
        .select("id")
        .eq("user_id", user.id)
        .eq("archived", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([activitiesRes, planRes]) => {
      setActivities(dedupeActivities(activitiesRes.data || []));
      setCurrentPlanId(planRes.data?.id || null);
      setLoading(false);
    });
  }, [user]);

  const togglePlanAllocation = async (activityId: string, currentlyAllocated: boolean) => {
    setTogglingPlan(activityId);
    const newValue = currentlyAllocated ? null : currentPlanId;
    const { error } = await supabase
      .from("activities")
      .update({ training_plan_id: newValue } as any)
      .eq("id", activityId);
    if (error) {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    } else {
      setActivities((prev) =>
        prev.map((a) => a.id === activityId ? { ...a, training_plan_id: newValue } : a)
      );
      // Notify Training Plan page (and anything else) to refetch completion state
      try {
        window.dispatchEvent(new CustomEvent("plan-link-changed", { detail: { activityId, planId: newValue } }));
      } catch {}
      toast({
        title: currentlyAllocated ? "Removed from plan" : "Linked to plan",
        description: currentlyAllocated
          ? "This activity no longer counts toward plan completion."
          : "This activity now counts as a completed plan workout.",
      });
    }
    setTogglingPlan(null);
  };

  const deleteActivity = async (id: string) => {
    setDeleting(id);
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    } else {
      setActivities((prev) => prev.filter((a) => a.id !== id));
      toast({ title: "Activity deleted" });
    }
    setDeleting(null);
  };

  const fmtDuration = (seconds: number | null, detailed = false) => {
    if (!seconds) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (detailed) {
      if (h > 0) return `${h}h ${m}m ${s}s`;
      return `${m}m ${s}s`;
    }
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const categorise = (t: string | null | undefined) => {
    const s = (t || "").toLowerCase();
    if (s.includes("walk") || s.includes("hike")) return "walking";
    if (s.includes("run")) return "running";
    return "other";
  };

  const visibleActivities = activities
    .filter((a) => typeFilter === "all" || categorise(a.activity_type) === typeFilter)
    .slice()
    .sort((a, b) => {
      if (sortBy === "distance") {
        return (Number(b.distance_meters) || 0) - (Number(a.distance_meters) || 0);
      }
      return new Date(b.start_time || 0).getTime() - new Date(a.start_time || 0).getTime();
    });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
          <p className="text-muted-foreground mt-1">
            {visibleActivities.length} of {activities.length} activities
          </p>
        </div>
        <UndoGarminImportButton />
      </div>

      {activities.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="walking">Walking</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as "date" | "distance")}>
            <SelectTrigger className="w-[160px] h-9">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date">Newest first</SelectItem>
              <SelectItem value="distance">Longest distance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {user && (
        <ActivitiesBenchmarkPrompt
          userId={user.id}
          planId={currentPlanId}
          refreshKey={benchmarkRefreshKey}
          onDone={() => setBenchmarkRefreshKey((n) => n + 1)}
        />
      )}

      {visibleActivities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {activities.length === 0
              ? "No activities yet. Upload FIT files to get started."
              : "No activities match the current filter."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleActivities.map((a) => (
            <Card key={a.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex-1 text-left cursor-pointer"
                    onClick={() => setOpenId(a.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenId(a.id);
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        {a.start_time
                          ? new Date(a.start_time).toLocaleDateString(undefined, {
                              weekday: "short", year: "numeric", month: "short", day: "numeric",
                            })
                          : "Unknown date"}
                      </span>
                      {a.activity_type && (
                        <Badge variant="secondary" className="capitalize text-xs">{a.activity_type}</Badge>
                      )}
                      {a.training_effect && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help inline-flex">
                              <Badge variant="outline" className="text-xs">TE {Number(a.training_effect).toFixed(1)}</Badge>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs text-xs">
                            <p className="font-semibold mb-1">Training Effect ({Number(a.training_effect).toFixed(1)})</p>
                            <p>{getTrainingEffectDescription(Number(a.training_effect))}</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{a.source_file}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    {currentPlanId && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1.5">
                            <Checkbox
                              checked={a.training_plan_id === currentPlanId}
                              disabled={togglingPlan === a.id}
                              onCheckedChange={() => togglePlanAllocation(a.id, a.training_plan_id === currentPlanId)}
                            />
                            <span className="text-xs text-muted-foreground">Plan</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          {a.training_plan_id === currentPlanId
                            ? "This activity is linked to your current training plan"
                            : "Link this activity to your current training plan for progress review"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {a.start_time && new Date(a.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete activity?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently remove this activity and its data. This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteActivity(a.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {deleting === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Delete"}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>

                {/* Summary metrics */}
                <button
                  className="grid grid-cols-3 sm:grid-cols-7 gap-3 mt-3 w-full text-left"
                  onClick={() => setOpenId(a.id)}
                >
                  <Metric icon={TrendingUp} label="Distance" value={fmt.distance(a.distance_meters ?? (a.avg_speed && a.duration_seconds ? (a.avg_speed / 3.6 * a.duration_seconds) : null))} />
                  <Metric icon={Timer} label="Duration" value={fmtDuration(a.duration_seconds)} />
                  <Metric icon={Heart} label="Avg HR" value={a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)}` : null} unit="bpm" />
                  <Metric icon={Heart} label="Max HR" value={a.max_heart_rate ? `${Math.round(a.max_heart_rate)}` : null} unit="bpm" />
                  <Metric icon={TrendingUp} label="Speed" value={fmt.speed(a.avg_speed)} />
                  <Metric icon={Zap} label="Power" value={a.avg_power ? `${Math.round(a.avg_power)}` : null} unit="W" />
                  <Metric icon={Mountain} label="Ascent" value={fmt.elevation(a.total_ascent)} />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ActivityDetailDialog activityId={openId} onClose={() => {
        setOpenId(null);
        if (searchParams.get("activity")) {
          searchParams.delete("activity");
          setSearchParams(searchParams, { replace: true });
        }
      }} />
    </div>
  );
};

function ActivitiesBenchmarkPrompt({
  userId,
  planId,
  refreshKey,
  onDone,
}: {
  userId: string;
  planId: string | null;
  refreshKey: number;
  onDone: () => void;
}) {
  const [prompt, setPrompt] = useState<BenchmarkPrompt | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const from = new Date();
      from.setDate(from.getDate() - 7);
      const to = new Date();
      to.setDate(to.getDate() + 14);

      const scheduled = await getScheduledBenchmarksInRange(userId, isoDate(from), isoDate(to)).catch(() => []);
      if (scheduled.length === 0) {
        if (!cancelled) setPrompt(null);
        return;
      }

      const dates = Array.from(new Set(scheduled.map((b) => b.benchmark_date)));
      const sortedDates = dates.slice().sort();
      const activityFrom = new Date(`${sortedDates[0]}T12:00:00Z`);
      activityFrom.setUTCDate(activityFrom.getUTCDate() - 3);
      const activityTo = new Date(`${sortedDates[sortedDates.length - 1]}T12:00:00Z`);
      activityTo.setUTCDate(activityTo.getUTCDate() + 3);

      const [{ data: candidateActivities }, { data: rejections }, { data: confirmed }] = await Promise.all([
        supabase
          .from("activities")
          .select("id, start_time, duration_seconds, distance_meters, avg_heart_rate, activity_type")
          .eq("user_id", userId)
          .gte("start_time", activityFrom.toISOString())
          .lte("start_time", activityTo.toISOString()),
        supabase
          .from("benchmark_rejections" as any)
          .select("activity_id")
          .eq("user_id", userId),
        supabase
          .from("benchmark_results" as any)
          .select("benchmark_date")
          .eq("user_id", userId)
          .eq("status", "confirmed")
          .in("benchmark_date", dates),
      ]);

      if (cancelled) return;

      const rejectedIds = new Set<string>((rejections ?? []).map((r: any) => r.activity_id));
      const confirmedDates = new Set<string>((confirmed ?? []).map((r: any) => r.benchmark_date));
      const activityPool = (candidateActivities ?? []) as ActivityForDetection[];

      const prompts = scheduled
        .filter((b) => !confirmedDates.has(b.benchmark_date))
        .map((b) => ({
          isoDate: b.benchmark_date,
          protocol: b.benchmark_protocol,
          candidates: findBenchmarkCandidates({
            activities: activityPool,
            scheduledDateIso: b.benchmark_date,
            protocol: b.benchmark_protocol,
            rejectedIds,
          }),
        }))
        .filter((p) => p.candidates.length > 0)
        .sort((a, b) => a.candidates[0].hoursFromScheduled - b.candidates[0].hoursFromScheduled);

      setPrompt(prompts[0] ?? null);
    })();

    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  if (!prompt) return null;

  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div>
        <p className="text-sm font-semibold text-primary">Threshold run detected</p>
        <p className="text-xs text-muted-foreground">
          Confirm this activity to open the benchmark questions.
        </p>
      </div>
      <BenchmarkConfirmCard
        userId={userId}
        planId={planId}
        scheduledDateIso={prompt.isoDate}
        protocol={prompt.protocol}
        candidates={prompt.candidates}
        onDone={async () => onDone()}
      />
    </div>
  );
}

const Metric = ({ icon: Icon, label, value, unit }: { icon?: any; label: string; value: string | null; unit?: string }) => {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className="w-3 h-3 text-muted-foreground shrink-0" />}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">
          {value}
          {unit && <span className="text-xs text-muted-foreground ml-0.5">{unit}</span>}
        </p>
      </div>
    </div>
  );
};

function getTrainingEffectDescription(te: number): string {
  if (te < 2.0) return "Minor impact — helps recovery without significantly improving fitness.";
  if (te < 3.0) return "Maintaining your current aerobic fitness level.";
  if (te < 4.0) return "Improving your aerobic fitness — a solid, effective training session.";
  if (te < 5.0) return "Highly improving your fitness — a hard workout pushing your limits.";
  return "Overreaching — extreme effort, ensure adequate recovery.";
}

const isStrava = (a: any) => typeof a?.source_file === "string" && a.source_file.startsWith("strava:");

function dedupeActivities(list: any[]): any[] {
  // Group by start_time rounded to nearest 2 minutes; prefer FIT (non-strava) over Strava.
  const buckets = new Map<string, any[]>();
  const noTime: any[] = [];
  for (const a of list) {
    if (!a.start_time) { noTime.push(a); continue; }
    const t = new Date(a.start_time).getTime();
    const key = `${Math.round(t / 120000)}`;
    const arr = buckets.get(key) || [];
    arr.push(a);
    buckets.set(key, arr);
  }
  const kept: any[] = [...noTime];
  for (const arr of buckets.values()) {
    if (arr.length === 1) { kept.push(arr[0]); continue; }
    const hasFit = arr.some((a) => !isStrava(a));
    const filtered = hasFit ? arr.filter((a) => !isStrava(a)) : arr;
    kept.push(...filtered);
  }
  kept.sort((a, b) => new Date(b.start_time || 0).getTime() - new Date(a.start_time || 0).getTime());
  return kept;
}

export default Activities;
