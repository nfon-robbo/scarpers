import { useEffect, useState, lazy, Suspense } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useUnits } from "@/hooks/useUnits";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Heart, Timer, Zap, TrendingUp, Mountain, Gauge,
  Trash2, ChevronDown, ChevronUp, MapPin,
} from "lucide-react";
import ActivityMap from "@/components/ActivityMap";
import ActivityCharts from "@/components/ActivityCharts";

const Activities = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { fmt, label } = useUnits();
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [togglingPlan, setTogglingPlan] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    // Fetch activities and current plan in parallel
    Promise.all([
      supabase
        .from("activities")
        .select("*")
        .eq("user_id", user.id)
        .order("start_time", { ascending: false }),
      supabase
        .from("training_plans")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]).then(([activitiesRes, planRes]) => {
      setActivities(activitiesRes.data || []);
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Activities</h1>
        <p className="text-muted-foreground mt-1">{activities.length} activities imported</p>
      </div>

      {activities.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No activities yet. Upload FIT files to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {activities.map((a) => {
            const isExpanded = expandedId === a.id;
            return (
              <Card key={a.id} className="hover:shadow-sm transition-shadow">
                <CardContent className="p-4">
                  {/* Header row */}
                  <div className="flex items-start justify-between gap-4">
                    <button
                      className="flex-1 text-left cursor-pointer"
                      onClick={() => setExpandedId(isExpanded ? null : a.id)}
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
                            <TooltipTrigger>
                              <span className="cursor-help">
                                <Badge variant="outline" className="text-xs">TE {Number(a.training_effect).toFixed(1)}</Badge>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs text-xs">
                              <p className="font-semibold mb-1">Training Effect ({Number(a.training_effect).toFixed(1)})</p>
                              <p>{getTrainingEffectDescription(Number(a.training_effect))}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{a.source_file}</p>
                    </button>

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

                  {/* Summary metrics (always visible) */}
                  <div className="grid grid-cols-3 sm:grid-cols-7 gap-3 mt-3">
                    <Metric icon={TrendingUp} label="Distance" value={fmt.distance(a.distance_meters ?? (a.avg_speed && a.duration_seconds ? (a.avg_speed / 3.6 * a.duration_seconds) : null))} />
                    <Metric icon={Timer} label="Duration" value={fmtDuration(a.duration_seconds)} />
                    <Metric icon={Heart} label="Avg HR" value={a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)}` : null} unit="bpm" />
                    <Metric icon={Heart} label="Max HR" value={a.max_heart_rate ? `${Math.round(a.max_heart_rate)}` : null} unit="bpm" />
                    <Metric icon={TrendingUp} label="Speed" value={fmt.speed(a.avg_speed)} />
                    <Metric icon={Zap} label="Power" value={a.avg_power ? `${Math.round(a.avg_power)}` : null} unit="W" />
                    <Metric icon={Mountain} label="Ascent" value={fmt.elevation(a.total_ascent)} />
                  </div>

                  {/* Expanded detail view */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-4">
                      {/* GPS Route Map or single-point map */}
                      {a.raw_data?.gps_track && Array.isArray(a.raw_data.gps_track) && a.raw_data.gps_track.length >= 2 ? (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> Route Map
                          </p>
                          <ActivityMap track={a.raw_data.gps_track} />
                        </div>
                      ) : a.latitude && a.longitude && Math.abs(a.latitude) > 0.01 && Math.abs(a.longitude) > 0.01 ? (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider flex items-center gap-1">
                            <MapPin className="w-3 h-3" /> Location
                          </p>
                          <ActivityMap track={[{ lat: a.latitude, lng: a.longitude }]} />
                        </div>
                      ) : null}

                      {/* Performance Charts */}
                      {a.raw_data?.gps_track && Array.isArray(a.raw_data.gps_track) && a.raw_data.gps_track.length >= 10 && (
                        <ActivityCharts
                          track={a.raw_data.gps_track}
                          avgHR={a.avg_heart_rate}
                          maxHR={a.max_heart_rate}
                        />
                      )}

                      {/* All parsed fields */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <DetailField label="Distance" value={fmt.distance(a.distance_meters)} />
                        <DetailField label="Duration" value={fmtDuration(a.duration_seconds, true)} />
                        <DetailField label="Avg Heart Rate" value={a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)} bpm` : null} />
                        <DetailField label="Max Heart Rate" value={a.max_heart_rate ? `${Math.round(a.max_heart_rate)} bpm` : null} />
                        <DetailField label="Avg Speed" value={fmt.speed(a.avg_speed)} />
                        <DetailField label="Max Speed" value={fmt.speed(a.max_speed)} />
                        <DetailField label="Avg Power" value={a.avg_power ? `${Math.round(a.avg_power)} W` : null} />
                        <DetailField label="Max Power" value={a.max_power ? `${Math.round(a.max_power)} W` : null} />
                        <DetailField label="Avg Cadence" value={a.avg_cadence ? `${Math.round(a.avg_cadence)} rpm` : null} />
                        <DetailField label="Steps" value={(() => {
                          const stepLen = a.raw_data?.avg_step_length;
                          if (stepLen && a.distance_meters) return `${Math.round(a.distance_meters / (stepLen / 1000))}`;
                          if (a.avg_cadence && a.duration_seconds) return `${Math.round(a.avg_cadence * (a.duration_seconds / 60))}`;
                          return null;
                        })()} />
                        <DetailField label="Total Ascent" value={fmt.elevation(a.total_ascent)} />
                        <DetailField label="Total Descent" value={fmt.elevation(a.total_descent)} />
                        <DetailField label="Calories" value={a.calories ? `${Math.round(a.calories)} kcal` : null} />
                        <DetailField label="Avg Temperature" value={fmt.temperature(a.avg_temperature)} />
                        <DetailField label="Training Effect" value={a.training_effect ? `${Number(a.training_effect).toFixed(1)}` : null} tooltip={a.training_effect ? getTrainingEffectDescription(Number(a.training_effect)) : undefined} />
                        <DetailField label="Training Load" value={a.training_load ? `${Math.round(a.training_load)}` : null} />
                        <DetailField label="Activity Type" value={a.activity_type || null} />
                      </div>

                      {/* Raw FIT data */}
                      {a.raw_data && typeof a.raw_data === "object" && Object.keys(a.raw_data).length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">Raw FIT File Data</p>
                          <div className="rounded-lg bg-muted/50 p-4 overflow-auto max-h-96">
                            <RawDataDisplay data={a.raw_data} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

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

const DetailField = ({ label, value, tooltip }: { label: string; value: string | null; tooltip?: string }) => {
  if (!value) return null;
  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="cursor-help">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-sm font-semibold">{value}</p>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-xs">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
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

const RawDataDisplay = ({ data }: { data: any }) => {
  if (typeof data !== "object" || data === null) {
    return <span className="text-xs text-muted-foreground">{String(data)}</span>;
  }

  const entries = Object.entries(data).filter(
    ([_, v]) => v !== null && v !== undefined && v !== ""
  );

  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5">
      {entries.map(([key, val]) => {
        const displayKey = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        let displayVal: string;

        if (typeof val === "object" && val !== null) {
          displayVal = JSON.stringify(val);
        } else if (typeof val === "number") {
          displayVal = Number.isInteger(val) ? String(val) : Number(val).toFixed(2);
        } else if (typeof val === "boolean") {
          displayVal = val ? "Yes" : "No";
        } else {
          displayVal = String(val);
          // Try to format dates
          if (/^\d{4}-\d{2}-\d{2}/.test(displayVal)) {
            try {
              displayVal = new Date(displayVal).toLocaleString();
            } catch {}
          }
        }

        return (
          <div key={key} className="flex justify-between gap-2 py-0.5">
            <span className="text-xs text-muted-foreground truncate">{displayKey}</span>
            <span className="text-xs font-mono text-foreground text-right truncate max-w-[60%]">{displayVal}</span>
          </div>
        );
      })}
    </div>
  );
};

export default Activities;
