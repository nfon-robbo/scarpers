import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Heart, Timer, Zap, TrendingUp } from "lucide-react";

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

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${s}s`;
  };

  const formatSpeed = (speed: number | null) => {
    if (!speed) return null;
    return `${speed.toFixed(1)} km/h`;
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
            <Card key={a.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">
                        {a.start_time
                          ? new Date(a.start_time).toLocaleDateString(undefined, {
                              weekday: "short", year: "numeric", month: "short", day: "numeric",
                            })
                          : "Unknown date"}
                      </span>
                      {a.activity_type && (
                        <Badge variant="secondary" className="capitalize">
                          {a.activity_type}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.source_file}</p>
                  </div>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {a.start_time && new Date(a.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                  <Metric icon={Timer} label="Duration" value={formatDuration(a.duration_seconds)} />
                  <Metric icon={Heart} label="Avg HR" value={a.avg_heart_rate ? `${Math.round(a.avg_heart_rate)} bpm` : null} />
                  <Metric icon={TrendingUp} label="Avg Speed" value={formatSpeed(a.avg_speed)} />
                  <Metric icon={Zap} label="Avg Power" value={a.avg_power ? `${Math.round(a.avg_power)} W` : null} />
                </div>

                {(a.max_heart_rate || a.calories || a.total_ascent != null) && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
                    <Metric label="Max HR" value={a.max_heart_rate ? `${Math.round(a.max_heart_rate)} bpm` : null} />
                    <Metric label="Calories" value={a.calories ? `${Math.round(a.calories)} kcal` : null} />
                    <Metric label="Ascent" value={a.total_ascent ? `${Math.round(a.total_ascent)} m` : null} />
                    <Metric label="Cadence" value={a.avg_cadence ? `${Math.round(a.avg_cadence)} rpm` : null} />
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

const Metric = ({ icon: Icon, label, value }: { icon?: any; label: string; value: string | null }) => {
  if (!value) return <div />;
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon className="w-3.5 h-3.5 text-muted-foreground" />}
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
};

export default Activities;
