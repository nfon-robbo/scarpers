/**
 * PaceAdjustDialog — "that pace was too slow".
 *
 * Shows an AI coach recommendation (deterministic fallback when the call
 * fails), lets the runner accept it or type their own, previews exactly which
 * future sessions change, and applies the change across the plan on confirm.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { pushUndoEntry } from "@/lib/plan-undo-history";
import { logPlanEdit } from "@/lib/plan-edit-log";
import {
  SESSION_TYPE_LABEL,
  formatPaceRange,
  getPaceContextForDate,
  parseUserPaceInput,
  planPaceChangePreview,
  recommendPaceDeterministic,
  speedUpFraction,
  type PaceContext,
} from "@/lib/pace-adjustment";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  planId: string | null;
  planContent: string;
  /** The session the feedback is about, DD/MM/YYYY. */
  dateUk: string;
  userId?: string | null;
  /** What the runner said, passed to the coach for context. */
  feedback?: string;
  direction?: "faster" | "slower";
  completedIso?: Set<string>;
  onApplied?: (newContent: string) => void | Promise<void>;
}

export default function PaceAdjustDialog({
  open, onOpenChange, planId, planContent, dateUk, userId,
  feedback, direction = "faster", completedIso, onApplied,
}: Props) {
  const [ctx, setCtx] = useState<PaceContext | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [recommended, setRecommended] = useState<string>("");
  const [rationale, setRationale] = useState<string>("");
  const [custom, setCustom] = useState<string>("");
  const [working, setWorking] = useState(false);

  // Locate the session + current pace whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    const found = getPaceContextForDate(planContent, dateUk);
    setCtx(found);
    setCustom("");
    setRecommended("");
    setRationale("");
  }, [open, planContent, dateUk]);

  const loadRecommendation = useCallback(async (c: PaceContext) => {
    setLoadingRec(true);
    try {
      const { data, error } = await supabase.functions.invoke("pace-recommendation", {
        body: {
          currentPace: c.currentPace.raw,
          sessionType: c.sessionType,
          workoutTitle: c.title,
          direction,
          feedback,
        },
      });
      const pace = (data as any)?.pace as string | undefined;
      if (error || !pace) throw error ?? new Error("no recommendation");
      setRecommended(pace);
      setRationale((data as any)?.rationale ?? "");
    } catch {
      let threshold: number | null = null;
      try {
        const { data } = await supabase
          .from("benchmark_results")
          .select("threshold_pace_s_per_km")
          .eq("active", true)
          .order("benchmark_date", { ascending: false })
          .limit(1)
          .maybeSingle();
        threshold = (data as any)?.threshold_pace_s_per_km ?? null;
      } catch { /* ignore */ }
      const fb = recommendPaceDeterministic(c.currentPace, c.sessionType, threshold);
      setRecommended(fb.pace);
      setRationale(fb.rationale);
    } finally {
      setLoadingRec(false);
    }
  }, [direction, feedback]);

  useEffect(() => {
    if (open && ctx && !recommended && !loadingRec) void loadRecommendation(ctx);
  }, [open, ctx, recommended, loadingRec, loadRecommendation]);

  const chosen = useMemo(() => {
    const manual = parseUserPaceInput(custom);
    if (manual) return { pace: formatPaceRange(manual.minSec, manual.maxSec), range: manual, manual: true };
    if (!recommended) return null;
    const rec = parseUserPaceInput(recommended.replace(/\/km$/i, ""));
    return rec ? { pace: formatPaceRange(rec.minSec, rec.maxSec), range: rec, manual: false } : null;
  }, [custom, recommended]);

  const customInvalid = custom.trim().length > 0 && !parseUserPaceInput(custom);

  const aggressive = useMemo(() => {
    if (!ctx || !chosen) return false;
    return speedUpFraction(ctx.currentPace, chosen.range) > 0.1;
  }, [ctx, chosen]);

  const preview = useMemo(() => {
    if (!ctx || !chosen) return null;
    return planPaceChangePreview(planContent, {
      fromIso: ctx.iso,
      sessionType: ctx.sessionType,
      newPace: chosen.pace,
      completedIso,
    });
  }, [ctx, chosen, planContent, completedIso]);

  const grouped = useMemo(() => {
    const m = new Map<string, { dateUk: string; title: string; count: number; before: string }>();
    for (const c of preview?.changes ?? []) {
      const existing = m.get(c.iso);
      if (existing) existing.count += 1;
      else m.set(c.iso, { dateUk: c.dateUk, title: c.title, count: 1, before: c.before });
    }
    return Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [preview]);

  const handleApply = async () => {
    if (!planId || !ctx || !chosen || !preview || preview.changes.length === 0) return;
    setWorking(true);
    try {
      pushUndoEntry(planId, planContent, `pace change to ${chosen.pace}`);
      const { error } = await supabase
        .from("training_plans")
        .update({ content: preview.newContent })
        .eq("id", planId);
      if (error) throw error;

      if (userId) {
        await logPlanEdit({
          planId,
          userId,
          dateUk: ctx.dateUk,
          action: "edit",
          template: null,
          beforeTitle: ctx.title,
          afterTitle: ctx.title,
          summary: `${SESSION_TYPE_LABEL[ctx.sessionType]} pace updated to ${chosen.pace} across ${grouped.length} future session${grouped.length === 1 ? "" : "s"}`,
          details: {
            source: chosen.manual ? "pace_adjust_manual" : "pace_adjust_ai",
            newPace: chosen.pace,
            sessionType: ctx.sessionType,
            changedDates: grouped.map(([iso]) => iso),
          },
        });
      }

      toast.success(`Pace updated to ${chosen.pace}`, {
        description: `${grouped.length} future ${grouped.length === 1 ? "session" : "sessions"} changed. Use Undo to revert.`,
      });
      onOpenChange(false);
      await onApplied?.(preview.newContent);
    } catch (e: any) {
      toast.error("Couldn't apply the new pace", { description: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adjust your run pace</DialogTitle>
          <DialogDescription>
            {ctx
              ? <>Your {SESSION_TYPE_LABEL[ctx.sessionType].toLowerCase()} target on {ctx.dateUk} is <span className="font-semibold">{ctx.currentPace.raw}</span>.</>
              : "No paced running target found for that day."}
          </DialogDescription>
        </DialogHeader>

        {!ctx ? (
          <div className="py-6 text-sm text-muted-foreground text-center">
            That session has no run pace to change.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Coach recommends</span>
              </div>
              {loadingRec ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Working out a pace that suits you…
                </div>
              ) : (
                <>
                  <p className="text-lg font-bold">{recommended || "—"}</p>
                  {rationale && <p className="text-xs text-muted-foreground mt-1">{rationale}</p>}
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="custom-pace" className="text-xs">Or set your own pace</Label>
              <Input
                id="custom-pace"
                inputMode="numeric"
                placeholder="e.g. 8:30-8:50"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
              {customInvalid && (
                <p className="text-xs text-destructive">Use M:SS or M:SS-M:SS (per km).</p>
              )}
            </div>

            {aggressive && (
              <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs">
                  That's more than 10% faster than your current target — a big jump. It's your call, but
                  ease into it and stop if anything niggles.
                </p>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold">What will change</span>
                {preview && (
                  <span className="text-[11px] text-muted-foreground">
                    {grouped.length} session{grouped.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              {!preview || preview.changes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nothing to change — your future {SESSION_TYPE_LABEL[ctx.sessionType].toLowerCase()} sessions
                  are already at this pace or faster.
                </p>
              ) : (
                <ul className="space-y-1 max-h-52 overflow-y-auto">
                  {grouped.map(([iso, g]) => (
                    <li key={iso} className="text-xs bg-background/60 border border-border/40 rounded px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px]">{g.dateUk}</Badge>
                        <span className="truncate flex-1">{g.title}</span>
                      </div>
                      <div className="mt-0.5">
                        <span className="line-through text-muted-foreground">{g.before}</span>{" "}
                        <span className="font-semibold">→ {chosen?.pace}</span>
                        {g.count > 1 && <span className="text-muted-foreground"> ({g.count} rows)</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {preview && preview.skippedFaster > 0 && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {preview.skippedFaster} faster session{preview.skippedFaster === 1 ? "" : "s"} left unchanged.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>Cancel</Button>
          <Button
            onClick={handleApply}
            disabled={working || !chosen || !preview || preview.changes.length === 0 || customInvalid}
          >
            {working && <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />}
            Apply pace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
