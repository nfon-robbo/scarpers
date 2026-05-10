import { useState, useEffect } from "react";
import { useUnits, UnitPreferences } from "@/hooks/useUnits";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Ruler, Gauge, Mountain, Thermometer, Weight, Moon, RefreshCw, Loader2, Timer, CheckCircle2, AlertCircle, Apple, Copy, Check, User, Archive, Play, RotateCcw, Trash2, Shield, ChevronRight, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import IntervalsCredentials from "@/components/IntervalsCredentials";
import PastChats from "@/components/PastChats";
import CollapsibleSection from "@/components/CollapsibleSection";

interface UnitOption<K extends keyof UnitPreferences> {
  key: K;
  label: string;
  icon: any;
  description: string;
  options: { value: UnitPreferences[K]; label: string }[];
}

const unitSettings: UnitOption<keyof UnitPreferences>[] = [
  {
    key: "distance",
    label: "Distance",
    icon: Ruler,
    description: "Used for total distance, split distances",
    options: [
      { value: "km", label: "Kilometers (km)" },
      { value: "mi", label: "Miles (mi)" },
    ],
  },
  {
    key: "speed",
    label: "Speed / Pace",
    icon: Gauge,
    description: "Used for avg/max speed, split pace",
    options: [
      { value: "km/h", label: "km/h" },
      { value: "mph", label: "mph" },
      { value: "min/km", label: "min/km (pace)" },
      { value: "min/mi", label: "min/mi (pace)" },
    ],
  },
  {
    key: "elevation",
    label: "Elevation",
    icon: Mountain,
    description: "Used for ascent, descent, altitude",
    options: [
      { value: "m", label: "Meters (m)" },
      { value: "ft", label: "Feet (ft)" },
    ],
  },
  {
    key: "temperature",
    label: "Temperature",
    icon: Thermometer,
    description: "Used for avg temperature readings",
    options: [
      { value: "C", label: "Celsius (°C)" },
      { value: "F", label: "Fahrenheit (°F)" },
    ],
  },
  {
    key: "weight",
    label: "Weight",
    icon: Weight,
    description: "Used for body weight metrics",
    options: [
      { value: "kg", label: "Kilograms (kg)" },
      { value: "lbs", label: "Pounds (lbs)" },
      { value: "st", label: "Stone (st)" },
    ],
  },
  {
    key: "height",
    label: "Height",
    icon: Ruler,
    description: "Used for body height",
    options: [
      { value: "cm", label: "Centimeters (cm)" },
      { value: "ft", label: "Feet & inches (ft/in)" },
    ],
  },
];

interface SyncSchedule {
  strava_enabled: boolean;
  strava_interval_hours: number;
  intervals_enabled: boolean;
  intervals_interval_hours: number;
  google_fit_enabled: boolean;
  google_fit_hour_utc: number;
}

const defaultSchedule: SyncSchedule = {
  strava_enabled: false,
  strava_interval_hours: 2,
  intervals_enabled: false,
  intervals_interval_hours: 6,
  google_fit_enabled: false,
  google_fit_hour_utc: 8,
};

const Settings = () => {
  const { units, setUnit } = useUnits();
  const { user } = useAuth();
  const { profile, refresh: refreshProfile } = useProfile();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Personal details (always stored as cm/kg, displayed per unit prefs)
  const [personal, setPersonal] = useState({
    sex: "",
    date_of_birth: "",
    height_cm: "",
    weight_kg: "",
  });
  const [savingPersonal, setSavingPersonal] = useState(false);

  // Display fields driven by unit prefs
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weightDisplay, setWeightDisplay] = useState(""); // primary unit value (kg/lbs/st whole)
  const [weightStLb, setWeightStLb] = useState(""); // remainder lb when stone

  // Sync display fields when stored cm/kg or unit prefs change
  useEffect(() => {
    const cm = personal.height_cm ? Number(personal.height_cm) : null;
    if (cm == null) { setHeightFt(""); setHeightIn(""); return; }
    if (units.height === "ft") {
      const totalIn = cm * 0.393701;
      const ft = Math.floor(totalIn / 12);
      const inches = Math.round(totalIn - ft * 12);
      setHeightFt(String(ft));
      setHeightIn(String(inches));
    }
  }, [personal.height_cm, units.height]);

  useEffect(() => {
    const kg = personal.weight_kg ? Number(personal.weight_kg) : null;
    if (kg == null) { setWeightDisplay(""); setWeightStLb(""); return; }
    if (units.weight === "kg") {
      setWeightDisplay(String(kg));
    } else if (units.weight === "lbs") {
      setWeightDisplay((kg * 2.20462).toFixed(1));
    } else if (units.weight === "st") {
      const totalLb = kg * 2.20462;
      const st = Math.floor(totalLb / 14);
      const lb = +(totalLb - st * 14).toFixed(1);
      setWeightDisplay(String(st));
      setWeightStLb(String(lb));
    }
  }, [personal.weight_kg, units.weight]);

  const commitHeight = (ftStr: string, inStr: string) => {
    const ft = Number(ftStr) || 0;
    const inches = Number(inStr) || 0;
    if (!ftStr && !inStr) { setPersonal((p) => ({ ...p, height_cm: "" })); return; }
    const cm = (ft * 12 + inches) * 2.54;
    setPersonal((p) => ({ ...p, height_cm: cm.toFixed(1) }));
  };

  const commitWeight = (primary: string, lbRem: string = "") => {
    if (!primary && !lbRem) { setPersonal((p) => ({ ...p, weight_kg: "" })); return; }
    let kg = 0;
    if (units.weight === "kg") kg = Number(primary) || 0;
    else if (units.weight === "lbs") kg = (Number(primary) || 0) / 2.20462;
    else if (units.weight === "st") {
      const totalLb = (Number(primary) || 0) * 14 + (Number(lbRem) || 0);
      kg = totalLb / 2.20462;
    }
    setPersonal((p) => ({ ...p, weight_kg: kg ? kg.toFixed(2) : "" }));
  };

  useEffect(() => {
    if (profile) {
      setPersonal({
        sex: profile.sex ?? "",
        date_of_birth: profile.date_of_birth ?? "",
        height_cm: profile.height_cm != null ? String(profile.height_cm) : "",
        weight_kg: profile.weight_kg != null ? String(profile.weight_kg) : "",
      });
    }
  }, [profile]);

  const savePersonal = async () => {
    if (!user) return;
    setSavingPersonal(true);
    try {
      const { error } = await supabase.from("profiles").update({
        sex: personal.sex || null,
        date_of_birth: personal.date_of_birth || null,
        height_cm: personal.height_cm ? Number(personal.height_cm) : null,
        weight_kg: personal.weight_kg ? Number(personal.weight_kg) : null,
      }).eq("user_id", user.id);
      if (error) throw error;
      toast({ title: "Personal details saved" });
      refreshProfile();
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingPersonal(false);
    }
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/apple-health-sleep`;

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  // Auto-sync state
  const [schedule, setSchedule] = useState<SyncSchedule>(defaultSchedule);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [googleFitConnected, setGoogleFitConnected] = useState(false);
  const [scheduleLoaded, setScheduleLoaded] = useState(false);
  const navigate = useNavigate();

  // Previous (archived) plans
  type ArchivedPlan = {
    id: string;
    race_distance: string;
    start_date: string;
    race_date: string | null;
    training_days: string[];
    created_at: string;
    content: string;
  };
  const [archivedPlans, setArchivedPlans] = useState<ArchivedPlan[]>([]);
  const [planActionId, setPlanActionId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ArchivedPlan | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [confirmDeleteAccount, setConfirmDeleteAccount] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const bulkDeletePlans = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from("training_plans").delete().in("id", ids);
      if (error) throw error;
      toast({ title: `Deleted ${ids.length} plan${ids.length === 1 ? "" : "s"}` });
      setSelectedIds(new Set());
      setSelectMode(false);
      await loadArchivedPlans();
    } catch (e: any) {
      toast({ title: "Bulk delete failed", description: e.message, variant: "destructive" });
    } finally {
      setBulkDeleting(false);
      setConfirmBulkDelete(false);
    }
  };

  const loadArchivedPlans = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("training_plans")
      .select("id, race_distance, start_date, race_date, training_days, created_at, content")
      .eq("user_id", user.id)
      .eq("archived", true)
      .order("created_at", { ascending: false });
    setArchivedPlans((data as ArchivedPlan[]) || []);
  };

  useEffect(() => { loadArchivedPlans(); }, [user]);

  // Admin: AI provider settings
  const [isAdmin, setIsAdmin] = useState(false);
  const [aiProvider, setAiProvider] = useState<"lovable" | "claude">("lovable");
  const [claudeModel, setClaudeModel] = useState("claude-haiku-4-5");
  const [savingAi, setSavingAi] = useState(false);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [showEmails, setShowEmails] = useState(false);
  const [userEmails, setUserEmails] = useState<{ email: string; created_at: string }[] | null>(null);
  const [loadingEmails, setLoadingEmails] = useState(false);

  const toggleEmails = async () => {
    if (showEmails) { setShowEmails(false); return; }
    if (!userEmails) {
      setLoadingEmails(true);
      try {
        const { data, error } = await supabase.rpc("get_user_emails" as any);
        if (error) throw error;
        setUserEmails((data as any) || []);
      } catch (e: any) {
        toast({ title: "Failed to load emails", description: e.message, variant: "destructive" });
        return;
      } finally {
        setLoadingEmails(false);
      }
    }
    setShowEmails(true);
  };

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: roleRow } = await supabase
        .from("user_roles" as any)
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      setIsAdmin(!!roleRow);
      const { data: settings } = await supabase
        .from("app_settings" as any)
        .select("ai_provider, claude_model")
        .eq("id", 1)
        .maybeSingle();
      if (settings) {
        setAiProvider(((settings as any).ai_provider as "lovable" | "claude") ?? "lovable");
        setClaudeModel((settings as any).claude_model ?? "claude-haiku-4-5");
      }
      if (roleRow) {
        const { data: count } = await supabase.rpc("get_user_count" as any);
        if (typeof count === "number") setUserCount(count);
      }
    })();
  }, [user]);

  const saveAiSettings = async () => {
    setSavingAi(true);
    try {
      const { error } = await supabase
        .from("app_settings" as any)
        .update({ ai_provider: aiProvider, claude_model: claudeModel, updated_at: new Date().toISOString() })
        .eq("id", 1);
      if (error) throw error;
      toast({ title: "AI provider updated", description: `Now using ${aiProvider === "claude" ? `Claude (${claudeModel})` : "Lovable AI"} site-wide` });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSavingAi(false);
    }
  };

  const resumePlan = async (plan: ArchivedPlan) => {
    if (!user) return;
    setPlanActionId(plan.id);
    try {
      await supabase.from("training_plans").update({ archived: true })
        .eq("user_id", user.id).eq("archived", false);
      await supabase.from("training_plans").update({ archived: false }).eq("id", plan.id);
      toast({ title: "Plan resumed" });
      await loadArchivedPlans();
      navigate("/training-plan");
    } catch (e: any) {
      toast({ title: "Failed to resume", description: e.message, variant: "destructive" });
    } finally {
      setPlanActionId(null);
    }
  };

  const restartPlan = async (plan: ArchivedPlan) => {
    if (!user) return;
    setPlanActionId(plan.id);
    try {
      await supabase.from("training_plans").update({ archived: true })
        .eq("user_id", user.id).eq("archived", false);
      const today = new Date().toISOString().split("T")[0];
      await supabase.from("training_plans").insert({
        user_id: user.id,
        race_distance: plan.race_distance,
        training_days: plan.training_days,
        start_date: today,
        race_date: plan.race_date,
        content: plan.content,
      });
      toast({ title: "Plan restarted from today" });
      await loadArchivedPlans();
      navigate("/training-plan");
    } catch (e: any) {
      toast({ title: "Failed to restart", description: e.message, variant: "destructive" });
    } finally {
      setPlanActionId(null);
    }
  };

  const deletePlanForever = async (plan: ArchivedPlan) => {
    setPlanActionId(plan.id);
    try {
      await supabase.from("training_plans").delete().eq("id", plan.id);
      toast({ title: "Plan permanently deleted" });
      await loadArchivedPlans();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e.message, variant: "destructive" });
    } finally {
      setPlanActionId(null);
      setConfirmDelete(null);
    }
  };

  useEffect(() => {
    if (!user) return;
    // Load schedule and connection status in parallel
    const load = async () => {
      const [schedRes, stravaRes, gfRes] = await Promise.all([
        supabase.from("sync_schedules").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("strava_tokens").select("id").eq("user_id", user.id).maybeSingle(),
        supabase.from("google_fit_tokens").select("id").eq("user_id", user.id).maybeSingle(),
      ]);
      if (schedRes.data) {
        setSchedule({
          strava_enabled: schedRes.data.strava_enabled,
          strava_interval_hours: schedRes.data.strava_interval_hours,
          intervals_enabled: schedRes.data.intervals_enabled,
          intervals_interval_hours: schedRes.data.intervals_interval_hours,
          google_fit_enabled: schedRes.data.google_fit_enabled,
          google_fit_hour_utc: schedRes.data.google_fit_hour_utc,
        });
      }
      setStravaConnected(!!stravaRes.data);
      setGoogleFitConnected(!!gfRes.data);
      setScheduleLoaded(true);
    };
    load();
  }, [user]);

  const saveSchedule = async () => {
    if (!user) return;
    setSavingSchedule(true);
    try {
      const { data: existing } = await supabase
        .from("sync_schedules").select("id").eq("user_id", user.id).maybeSingle();

      if (existing) {
        await supabase.from("sync_schedules").update(schedule).eq("user_id", user.id);
      } else {
        await supabase.from("sync_schedules").insert({ user_id: user.id, ...schedule });
      }
      toast({ title: "Auto-sync schedule saved" });
    } catch (e: any) {
      toast({ title: "Failed to save schedule", description: e.message, variant: "destructive" });
    } finally {
      setSavingSchedule(false);
    }
  };

  const syncWellness = async () => {
    if (!user) return;
    setSyncing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast({ title: "Session expired", variant: "destructive" });
        return;
      }

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intervals-wellness`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({}),
        }
      );

      const data = await resp.json();

      if (!resp.ok) {
        toast({ title: "Sync failed", description: data.error, variant: "destructive" });
        return;
      }

      toast({
        title: "Wellness data synced",
        description: `${data.synced} days updated from Intervals.icu (last 90 days)`,
      });
    } catch (e: any) {
      toast({ title: "Sync failed", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const formatHourUtc = (hour: number) => {
    const date = new Date();
    date.setUTCHours(hour, 0, 0, 0);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Customize how your data is displayed</p>
      </div>

      {isAdmin && (
        <Link to="/admin" className="block">
          <Card className="hover:border-primary/40 transition-colors cursor-pointer">
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-lg">Admin</CardTitle>
                  <p className="text-sm text-muted-foreground">Site analytics, users, plans, AI usage</p>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
      )}

      {isAdmin && (
        <CollapsibleSection
          title="AI Provider"
          icon={Gauge}
          description="Switch the AI engine used site-wide for plan generation, chat, reviews and insights."
          headerExtra={<Badge variant="secondary">Admin</Badge>}
          contentClassName="space-y-4"
        >
          <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Registered users</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{userCount ?? "—"}</span>
                <Button size="sm" variant="ghost" onClick={toggleEmails} disabled={loadingEmails}>
                  {loadingEmails ? <Loader2 className="w-3 h-3 animate-spin" /> : showEmails ? "Hide" : "Show"}
                </Button>
              </div>
            </div>
            {showEmails && userEmails && (
              <ul className="text-xs space-y-1 max-h-60 overflow-auto pt-1 border-t border-border/50">
                {userEmails.map((u, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">{u.email}</span>
                    <span className="text-muted-foreground shrink-0">{new Date(u.created_at).toLocaleDateString("en-GB")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-2">
            <Label>Provider</Label>
            <Select value={aiProvider} onValueChange={(v) => setAiProvider(v as "lovable" | "claude")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lovable">Lovable AI (Gemini / GPT)</SelectItem>
                <SelectItem value="claude">Anthropic Claude</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {aiProvider === "claude" && (
            <div className="space-y-2">
              <Label>Claude model</Label>
              <Select value={claudeModel} onValueChange={setClaudeModel}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-haiku-4-5">Claude Haiku 4.5 (fast, cheap)</SelectItem>
                  <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5 (balanced)</SelectItem>
                  <SelectItem value="claude-opus-4-5">Claude Opus 4.5 (most capable)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex justify-end">
            <Button onClick={saveAiSettings} disabled={savingAi}>
              {savingAi ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save provider
            </Button>
          </div>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Personal Details"
        icon={User}
        description="Used to personalise your AI training plan (HR zones, pacing, calories)"
        contentClassName="space-y-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="sex">Sex</Label>
            <Select value={personal.sex || undefined} onValueChange={(v) => setPersonal((p) => ({ ...p, sex: v }))}>
              <SelectTrigger id="sex"><SelectValue placeholder="Select" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="other">Other / prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dob">Date of birth</Label>
            <Input
              id="dob"
              type="date"
              value={personal.date_of_birth}
              onChange={(e) => setPersonal((p) => ({ ...p, date_of_birth: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Height {units.height === "ft" ? "(ft / in)" : "(cm)"}</Label>
            {units.height === "ft" ? (
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="8"
                  placeholder="ft"
                  value={heightFt}
                  onChange={(e) => { setHeightFt(e.target.value); commitHeight(e.target.value, heightIn); }}
                />
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="11"
                  placeholder="in"
                  value={heightIn}
                  onChange={(e) => { setHeightIn(e.target.value); commitHeight(heightFt, e.target.value); }}
                />
              </div>
            ) : (
              <Input
                type="number"
                inputMode="decimal"
                min="50"
                max="250"
                value={personal.height_cm}
                onChange={(e) => setPersonal((p) => ({ ...p, height_cm: e.target.value }))}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>Weight {units.weight === "kg" ? "(kg)" : units.weight === "lbs" ? "(lbs)" : "(st / lb)"}</Label>
            {units.weight === "st" ? (
              <div className="flex gap-2">
                <Input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  placeholder="st"
                  value={weightDisplay}
                  onChange={(e) => { setWeightDisplay(e.target.value); commitWeight(e.target.value, weightStLb); }}
                />
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="13.9"
                  step="0.1"
                  placeholder="lb"
                  value={weightStLb}
                  onChange={(e) => { setWeightStLb(e.target.value); commitWeight(weightDisplay, e.target.value); }}
                />
              </div>
            ) : (
              <Input
                type="number"
                inputMode="decimal"
                min="20"
                max="600"
                step="0.1"
                value={weightDisplay}
                onChange={(e) => { setWeightDisplay(e.target.value); commitWeight(e.target.value); }}
              />
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={savePersonal} disabled={savingPersonal} size="sm">
            {savingPersonal ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            {savingPersonal ? "Saving..." : "Save Details"}
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Units of Measurement"
        icon={Ruler}
        description="Choose your preferred units for each metric type"
        contentClassName="space-y-6"
      >
        {unitSettings.map(({ key, label, icon: Icon, description, options }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Icon className="w-5 h-5 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
              </div>
            </div>
            <Select
              value={units[key]}
              onValueChange={(v) => setUnit(key, v as any)}
            >
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CollapsibleSection>

      {/* Previous Plans */}
      <CollapsibleSection
        title="Previous Plans"
        icon={Archive}
        description="Plans you've deleted or replaced. Resume to continue from where you left off, or restart from today."
      >
        {archivedPlans.length === 0 ? (
          <p className="text-sm text-muted-foreground">No previous plans yet.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant={selectMode ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => {
                    setSelectMode((v) => !v);
                    setSelectedIds(new Set());
                  }}
                >
                  {selectMode ? "Cancel" : "Select"}
                </Button>
                {selectMode && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (selectedIds.size === archivedPlans.length) {
                        setSelectedIds(new Set());
                      } else {
                        setSelectedIds(new Set(archivedPlans.map((p) => p.id)));
                      }
                    }}
                  >
                    {selectedIds.size === archivedPlans.length ? "Clear all" : "Select all"}
                  </Button>
                )}
              </div>
              {selectMode && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={selectedIds.size === 0 || bulkDeleting}
                  onClick={() => setConfirmBulkDelete(true)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Delete {selectedIds.size > 0 ? `(${selectedIds.size})` : ""}
                </Button>
              )}
            </div>
            {archivedPlans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                {selectMode && (
                  <Checkbox
                    checked={selectedIds.has(plan.id)}
                    onCheckedChange={() => toggleSelected(plan.id)}
                    aria-label="Select plan"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{plan.race_distance}</p>
                  <p className="text-xs text-muted-foreground">
                    Started {new Date(plan.start_date).toLocaleDateString("en-GB")}
                    {plan.race_date && plan.race_date !== "ai-recommend" && (
                      <> · Race {new Date(plan.race_date).toLocaleDateString("en-GB")}</>
                    )}
                    {" · "}{plan.training_days.length} day{plan.training_days.length === 1 ? "" : "s"}/wk
                  </p>
                </div>
                {!selectMode && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resumePlan(plan)}
                      disabled={planActionId === plan.id}
                    >
                      <Play className="w-3.5 h-3.5 mr-1" /> Resume
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => restartPlan(plan)}
                      disabled={planActionId === plan.id}
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restart
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmDelete(plan)}
                      disabled={planActionId === plan.id}
                      aria-label="Delete permanently"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* Previous Chats */}
      <CollapsibleSection
        title="Previous chats"
        icon={MessageCircle}
        description="Resume a past conversation with the AI coach."
      >
        <PastChats bare />
      </CollapsibleSection>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete plan permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the plan from Previous Plans for good. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && deletePlanForever(confirmDelete)}>
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBulkDelete} onOpenChange={(o) => !o && setConfirmBulkDelete(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedIds.size} plan{selectedIds.size === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected plans. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={bulkDeletePlans} disabled={bulkDeleting}>
              {bulkDeleting ? "Deleting…" : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <IntervalsCredentials />

      {/* Auto-Sync Schedule Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Timer className="w-5 h-5" />
            Auto-Sync Schedule
          </CardTitle>
          <CardDescription>
            Enable automatic background syncing for your connected data sources
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Strava */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">
                <Switch
                  checked={schedule.strava_enabled}
                  onCheckedChange={(v) => setSchedule((s) => ({ ...s, strava_enabled: v }))}
                  disabled={!stravaConnected}
                />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Strava Activities</p>
                  {!stravaConnected && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <AlertCircle className="w-3 h-3" /> Not connected
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Import new activities automatically</p>
              </div>
            </div>
            <Select
              value={String(schedule.strava_interval_hours)}
              onValueChange={(v) => setSchedule((s) => ({ ...s, strava_interval_hours: Number(v) }))}
              disabled={!schedule.strava_enabled}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Every 1 hour</SelectItem>
                <SelectItem value="2">Every 2 hours</SelectItem>
                <SelectItem value="4">Every 4 hours</SelectItem>
                <SelectItem value="6">Every 6 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Intervals.icu */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">
                <Switch
                  checked={schedule.intervals_enabled}
                  onCheckedChange={(v) => setSchedule((s) => ({ ...s, intervals_enabled: v }))}
                />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium">Intervals.icu Wellness</p>
                <p className="text-xs text-muted-foreground">Sync HRV, resting HR, steps, weight & more</p>
              </div>
            </div>
            <Select
              value={String(schedule.intervals_interval_hours)}
              onValueChange={(v) => setSchedule((s) => ({ ...s, intervals_interval_hours: Number(v) }))}
              disabled={!schedule.intervals_enabled}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4">Every 4 hours</SelectItem>
                <SelectItem value="6">Every 6 hours</SelectItem>
                <SelectItem value="12">Every 12 hours</SelectItem>
                <SelectItem value="24">Every 24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Google Fit */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">
                <Switch
                  checked={schedule.google_fit_enabled}
                  onCheckedChange={(v) => setSchedule((s) => ({ ...s, google_fit_enabled: v }))}
                  disabled={!googleFitConnected}
                />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">Google Fit Sleep</p>
                  {!googleFitConnected && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <AlertCircle className="w-3 h-3" /> Not connected
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">Sync sleep stages once daily</p>
              </div>
            </div>
            <Select
              value={String(schedule.google_fit_hour_utc)}
              onValueChange={(v) => setSchedule((s) => ({ ...s, google_fit_hour_utc: Number(v) }))}
              disabled={!schedule.google_fit_enabled}
            >
              <SelectTrigger className="w-36">
                <SelectValue placeholder="Time">
                  {formatHourUtc(schedule.google_fit_hour_utc)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {[5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {formatHourUtc(h)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-2 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Syncs run automatically in the background. You can still trigger manual syncs anytime.
            </p>
            <Button onClick={saveSchedule} disabled={savingSchedule} size="sm">
              {savingSchedule ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
              {savingSchedule ? "Saving..." : "Save & Apply"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Moon className="w-5 h-5" />
            Sleep & Wellness Sync
          </CardTitle>
          <CardDescription>
            Sync sleep, steps, HRV, resting HR, and weight from Intervals.icu (last 90 days)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={syncWellness} disabled={syncing}>
            {syncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            {syncing ? "Syncing..." : "Sync Wellness Data"}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Pulls sleep duration, sleep score, HRV, resting heart rate, steps, weight, and stress data.
          </p>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            Danger Zone
          </CardTitle>
          <CardDescription>
            Permanently delete your account and all associated data. This cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setConfirmDeleteAccount(true)}>
            <Trash2 className="w-4 h-4 mr-2" />
            Delete My Profile
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmDeleteAccount} onOpenChange={(o) => !o && setConfirmDeleteAccount(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your profile, training plans, activities, sleep data, integrations, and login. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAccount}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingAccount}
              onClick={async (e) => {
                e.preventDefault();
                setDeletingAccount(true);
                try {
                  const { data: { session } } = await supabase.auth.getSession();
                  if (!session) throw new Error("Not signed in");
                  const resp = await fetch(
                    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session.access_token}`,
                        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                      },
                    }
                  );
                  const data = await resp.json();
                  if (!resp.ok) throw new Error(data.error || "Failed");
                  await supabase.auth.signOut();
                  toast({ title: "Account deleted" });
                  navigate("/auth");
                } catch (err: any) {
                  toast({ title: "Delete failed", description: err.message, variant: "destructive" });
                  setDeletingAccount(false);
                  setConfirmDeleteAccount(false);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAccount ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
              {deletingAccount ? "Deleting..." : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};

export default Settings;
