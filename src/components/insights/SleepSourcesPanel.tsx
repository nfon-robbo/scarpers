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
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
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

type FormState = {
  date: string;
  bedtime: string; wakeTime: string;
  deep: string; rem: string; light: string; awake: string;
  rhr: string; hrv: string;
};
const emptyForm = (date?: string): FormState => ({
  date: date ?? format(new Date(), "yyyy-MM-dd"),
  bedtime: "23:00", wakeTime: "07:00",
  deep: "", rem: "", light: "", awake: "",
  rhr: "", hrv: "",
});

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

  const openAdd = () => { setEditingDate(null); setForm(emptyForm()); setDialogOpen(true); };

  const openEdit = (date: string, totals: StageTotals) => {
    setEditingDate(date);
    const totalAll = totals.deep + totals.rem + totals.light + totals.sleep + totals.awake;
    // Derive bedtime from default 07:00 wake when we don't know real times
    const wakeDefault = "07:00";
    const wakeH = 7, wakeM = 0;
    const bedTotalMin = wakeH * 60 + wakeM - Math.round(totalAll / 60);
    const normMin = ((bedTotalMin % 1440) + 1440) % 1440;
    const bh = Math.floor(normMin / 60), bm = normMin % 60;
    setForm({
      date,
      bedtime: `${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}`,
      wakeTime: wakeDefault,
      deep: secsToHHMM(totals.deep),
      rem: secsToHHMM(totals.rem),
      light: secsToHHMM(totals.light || totals.sleep),
      awake: secsToHHMM(totals.awake),
      rhr: "", hrv: "",
    });
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
      const { data: existing } = await supabase
        .from("daily_metrics").select("id")
        .eq("user_id", user.id).eq("date", form.date).maybeSingle();

      const rhrNum = form.rhr.trim() ? parseFloat(form.rhr) : null;
      const hrvNum = form.hrv.trim() ? parseFloat(form.hrv) : null;

      const payload: Record<string, unknown> = {
        user_id: user.id,
        date: form.date,
        sleep_duration_seconds: total,
        deep_sleep_minutes: Math.round(deep / 60),
        rem_sleep_minutes: Math.round(rem / 60),
        light_sleep_minutes: Math.round(light / 60),
        awake_during_night_minutes: Math.round(awake / 60),
      };
      if (rhrNum != null && isFinite(rhrNum) && rhrNum > 0) payload.resting_heart_rate = rhrNum;
      if (hrvNum != null && isFinite(hrvNum) && hrvNum > 0) payload.hrv = hrvNum;

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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingDate ? "Edit sleep night" : "Add sleep night"}</DialogTitle>
            <DialogDescription>
              Enter stage durations as <span className="font-mono">HH:MM</span> (e.g. <span className="font-mono">1:27</span> for 1h 27m).
              Total = Deep + REM + Light.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sleep-date">Date</Label>
              <Input
                id="sleep-date" type="date" value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                disabled={!!editingDate}
              />
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
