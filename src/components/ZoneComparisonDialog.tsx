/**
 * ZoneComparisonDialog — final gate before writing to public.hr_zones.
 *
 * Shows old vs new zones side-by-side with bpm boundaries derived from the
 * measured LTHR. If |newLTHR - oldLTHR| ≥ LARGE_CHANGE_BPM, a large-change
 * callout appears. Also lists how many workouts in the current plan reference
 * HR (Z1-Z5 or bpm), so the athlete understands the downstream effect.
 *
 * "Apply new zones" is the ONLY caller of `applyMeasuredZones`, which is the
 * only writer to public.hr_zones. See src/lib/apply-measured-zones.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { zonesFromLthr, type Zones } from "@shared/hr-zones";
import { applyMeasuredZones } from "@/lib/apply-measured-zones";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import { cn } from "@/lib/utils";

const LARGE_CHANGE_BPM = 15;

interface Props {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  userId: string;
  benchmarkId: string;
  protocol: BenchmarkProtocol;
  measuredLthr: number;
  currentZones: Zones | null;
  planId: string | null;
  onApplied?: () => void | Promise<void>;
}

function bandLabel(min: number | null, max: number | null): string {
  if (min == null && max == null) return "—";
  if (min == null) return `≤${max}`;
  if (max == null) return `>${min}`;
  return `${min}–${max}`;
}

export default function ZoneComparisonDialog({
  open, onOpenChange, userId, benchmarkId, protocol, measuredLthr, currentZones,
  planId, onApplied,
}: Props) {
  const [working, setWorking] = useState(false);
  const [affected, setAffected] = useState<Array<{ iso: string; label: string }> | null>(null);

  const newBands = useMemo(() => zonesFromLthr(measuredLthr), [measuredLthr]);
  const oldLthr = currentZones?.lthr ?? null;
  const delta = oldLthr != null ? measuredLthr - oldLthr : null;
  const largeChange = delta != null && Math.abs(delta) >= LARGE_CHANGE_BPM;

  // Parse the plan markdown into dated day blocks and list the ones whose
  // body references HR zones (Z1-Z5) or explicit bpm — those sessions will
  // be re-scaled by the new bands. Same heading grammar as splitPlanByDate:
  //   ### **Weekday DD/MM/YYYY** — Session name (Total: ...)
  useEffect(() => {
    if (!open || !planId) { setAffected(null); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("training_plans")
        .select("content")
        .eq("id", planId)
        .maybeSingle();
      if (cancelled) return;
      const md = (data as { content?: string | null } | null)?.content ?? "";
      if (!md) { setAffected([]); return; }

      const HEADING_RE =
        /^###\s+\*\*[^*]*?(\d{2})\/(\d{2})\/(\d{4})[^*]*\*\*\s*(?:[—–-]\s*)?(.*)$/;
      const HR_REF_RE = /\b(Z[1-5]|bpm)\b/i;
      const todayIso = new Date().toISOString().slice(0, 10);

      const lines = md.split(/\r?\n/);
      const blocks: Array<{ iso: string; label: string; body: string }> = [];
      let cur: { iso: string; label: string; body: string } | null = null;
      for (const l of lines) {
        const m = l.match(HEADING_RE);
        if (m) {
          if (cur) blocks.push(cur);
          const iso = `${m[3]}-${m[2]}-${m[1]}`;
          const rawLabel = (m[4] || "").replace(/\(Total:[^)]*\)/i, "").trim();
          cur = { iso, label: rawLabel || "Session", body: "" };
        } else if (cur) {
          cur.body += l + "\n";
        }
      }
      if (cur) blocks.push(cur);

      const future = blocks
        .filter((b) => b.iso >= todayIso && HR_REF_RE.test(b.body))
        .map(({ iso, label }) => ({ iso, label }));
      setAffected(future);
    })();
    return () => { cancelled = true; };
  }, [open, planId]);


  const handleApply = async () => {
    setWorking(true);
    try {
      await applyMeasuredZones({
        userId, benchmarkId, protocol, measuredLthr,
      });
      toast.success("HR zones updated", {
        description: `New LTHR ${Math.round(measuredLthr)} bpm now drives your training.`,
      });
      onOpenChange(false);
      await onApplied?.();
    } catch (e: any) {
      toast.error("Couldn't apply zones", { description: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  const rows: Array<{ z: 1 | 2 | 3 | 4 | 5; oldBand: string; newBand: string }> = [
    { z: 1, oldBand: bandLabel(null, currentZones?.z1Max ?? null),
            newBand: bandLabel(null, newBands.z1Max) },
    { z: 2, oldBand: bandLabel(currentZones ? currentZones.z1Max + 1 : null, currentZones?.z2Max ?? null),
            newBand: bandLabel(newBands.z1Max + 1, newBands.z2Max) },
    { z: 3, oldBand: bandLabel(currentZones ? currentZones.z2Max + 1 : null, currentZones?.z3Max ?? null),
            newBand: bandLabel(newBands.z2Max + 1, newBands.z3Max) },
    { z: 4, oldBand: bandLabel(currentZones ? currentZones.z3Max + 1 : null, currentZones?.z4Max ?? null),
            newBand: bandLabel(newBands.z3Max + 1, newBands.z4Max) },
    { z: 5, oldBand: bandLabel(currentZones ? currentZones.z4Max : null, null),
            newBand: bandLabel(newBands.z4Max, null) },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Apply new HR zones?</DialogTitle>
          <DialogDescription>
            Old LTHR {oldLthr ?? "—"} bpm → new LTHR{" "}
            <span className="font-semibold text-foreground">{Math.round(measuredLthr)} bpm</span>
            {delta != null && (
              <span className={cn(
                "ml-1",
                delta > 0 ? "text-emerald-500" : delta < 0 ? "text-amber-500" : "",
              )}>
                ({delta > 0 ? "+" : ""}{delta} bpm)
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {largeChange && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">
              <span className="font-semibold">Large change ({Math.abs(delta!)} bpm).</span>{" "}
              Double-check the benchmark felt genuinely at threshold before applying —
              a shift this big will re-scale every HR-based session.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-border/60 overflow-hidden">
          <div className="grid grid-cols-[auto_1fr_1fr] text-[11px] font-semibold uppercase tracking-wider bg-muted/50 px-2.5 py-1.5">
            <span>Zone</span>
            <span>Current</span>
            <span>New</span>
          </div>
          {rows.map((r) => (
            <div key={r.z}
              className="grid grid-cols-[auto_1fr_1fr] text-xs px-2.5 py-1.5 border-t border-border/40">
              <span className="font-semibold w-8">Z{r.z}</span>
              <span className="text-muted-foreground tabular-nums">{r.oldBand}</span>
              <span className="tabular-nums font-medium">{r.newBand}</span>
            </div>
          ))}
        </div>

        {planId != null && (
          <p className="text-xs text-muted-foreground">
            {affectedCount == null
              ? "Checking your plan…"
              : affectedCount === 0
                ? "No HR-referencing sessions detected in the current plan."
                : `${affectedCount} session${affectedCount === 1 ? "" : "s"} in your current plan reference HR zones and will use the new bands.`}
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={working}>
            Not now
          </Button>
          <Button className="flex-1" onClick={handleApply} disabled={working}>
            {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Apply new zones"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
