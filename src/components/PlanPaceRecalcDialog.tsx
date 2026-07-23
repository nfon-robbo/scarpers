/**
 * PlanPaceRecalcDialog — shows the pace-diff produced by recomputePlanPaces
 * and, on confirm, writes the new content to training_plans.content and
 * re-syncs the affected future workouts through the existing intervals-sync
 * path (same route the rest of the app uses — no side-door writer).
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { recomputePlanPaces, type PaceChange } from "@/lib/recompute-plan-paces";
import { formatPace } from "@/lib/benchmark-calculations";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planId: string;
  planContent: string;
  newThresholdSecPerKm: number;
  onApplied?: () => void | Promise<void>;
}

export default function PlanPaceRecalcDialog({
  open, onOpenChange, planId, planContent, newThresholdSecPerKm, onApplied,
}: Props) {
  const [working, setWorking] = useState(false);
  const [computed, setComputed] = useState<{ newContent: string; changes: PaceChange[] } | null>(null);

  useEffect(() => {
    if (!open) return;
    setComputed(recomputePlanPaces(planContent, newThresholdSecPerKm));
  }, [open, planContent, newThresholdSecPerKm]);

  const grouped = useMemo(() => {
    if (!computed) return new Map<string, PaceChange[]>();
    const m = new Map<string, PaceChange[]>();
    for (const c of computed.changes) {
      const arr = m.get(c.category) ?? [];
      arr.push(c);
      m.set(c.category, arr);
    }
    return m;
  }, [computed]);

  const handleApply = async () => {
    if (!computed) return;
    setWorking(true);
    try {
      const { error } = await supabase
        .from("training_plans")
        .update({ content: computed.newContent })
        .eq("id", planId);
      if (error) throw error;

      // Re-sync affected future workouts via the SAME edge function the
      // rest of the app uses. Fire-and-forget; failures are surfaced by
      // the sync path itself.
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const futureIso = new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
        await supabase.functions.invoke("intervals-sync", {
          body: { deleteRange: { oldest: todayIso, newest: futureIso } },
        });
        // The caller flow (TrainingPlan.handleSyncToIntervals) is invoked
        // right after `onApplied` reloads the plan — that pushes the fresh
        // paces via the normal path.
      } catch { /* silent — user can retry manually */ }

      toast.success(`Applied ${computed.changes.length} pace ${computed.changes.length === 1 ? "update" : "updates"}`);
      onOpenChange(false);
      await onApplied?.();
    } catch (e: any) {
      toast.error("Couldn't apply new paces", { description: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Recompute plan paces</DialogTitle>
          <DialogDescription>
            New LT pace: <span className="font-semibold">{formatPace(newThresholdSecPerKm)}</span>.
            The changes below will be applied to your plan and re-synced to intervals.icu.
          </DialogDescription>
        </DialogHeader>

        {!computed ? (
          <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : computed.changes.length === 0 ? (
          <div className="py-6 text-sm text-muted-foreground text-center">
            No pace tokens matched — nothing to change.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto space-y-3">
            {Array.from(grouped.entries()).map(([cat, list]) => (
              <div key={cat}>
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-[10px] uppercase">{cat}</Badge>
                  <span className="text-[10px] text-muted-foreground">{list.length} line{list.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="space-y-1">
                  {list.slice(0, 8).map((c) => (
                    <li key={c.lineNo} className="text-xs bg-background/60 border border-border/40 rounded px-2 py-1">
                      <span className="text-muted-foreground">L{c.lineNo}:</span>{" "}
                      <span className="line-through text-muted-foreground">{c.before}</span>{" "}
                      <span className="font-semibold">→ {c.after}</span>
                    </li>
                  ))}
                  {list.length > 8 && (
                    <li className="text-[11px] text-muted-foreground">+ {list.length - 8} more</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>Cancel</Button>
          <Button onClick={handleApply} disabled={working || !computed || computed.changes.length === 0}>
            {working ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" /> : null}
            Apply & re-sync
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
