import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Heart, Timer, Zap, TrendingUp, Mountain, Gauge } from "lucide-react";

const Activities = () => {
  const { user } = useAuth();
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("activities")
      .select("*")
      .eq("user_id", user.id)
      .order("start_time", { ascending: false })
      .then(({ data }) => {
        setActivities(data || []);
        setLoading(false);
      });
  }, [user]);

  const fmt = (seconds: number | null) => {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
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
          {activities.map((a) => (
            <Card key={a.id} className="hover:shadow-sm transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">
                        {a.start_time
                          ? new Date(a.start_time).toLocaleDateString(undefined, {
                              weekday: "short", year: "numeric", month: "short", day: "numeric",
                            })
                          : "Unknown date"}
                      </span>
                      {a.activity_type && (
                        <Badge variant="secondary" className="capitalize text-xs">
                          {a.activity_type}
                        </Badge>
                      )}
                      {a.training_effect && (
                        <Badge variant="outline" className="text-xs">
                          TE {Number(a.training_effect).toFixed(1)}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{a.source_file}</p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {a.start_time && new Date(a.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-3">
                  <Metric icon={Timer} label="Duration" value={fmt(a.duration_seconds)} />
                  <Metric icon={Heart} label="Avg HR" value={a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)}` : null} unit="bpm" />
                  <Metric icon={Heart} label="Max HR" value={a.max_heart_rate ? `${Math.round(a.max_heart_rate)}` : null} unit="bpm" />
                  <Metric icon={TrendingUp} label="Speed" value={a.avg_speed ? `${Number(a.avg_speed).toFixed(1)}` : null} unit="km/h" />
                  <Metric icon={Zap} label="Power" value={a.avg_power ? `${Math.round(a.avg_power)}` : null} unit="W" />
                  <Metric icon={Mountain} label="Ascent" value={a.total_ascent ? `${Math.round(a.total_ascent)}` : null} unit="m" />
                </div>

                {(a.avg_cadence || a.calories || a.distance_meters) && (
                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-2">
                    <Metric icon={Gauge} label="Cadence" value={a.avg_cadence ? `${Math.round(a.avg_cadence)}` : null} unit="rpm" />
                    <Metric label="Calories" value={a.calories ? `${Math.round(a.calories)}` : null} unit="kcal" />
                    <Metric label="Distance" value={a.distance_meters ? `${(a.distance_meters / 1000).toFixed(1)}` : null} unit="km" />
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

const Metric = ({ icon: Icon, label, value, unit }: { icon?: any; label: string; value: string | null; unit?: string }) => {
  if (!value) return <div />;
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

export default Activities;
