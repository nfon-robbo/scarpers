import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Plus, Pencil, Trash2, Upload, Sparkles } from "lucide-react";
import { format, parseISO, subDays } from "date-fns";
import { toast } from "sonner";

type StageTotals = { deep: number; rem: number; light: number; awake: number; sleep: number };
type SourceKey = "google_fit" | "health_connect" | "manual";
type SourceRow = { source: SourceKey; totals: StageTotals };
type Row = { date: string; sources: SourceRow[] };

const fmtH = (secs: number) => {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
};

const sourceLabel = (s: SourceKey) =>
  s === "google_fit" ? "Google Fit" : s === "health_connect" ? "Health Connect" : "Manual";

const parseHHMM = (v: string): number => {
  if (!v?.trim()) return 0;
  const t = v.trim();
  if (t.includes(":")) {
    const [h, m] = t.split(":").map((n) => parseInt(n, 10) || 0);
    return h * 3600 + m * 60;
  }
  const mins = parseInt(t, 10) || 0;
  return mins * 60;
};
const secsToHHMM = (s: number) => {
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
};

type GarminVitals = {
  breathing_variations?: string | null;
  restless_moments?: number | null;
  avg_overnight_hr?: number | null;
  resting_heart_rate?: number | null;
  body_battery_change?: number | null;
  avg_spo2?: number | null;
  lowest_spo2?: number | null;
  avg_respiration?: number | null;
  lowest_respiration?: number | null;
  avg_overnight_hrv?: number | null;
  hrv_7d_avg?: number | null;
  hrv_7d_status?: string | null;
  skin_temp_change_c?: number | null;
};

type FormState = {
  date: string;
  bedtime: string; wakeTime: string;
  deep: string; rem: string; light: string; awake: string;
  rhr: string; hrv: string;
  spo2Avg: string; spo2Low: string;
  respiration: string; breathingPattern: string;
  skinTemp: string; restless: string;
  hrv7d: string; bodyBattery: string;
  vitals: GarminVitals | null;
};
const emptyForm = (date?: string): FormState => ({
  date: date ?? format(new Date(), "yyyy-MM-dd"),
  bedtime: "23:00", wakeTime: "07:00",
  deep: "", rem: "", light: "", awake: "",
  rhr: "", hrv: "",
  spo2Avg: "", spo2Low: "",
  respiration: "", breathingPattern: "",
  skinTemp: "", restless: "",
  hrv7d: "", bodyBattery: "",
  vitals: null,
});

const cleanLabel = (value?: string | null) => value?.trim() ?? "";

const normaliseBreathingPattern = (value?: string | null) => {
  const label = cleanLabel(value);
  const lower = label.toLowerCase();
  if (!label) return "";
  if (lower.includes("balanced")) return "Balanced";
  if (lower.includes("few")) return "Few";
  if (lower.includes("some")) return "Some";
  if (lower.includes("many")) return "Many";
  return label;
};

const normaliseHrvStatus = (value?: string | null) => {
  const label = cleanLabel(value);
  const lower = label.toLowerCase();
  if (!label) return "";
  if (lower.includes("balanced")) return "Balanced";
  if (lower.includes("unbalanced")) return "Unbalanced";
  if (lower === "low" || lower.includes("low")) return "Low";
  if (lower === "high" || lower.includes("high")) return "High";
  return label;
};

const applyVitalsToForm = (f: FormState, v: GarminVitals): FormState => {
  const hrvValue = v.avg_overnight_hrv ?? v.hrv_7d_avg;
  return {
    ...f,
    rhr: v.resting_heart_rate != null ? String(v.resting_heart_rate) : f.rhr,
    hrv: hrvValue != null ? String(hrvValue) : f.hrv,
    spo2Avg: v.avg_spo2 != null ? String(v.avg_spo2) : f.spo2Avg,
    spo2Low: v.lowest_spo2 != null ? String(v.lowest_spo2) : f.spo2Low,
    respiration: v.avg_respiration != null ? String(v.avg_respiration) : f.respiration,
    breathingPattern: normaliseBreathingPattern(v.breathing_variations) || f.breathingPattern,
    skinTemp: v.skin_temp_change_c != null ? String(v.skin_temp_change_c) : f.skinTemp,
    restless: v.restless_moments != null ? String(v.restless_moments) : f.restless,
    hrv7d: normaliseHrvStatus(v.hrv_7d_status) || f.hrv7d,
    bodyBattery: v.body_battery_change != null ? String(v.body_battery_change) : f.bodyBattery,
    vitals: v,
  };
};

const SleepSourcesPanel = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [editingDate, setEditingDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const since = format(subDays(new Date(), 6), "yyyy-MM-dd");
    const { data } = await supabase
      .from("sleep_stages")
      .select("date, stage, duration_seconds, source")
      .eq("user_id", user.id)
      .gte("date", since)
      .in("source", ["google_fit", "health_connect", "manual"]);

    const map = new Map<string, Map<SourceKey, StageTotals>>();
    for (const r of data ?? []) {
      const src = (r.source ?? "google_fit") as SourceKey;
      if (!["google_fit", "health_connect", "manual"].includes(src)) continue;
      if (!map.has(r.date)) map.set(r.date, new Map());
      const sm = map.get(r.date)!;
      if (!sm.has(src)) sm.set(src, { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 });
      const t = sm.get(src)!;
      const key = r.stage as keyof StageTotals;
      if (key in t) t[key] += r.duration_seconds || 0;
    }

    const built: Row[] = Array.from(map.entries())
      .map(([date, sm]) => ({
        date,
        sources: Array.from(sm.entries()).map(([source, totals]) => ({ source, totals })),
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    setRows(built);
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const fetchExistingVitals = useCallback(async (date: string): Promise<GarminVitals | null> => {
    if (!user) return null;
    // daily_metrics can have multiple rows per (user_id,date) — scan recent rows
    // and pick the most recently created one that has garmin_sleep_vitals.
    const { data } = await supabase
      .from("daily_metrics").select("raw_data, created_at")
      .eq("user_id", user.id).eq("date", date)
      .order("created_at", { ascending: false })
      .limit(10);
    for (const row of data ?? []) {
      const raw = row?.raw_data as Record<string, unknown> | null | undefined;
      const v = raw && typeof raw === "object" ? (raw as any).garmin_sleep_vitals : null;
      if (v && typeof v === "object") return v as GarminVitals;
    }
    return null;
  }, [user]);

  const saveGarminVitals = useCallback(async (date: string, vitals: GarminVitals) => {
    if (!user) return;

    const { data: existingRows, error: fetchError } = await supabase
      .from("daily_metrics")
      .select("id, raw_data, created_at")
      .eq("user_id", user.id)
      .eq("date", date)
      .order("created_at", { ascending: false })
      .limit(10);
    if (fetchError) throw fetchError;

    const rows = existingRows ?? [];
    const existing = rows.find((row) => {
      const raw = row?.raw_data as Record<string, unknown> | null | undefined;
      return raw && typeof raw === "object" && Boolean((raw as any).garmin_sleep_vitals);
    }) ?? rows[0] ?? null;

    const prevRaw = (existing?.raw_data && typeof existing.raw_data === "object" ? existing.raw_data : {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = {
      user_id: user.id,
      date,
      raw_data: {
        ...prevRaw,
        garmin_sleep_vitals: {
          ...vitals,
          source: "garmin_screenshot",
          captured_at: new Date().toISOString(),
        },
      },
    };

    const rhrFinal = vitals.resting_heart_rate ?? null;
    const hrvFinal = vitals.avg_overnight_hrv ?? vitals.hrv_7d_avg ?? null;
    if (rhrFinal != null && isFinite(rhrFinal) && rhrFinal > 0) payload.resting_heart_rate = rhrFinal;
    if (hrvFinal != null && isFinite(hrvFinal) && hrvFinal > 0) payload.hrv = hrvFinal;
    if (vitals.avg_spo2 != null && isFinite(vitals.avg_spo2)) { payload.spo2 = vitals.avg_spo2; payload.spo2_avg = vitals.avg_spo2; }
    if (vitals.lowest_spo2 != null && isFinite(vitals.lowest_spo2)) payload.spo2_lowest = vitals.lowest_spo2;
    if (vitals.avg_respiration != null && isFinite(vitals.avg_respiration)) payload.respiration_avg = vitals.avg_respiration;
    const breathingPattern = normaliseBreathingPattern(vitals.breathing_variations);
    if (breathingPattern) payload.breathing_pattern = breathingPattern;
    if (vitals.skin_temp_change_c != null && isFinite(vitals.skin_temp_change_c)) payload.skin_temp_deviation = vitals.skin_temp_change_c;
    if (vitals.restless_moments != null && isFinite(vitals.restless_moments)) payload.restless_count = vitals.restless_moments;
    const hrvStatus = normaliseHrvStatus(vitals.hrv_7d_status);
    if (hrvStatus) payload.hrv_7d_trend = hrvStatus;
    if (vitals.body_battery_change != null && isFinite(vitals.body_battery_change)) payload.body_battery_change = vitals.body_battery_change;

    const { error } = existing?.id
      ? await supabase.from("daily_metrics").update(payload as never).eq("id", existing.id)
      : await supabase.from("daily_metrics").insert(payload as never);
    if (error) throw error;
  }, [user]);

  const openAdd = async () => {
    setEditingDate(null);
    const f = emptyForm();
    const existing = await fetchExistingVitals(f.date);
    setForm(existing ? applyVitalsToForm(f, existing) : f);
    setDialogOpen(true);
  };

  const openEdit = async (date: string, totals: StageTotals) => {
    setEditingDate(date);
    const totalAll = totals.deep + totals.rem + totals.light + totals.sleep + totals.awake;
    // Derive bedtime from default 07:00 wake when we don't know real times
    const wakeDefault = "07:00";
    const wakeH = 7, wakeM = 0;
    const bedTotalMin = wakeH * 60 + wakeM - Math.round(totalAll / 60);
    const normMin = ((bedTotalMin % 1440) + 1440) % 1440;
    const bh = Math.floor(normMin / 60), bm = normMin % 60;
    const existing = await fetchExistingVitals(date);
    const baseForm = {
      ...emptyForm(date),
      date,
      bedtime: `${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}`,
      wakeTime: wakeDefault,
      deep: secsToHHMM(totals.deep),
      rem: secsToHHMM(totals.rem),
      light: secsToHHMM(totals.light || totals.sleep),
      awake: secsToHHMM(totals.awake),
    };
    setForm(existing ? applyVitalsToForm(baseForm, existing) : baseForm);
    setDialogOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.date) { toast.error("Pick a date"); return; }
    const deep = parseHHMM(form.deep);
    const rem = parseHHMM(form.rem);
    const light = parseHHMM(form.light);
    const awake = parseHHMM(form.awake);
    if (deep + rem + light === 0) { toast.error("Enter at least one of Deep, REM or Light"); return; }

    setSaving(true);
    try {
      await supabase.from("sleep_stages")
        .delete().eq("user_id", user.id).eq("date", form.date).eq("source", "manual");

      // Build sleep window from explicit bedtime + wake time.
      // Convention: `date` = wake morning. If bedtime is later in the day than wake (e.g. 23:00 → 07:00), bedtime is the previous calendar day.
      const [wH, wM] = (form.wakeTime || "07:00").split(":").map((n) => parseInt(n, 10) || 0);
      const [bH, bM] = (form.bedtime || "23:00").split(":").map((n) => parseInt(n, 10) || 0);
      const wakeLocal = new Date(`${form.date}T${String(wH).padStart(2, "0")}:${String(wM).padStart(2, "0")}:00`);
      let bedLocal = new Date(`${form.date}T${String(bH).padStart(2, "0")}:${String(bM).padStart(2, "0")}:00`);
      if (bedLocal.getTime() >= wakeLocal.getTime()) {
        bedLocal = new Date(bedLocal.getTime() - 24 * 3600 * 1000);
      }
      const windowSecs = Math.max(60, Math.round((wakeLocal.getTime() - bedLocal.getTime()) / 1000));
      const totalStages = deep + rem + light + awake;
      // Scale stages to fit the window so segments line up with bedtime → wake exactly.
      const scale = totalStages > 0 ? windowSecs / totalStages : 1;
      const sDeep = Math.round(deep * scale);
      const sRem = Math.round(rem * scale);
      const sLightHalf = Math.round(light * scale * 0.5);
      const sLightRest = Math.round(light * scale) - sLightHalf;
      const sAwake = windowSecs - (sDeep + sRem + sLightHalf + sLightRest);

      const segments: { stage: string; dur: number }[] = [];
      if (sLightHalf > 0) segments.push({ stage: "light", dur: sLightHalf });
      if (sDeep > 0) segments.push({ stage: "deep", dur: sDeep });
      if (sRem > 0) segments.push({ stage: "rem", dur: sRem });
      if (sLightRest > 0) segments.push({ stage: "light", dur: sLightRest });
      if (sAwake > 0) segments.push({ stage: "awake", dur: sAwake });

      let cursor = bedLocal.getTime();
      const rowsToInsert = segments
        .filter((s) => s.dur > 0)
        .map((s) => {
          const start = new Date(cursor);
          const end = new Date(cursor + s.dur * 1000);
          cursor = end.getTime();
          return {
            user_id: user.id,
            date: form.date,
            stage: s.stage,
            duration_seconds: s.dur,
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            source: "manual",
          };
        });

      const { error: insErr } = await supabase.from("sleep_stages").insert(rowsToInsert);
      if (insErr) throw insErr;


      const total = deep + rem + light;
      const { data: existingRows } = await supabase
        .from("daily_metrics").select("id, raw_data, spo2, created_at")
        .eq("user_id", user.id).eq("date", form.date)
        .order("created_at", { ascending: false })
        .limit(1);
      const existing = existingRows?.[0] ?? null;

      const rhrNum = form.rhr.trim() ? parseFloat(form.rhr) : null;
      const hrvNum = form.hrv.trim() ? parseFloat(form.hrv) : null;
      const v = form.vitals;

      const payload: Record<string, unknown> = {
        user_id: user.id,
        date: form.date,
        sleep_duration_seconds: total,
        deep_sleep_minutes: Math.round(deep / 60),
        rem_sleep_minutes: Math.round(rem / 60),
        light_sleep_minutes: Math.round(light / 60),
        awake_during_night_minutes: Math.round(awake / 60),
      };
      // Prefer explicit inputs; fall back to parsed vitals
      const rhrFinal = rhrNum ?? (v?.resting_heart_rate ?? null);
      const hrvFinal = hrvNum ?? (v?.avg_overnight_hrv ?? v?.hrv_7d_avg ?? null);
      if (rhrFinal != null && isFinite(rhrFinal) && rhrFinal > 0) payload.resting_heart_rate = rhrFinal;
      if (hrvFinal != null && isFinite(hrvFinal) && hrvFinal > 0) payload.hrv = hrvFinal;
      if (v?.avg_spo2 != null && isFinite(v.avg_spo2)) payload.spo2 = v.avg_spo2;

      // Advanced metrics — prefer form value, fall back to parsed vitals
      const num = (s: string) => (s.trim() ? parseFloat(s) : null);
      const int = (s: string) => (s.trim() ? parseInt(s, 10) : null);
      const spo2Avg = num(form.spo2Avg) ?? v?.avg_spo2 ?? null;
      const spo2Low = num(form.spo2Low) ?? v?.lowest_spo2 ?? null;
      const resp = num(form.respiration) ?? v?.avg_respiration ?? null;
      const breath = (normaliseBreathingPattern(form.breathingPattern) || normaliseBreathingPattern(v?.breathing_variations) || null);
      const skin = num(form.skinTemp) ?? v?.skin_temp_change_c ?? null;
      const restl = int(form.restless) ?? (v?.restless_moments ?? null);
      const hrvTrend = (normaliseHrvStatus(form.hrv7d) || normaliseHrvStatus(v?.hrv_7d_status) || null);
      const bbChange = int(form.bodyBattery) ?? v?.body_battery_change ?? null;
      if (spo2Avg != null && isFinite(spo2Avg)) { payload.spo2_avg = spo2Avg; payload.spo2 = spo2Avg; }
      if (spo2Low != null && isFinite(spo2Low)) payload.spo2_lowest = spo2Low;
      if (resp != null && isFinite(resp)) payload.respiration_avg = resp;
      if (breath) payload.breathing_pattern = breath;
      if (skin != null && isFinite(skin)) payload.skin_temp_deviation = skin;
      if (restl != null && isFinite(restl)) payload.restless_count = restl;
      if (hrvTrend) payload.hrv_7d_trend = hrvTrend;
      if (bbChange != null && isFinite(bbChange)) payload.body_battery_change = bbChange;

      if (v) {
        const prevRaw = (existing?.raw_data && typeof existing.raw_data === "object" ? existing.raw_data : {}) as Record<string, unknown>;
        payload.raw_data = { ...prevRaw, garmin_sleep_vitals: { ...v, source: "garmin_screenshot", captured_at: new Date().toISOString() } };
      }


      if (existing?.id) {
        await supabase.from("daily_metrics").update(payload as never).eq("id", existing.id);
      } else {
        await supabase.from("daily_metrics").insert(payload as never);
      }

      toast.success("Sleep saved");
      setDialogOpen(false);
      await load();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to save sleep");
    } finally {
      setSaving(false);
    }
  };

  const deleteManual = async (date: string) => {
    if (!user) return;
    if (!confirm(`Delete manual sleep entry for ${format(parseISO(date), "dd/MM/yyyy")}?`)) return;
    try {
      await supabase.from("sleep_stages")
        .delete().eq("user_id", user.id).eq("date", date).eq("source", "manual");
      toast.success("Entry deleted");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };

  const [parsing, setParsing] = useState(false);
  const handleScreenshot = async (file: File) => {
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image"); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("Image too large (max 8MB)"); return; }
    setParsing(true);
    try {
      const dataUrl: string = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(file);
      });
      const { data, error } = await supabase.functions.invoke("parse-garmin-sleep", { body: { imageDataUrl: dataUrl } });
      if (error) throw error;
      const v = data?.vitals as GarminVitals | undefined;
      if (!v) throw new Error("No vitals returned");
      await saveGarminVitals(form.date, v);
      setForm((f) => applyVitalsToForm(f, v));
      toast.success("Vitals extracted, shown below and saved");
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Failed to parse screenshot");
    } finally {
      setParsing(false);
    }
  };


  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">Sleep — Google Fit & Health Connect</CardTitle>
          <CardDescription>Last 7 nights · per-source duration & stage breakdown</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={openAdd} className="shrink-0">
          <Plus className="w-4 h-4 mr-1" /> Add night
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>No sleep data in the last 7 days.</p>
            <Button size="sm" variant="outline" onClick={openAdd}>
              <Plus className="w-4 h-4 mr-1" /> Add your first night
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Source</th>
                  <th className="px-2 py-2">Total</th>
                  <th className="px-2 py-2">Deep</th>
                  <th className="px-2 py-2">REM</th>
                  <th className="px-2 py-2">Light</th>
                  <th className="px-2 py-2">Awake</th>
                  <th className="px-2 py-2 text-right">Edit</th>
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((r) =>
                  r.sources.map((s, i) => {
                    const t = s.totals;
                    const total = t.deep + t.rem + t.light + t.sleep;
                    return (
                      <tr key={`${r.date}-${s.source}`} className="border-t border-border/40">
                        <td className="px-2 py-2 font-mono">
                          {i === 0 ? format(parseISO(r.date), "dd/MM/yyyy") : ""}
                        </td>
                        <td className="px-2 py-2">{sourceLabel(s.source)}</td>
                        <td className="px-2 py-2 font-semibold">{fmtH(total)}</td>
                        <td className="px-2 py-2">{fmtH(t.deep)}</td>
                        <td className="px-2 py-2">{fmtH(t.rem)}</td>
                        <td className="px-2 py-2">{fmtH(t.light || t.sleep)}</td>
                        <td className="px-2 py-2">{fmtH(t.awake)}</td>
                        <td className="px-2 py-2 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(r.date, t)} title={s.source === "manual" ? "Edit" : "Override with manual entry"}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            {s.source === "manual" && (
                              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteManual(r.date)} title="Delete manual entry">
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingDate ? "Edit sleep night" : "Add sleep night"}</DialogTitle>
            <DialogDescription>
              Enter stage durations as <span className="font-mono">HH:MM</span> (e.g. <span className="font-mono">1:27</span> for 1h 27m).
              Total = Deep + REM + Light.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sleep-date">Wake date</Label>
              <Input
                id="sleep-date" type="date" value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                disabled={!!editingDate}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sleep-bedtime">Bedtime</Label>
                <Input
                  id="sleep-bedtime" type="time" value={form.bedtime}
                  onChange={(e) => setForm((f) => ({ ...f, bedtime: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sleep-wake">Wake time</Label>
                <Input
                  id="sleep-wake" type="time" value={form.wakeTime}
                  onChange={(e) => setForm((f) => ({ ...f, wakeTime: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="sleep-deep">Deep (HH:MM)</Label>
                <Input id="sleep-deep" placeholder="0:32" value={form.deep} onChange={(e) => setForm((f) => ({ ...f, deep: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sleep-rem">REM (HH:MM)</Label>
                <Input id="sleep-rem" placeholder="1:27" value={form.rem} onChange={(e) => setForm((f) => ({ ...f, rem: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sleep-light">Light (HH:MM)</Label>
                <Input id="sleep-light" placeholder="4:46" value={form.light} onChange={(e) => setForm((f) => ({ ...f, light: e.target.value }))} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="sleep-awake">Awake (HH:MM)</Label>
                <Input id="sleep-awake" placeholder="0:14" value={form.awake} onChange={(e) => setForm((f) => ({ ...f, awake: e.target.value }))} />
              </div>
            </div>
            <div className="pt-2 border-t border-border/40">
              <p className="text-xs text-muted-foreground mb-2">Optional — boosts Readiness & Body Battery accuracy</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-rhr">Resting HR (bpm)</Label>
                  <Input id="sleep-rhr" inputMode="numeric" placeholder="52" value={form.rhr}
                    onChange={(e) => setForm((f) => ({ ...f, rhr: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-hrv">HRV (ms)</Label>
                  <Input id="sleep-hrv" inputMode="numeric" placeholder="48" value={form.hrv}
                    onChange={(e) => setForm((f) => ({ ...f, hrv: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-border/40">
              <p className="text-xs text-muted-foreground mb-2">Advanced metrics (optional — auto-filled from Garmin screenshot)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-spo2avg">SpO₂ Avg (%)</Label>
                  <Input id="sleep-spo2avg" inputMode="decimal" placeholder="98" value={form.spo2Avg}
                    onChange={(e) => setForm((f) => ({ ...f, spo2Avg: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-spo2low">SpO₂ Low (%)</Label>
                  <Input id="sleep-spo2low" inputMode="decimal" placeholder="90" value={form.spo2Low}
                    onChange={(e) => setForm((f) => ({ ...f, spo2Low: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-resp">Respiration (brpm)</Label>
                  <Input id="sleep-resp" inputMode="decimal" placeholder="13" value={form.respiration}
                    onChange={(e) => setForm((f) => ({ ...f, respiration: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-breath">Breathing pattern</Label>
                  <select id="sleep-breath" className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.breathingPattern}
                    onChange={(e) => setForm((f) => ({ ...f, breathingPattern: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Balanced">Balanced</option>
                    <option value="Few">Few</option>
                    <option value="Some">Some</option>
                    <option value="Many">Many</option>
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-skin">Skin temp (°C)</Label>
                  <Input id="sleep-skin" inputMode="decimal" placeholder="-0.5" value={form.skinTemp}
                    onChange={(e) => setForm((f) => ({ ...f, skinTemp: e.target.value }))} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="sleep-restless">Restless count</Label>
                  <Input id="sleep-restless" inputMode="numeric" placeholder="60" value={form.restless}
                    onChange={(e) => setForm((f) => ({ ...f, restless: e.target.value }))} />
                </div>
                <div className="grid gap-1.5 col-span-2">
                  <Label htmlFor="sleep-hrv7d">7d HRV trend</Label>
                  <select id="sleep-hrv7d" className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.hrv7d}
                    onChange={(e) => setForm((f) => ({ ...f, hrv7d: e.target.value }))}>
                    <option value="">—</option>
                    <option value="Balanced">Balanced</option>
                    <option value="Unbalanced">Unbalanced</option>
                    <option value="Low">Low</option>
                    <option value="High">High</option>
                  </select>
                </div>
                <div className="grid gap-1.5 col-span-2">
                  <Label htmlFor="sleep-body-battery">Body Battery change</Label>
                  <Input id="sleep-body-battery" inputMode="numeric" placeholder="+51" value={form.bodyBattery}
                    onChange={(e) => setForm((f) => ({ ...f, bodyBattery: e.target.value }))} />
                </div>
              </div>
            </div>


            <div className="pt-2 border-t border-border/40">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs text-muted-foreground">
                  <Sparkles className="w-3 h-3 inline mr-1" />
                  Upload a Garmin "Sleep Metrics" screenshot — we'll auto-fill RHR, HRV & save SpO₂, respiration, body battery change and more.
                </p>
              </div>
              <label className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border/60 px-3 py-2 text-xs cursor-pointer hover:bg-accent/30">
                {parsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                <span>{parsing ? "Reading screenshot…" : form.vitals ? "Replace screenshot" : "Upload Garmin screenshot"}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={parsing}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleScreenshot(f);
                    e.target.value = "";
                  }}
                />
              </label>
              {form.vitals && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {form.vitals.avg_overnight_hr != null && <div>Avg HR: <span className="text-foreground">{form.vitals.avg_overnight_hr} bpm</span></div>}
                  {form.vitals.body_battery_change != null && <div>Body Battery: <span className="text-foreground">{form.vitals.body_battery_change >= 0 ? "+" : ""}{form.vitals.body_battery_change}</span></div>}
                  {form.vitals.avg_spo2 != null && <div>Avg SpO₂: <span className="text-foreground">{form.vitals.avg_spo2}%</span></div>}
                  {form.vitals.lowest_spo2 != null && <div>Lowest SpO₂: <span className="text-foreground">{form.vitals.lowest_spo2}%</span></div>}
                  {form.vitals.avg_respiration != null && <div>Avg Resp: <span className="text-foreground">{form.vitals.avg_respiration} brpm</span></div>}
                  {form.vitals.restless_moments != null && <div>Restless: <span className="text-foreground">{form.vitals.restless_moments}</span></div>}
                  {form.vitals.breathing_variations && <div>Breathing: <span className="text-foreground">{form.vitals.breathing_variations}</span></div>}
                  {form.vitals.hrv_7d_status && <div>7d HRV: <span className="text-foreground">{form.vitals.hrv_7d_status}</span></div>}
                  {form.vitals.skin_temp_change_c != null && <div>Skin temp: <span className="text-foreground">{form.vitals.skin_temp_change_c >= 0 ? "+" : ""}{form.vitals.skin_temp_change_c}°</span></div>}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default SleepSourcesPanel;
