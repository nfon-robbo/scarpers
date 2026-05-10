import { useEffect, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, ArrowLeft, ExternalLink } from "lucide-react";

type Stats = {
  total_users: number;
  new_today: number;
  new_this_week: number;
  new_this_month: number;
  active_week: number;
  active_month: number;
  intervals_connected: number;
  strava_connected: number;
  google_fit_connected: number;
  total_plans_active: number;
  total_plans_all: number;
  plans_by_distance: Record<string, number>;
  plans_by_week: Record<string, number>;
  strava_synced_7d: number;
  intervals_synced_7d: number;
  google_fit_synced_7d: number;
  activities_total: number;
  activities_7d: number;
};

const Stat = ({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) => (
  <div className="rounded-xl border border-border/50 p-4 bg-card/60">
    <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
    <p className="text-2xl font-semibold mt-1">{value}</p>
    {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
  </div>
);

const NotTracked = ({ note }: { note?: string }) => (
  <div className="rounded-xl border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
    Not yet tracked{note ? ` — ${note}` : ""}.
  </div>
);

const AdminPage = () => {
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [checked, setChecked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // AI Provider
  const [aiProvider, setAiProvider] = useState<"lovable" | "claude">("lovable");
  const [claudeModel, setClaudeModel] = useState("claude-haiku-4-5");
  const [savingAi, setSavingAi] = useState(false);

  // Sitemap
  const sitemapUrl = `${window.location.origin}/sitemap.xml`;

  useEffect(() => {
    if (authLoading) return;
    (async () => {
      if (!user) { setChecked(true); return; }
      const { data, error } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin");
      if (error) console.error("admin role check failed", error);
      const adminRow = Array.isArray(data) && data.length > 0;
      setIsAdmin(adminRow);
      setChecked(true);

      if (adminRow) {
        const { data: settings } = await supabase
          .from("app_settings" as any)
          .select("ai_provider, claude_model")
          .eq("id", 1)
          .maybeSingle();
        if (settings) {
          setAiProvider(((settings as any).ai_provider as "lovable" | "claude") ?? "lovable");
          setClaudeModel((settings as any).claude_model ?? "claude-haiku-4-5");
        }
        loadStats();
      }
    })();
  }, [user]);

  const loadStats = async () => {
    setLoadingStats(true);
    try {
      const { data, error } = await supabase.rpc("admin_dashboard_stats" as any);
      if (error) throw error;
      setStats(data as unknown as Stats);
    } catch (e: any) {
      toast({ title: "Failed to load stats", description: e.message, variant: "destructive" });
    } finally {
      setLoadingStats(false);
    }
  };

  const saveAi = async () => {
    setSavingAi(true);
    try {
      const { error } = await supabase
        .from("app_settings" as any)
        .update({ ai_provider: aiProvider, claude_model: claudeModel, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
      toast({ title: "AI provider updated" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingAi(false);
    }
  };

  if (authLoading || !checked) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!user) return <Navigate to="/auth" replace />;
  if (!isAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/dashboard"><ArrowLeft className="w-4 h-4 mr-1" /> Back</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Admin
            </h1>
            <p className="text-sm text-muted-foreground">Site-wide settings and analytics</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadStats} disabled={loadingStats}>
          {loadingStats ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="plans">Plans</TabsTrigger>
          <TabsTrigger value="ai">AI Usage</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Total users" value={stats?.total_users ?? "—"} />
            <Stat label="New today" value={stats?.new_today ?? "—"} />
            <Stat label="Active (7d)" value={stats?.active_week ?? "—"} />
            <Stat label="Active (30d)" value={stats?.active_month ?? "—"} />
            <Stat label="Active plans" value={stats?.total_plans_active ?? "—"} />
            <Stat label="Activities (7d)" value={stats?.activities_7d ?? "—"} />
            <Stat label="Strava connected" value={stats?.strava_connected ?? "—"} />
            <Stat label="Intervals connected" value={stats?.intervals_connected ?? "—"} />
          </div>
        </TabsContent>

        {/* Users */}
        <TabsContent value="users" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>User Management</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Total registered" value={stats?.total_users ?? "—"} />
                <Stat label="New today" value={stats?.new_today ?? "—"} />
                <Stat label="New this week" value={stats?.new_this_week ?? "—"} />
                <Stat label="New this month" value={stats?.new_this_month ?? "—"} />
                <Stat label="Active this week" value={stats?.active_week ?? "—"} hint="Logged ≥1 activity in 7d" />
                <Stat label="Active this month" value={stats?.active_month ?? "—"} hint="Logged ≥1 activity in 30d" />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Users by plan stage</h3>
                {stats?.plans_by_week && Object.keys(stats.plans_by_week).length ? (
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {Object.entries(stats.plans_by_week)
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([week, c]) => (
                        <div key={week} className="rounded-lg border border-border/50 p-3 text-center">
                          <p className="text-xs text-muted-foreground">Week {week}</p>
                          <p className="text-xl font-semibold">{c}</p>
                        </div>
                      ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No active plans yet.</p>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Plans */}
        <TabsContent value="plans" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Plan Analytics</CardTitle>
              <CardDescription>{stats?.total_plans_all ?? 0} total plans generated</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h3 className="text-sm font-medium mb-2">By race distance</h3>
                {stats?.plans_by_distance && Object.keys(stats.plans_by_distance).length ? (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(stats.plans_by_distance)
                      .sort((a, b) => b[1] - a[1])
                      .map(([d, c]) => (
                        <Badge key={d} variant="secondary" className="text-sm py-1.5 px-3">
                          {d}: <span className="ml-1 font-semibold">{c}</span>
                        </Badge>
                      ))}
                  </div>
                ) : <p className="text-sm text-muted-foreground">No plans yet.</p>}
                {stats?.plans_by_distance && Object.keys(stats.plans_by_distance).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Most generated: <strong>{Object.entries(stats.plans_by_distance).sort((a,b)=>b[1]-a[1])[0][0]}</strong>
                  </p>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Completion rates by week</h3>
                <NotTracked note="add a plan_completion table to record per-week completion" />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Most common injury flags</h3>
                <NotTracked note="injuries are stored as free-text in athlete_context" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI */}
        <TabsContent value="ai" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Usage & Cost</CardTitle>
              <CardDescription>Monitor API spend</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <NotTracked note="add an ai_usage_log table that records each call's tokens & estimated cost" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 opacity-60">
                <Stat label="API calls today" value="—" />
                <Stat label="API calls this month" value="—" />
                <Stat label="Tokens used" value="—" />
                <Stat label="Est. cost" value="—" />
                <Stat label="Avg tokens / plan" value="—" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Integrations */}
        <TabsContent value="integrations" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Intervals.icu</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="Connected accounts" value={stats?.intervals_connected ?? "—"} />
                <Stat label="Synced (7d)" value={stats?.intervals_synced_7d ?? "—"} hint="Schedules with recent sync" />
                <Stat label="Failed syncs" value="—" hint="Not yet tracked" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Strava</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="Connected accounts" value={stats?.strava_connected ?? "—"} />
                <Stat label="Synced (7d)" value={stats?.strava_synced_7d ?? "—"} />
                <Stat label="Failed syncs" value="—" hint="Not yet tracked" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Google Fit</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <Stat label="Connected accounts" value={stats?.google_fit_connected ?? "—"} />
                <Stat label="Synced (7d)" value={stats?.google_fit_synced_7d ?? "—"} />
                <Stat label="Failed syncs" value="—" hint="Not yet tracked" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Health */}
        <TabsContent value="health" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>System Health</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h3 className="text-sm font-medium mb-2">API response times</h3>
                <NotTracked note="available in Lovable Cloud edge function logs" />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Error logs</h3>
                <NotTracked note="available in Lovable Cloud edge function logs" />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Failed plan generations</h3>
                <NotTracked note="add a plan_generation_log table to capture failures" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Content */}
        <TabsContent value="content" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Content / Plan</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h3 className="text-sm font-medium mb-2">Most viewed sessions</h3>
                <NotTracked note="add session_views tracking on plan day open" />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Most skipped sessions</h3>
                <NotTracked note="needs a skip_reason capture in workout flow" />
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">User feedback / RPE</h3>
                <NotTracked note="add an rpe column to activities or a feedback table" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Settings */}
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Site Map</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 flex-wrap">
                <Input readOnly value={sitemapUrl} className="max-w-md font-mono text-sm" />
                <Button variant="outline" size="sm" asChild>
                  <a href={sitemapUrl} target="_blank" rel="noopener noreferrer">
                    Open <ExternalLink className="w-3 h-3 ml-1" />
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>AI Provider</CardTitle>
              <CardDescription>Site-wide model used by the coach</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lovable">Lovable AI Gateway</SelectItem>
                    <SelectItem value="claude">Anthropic Claude (direct)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {aiProvider === "claude" && (
                <div className="space-y-2">
                  <Label>Claude model</Label>
                  <Input value={claudeModel} onChange={(e) => setClaudeModel(e.target.value)} />
                </div>
              )}
              <Button onClick={saveAi} disabled={savingAi}>
                {savingAi ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AdminPage;
