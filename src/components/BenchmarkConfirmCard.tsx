/**
 * BenchmarkConfirmCard — the confirmation surface for a scheduled benchmark.
 *
 * Flow (Group 2 spec):
 *   1. Show the card with the 30-minute effort instruction (verbatim) when
 *      protocol === "30min".
 *   2. On Confirm/Save:
 *      - 3K/5K: open BenchmarkOverrideDialog first (verbatim HR warning);
 *        athlete must acknowledge before we proceed.
 *      - 30min: skip straight to step 3.
 *   3. Open BenchmarkPostQuestionsDialog (RPE + could-continue). Answers
 *      derive `likely_submaximal` via deriveLikelySubmaximal — the SAME
 *      boolean feeds both the confidence-score deduction and the stored flag.
 *   4. Call confirmBenchmark with the answers; row is saved.
 *   5. If protocol === "30min" AND we have a measured LTHR, open
 *      ZoneComparisonDialog. That dialog is the only caller of
 *      applyMeasuredZones, the only writer to public.hr_zones.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Award, Loader2, Pencil, ThumbsDown, HeartPulse, Clock, MapPin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import type { CandidateActivity, ActivityForDetection } from "@/lib/benchmark-detection";
import type { BenchmarkLap } from "@/lib/benchmark-lap-matcher";
import { confirmBenchmark, rejectCandidate } from "@/lib/benchmark-persist";
import type { RpeResponse, CouldContinueResponse } from "@/lib/benchmark-rpe";
import BenchmarkOverrideDialog from "@/components/BenchmarkOverrideDialog";
import BenchmarkPostQuestionsDialog from "@/components/BenchmarkPostQuestionsDialog";
import ZoneComparisonDialog from "@/components/ZoneComparisonDialog";
import { useHrZones } from "@/hooks/useHrZones";

interface Props {
  userId: string;
  planId: string | null;
  scheduledDateIso: string;
  protocol: BenchmarkProtocol;
  candidates: CandidateActivity[];
  onDone: () => void | Promise<void>;
}

const PROTOCOL_LABEL: Record<BenchmarkProtocol, string> = {
  "30min": "30-minute threshold",
  "3k": "3K time trial",
  "5k": "5K time trial",
};

const PROTOCOL_DEFAULT_DIST_M: Record<BenchmarkProtocol, number> = {
  "30min": 0,
  "3k": 3000,
  "5k": 5000,
};

// Verbatim effort instruction shown on the card for 30-min TTs.
const EFFORT_INSTRUCTION_30MIN =
  "Run at the hardest pace you believe you can maintain evenly for the full 30 minutes. You should finish feeling you gave almost everything, but not having sprinted the first few minutes.";

function parseMmSs(v: string): number | null {
  const m = v.trim().match(/^(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// A pending save — captured when the athlete taps Confirm/Save, resolved
// once the post-question dialog closes with answers.
type Pending =
  | { kind: "auto"; activity: ActivityForDetection; laps: BenchmarkLap[] | null }
  | { kind: "manual"; durationS: number; distanceM: number };

export default function BenchmarkConfirmCard({
  userId, planId, scheduledDateIso, protocol, candidates, onDone,
}: Props) {
  const [index, setIndex] = useState(0);
  const [working, setWorking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [zoneDialog, setZoneDialog] = useState<{
    benchmarkId: string; measuredLthr: number;
  } | null>(null);
  const { zones: currentZones } = useHrZones();

  const current = candidates[index] ?? null;
  const remaining = candidates.length - index - 1;

  // Step 2: intercept the Confirm/Save taps and route via override → questions.
  const beginSave = (p: Pending) => {
    setPending(p);
    if (protocol === "3k" || protocol === "5k") {
      setOverrideOpen(true);
    } else {
      setQuestionsOpen(true);
    }
  };

  const handleConfirm = async () => {
    if (!current) return;
    setWorking(true);
    try {
      const { data: laps } = await supabase
        .from("activity_laps" as any)
        .select("lap_index, elapsed_time_s, distance_m")
        .eq("activity_id", current.id)
        .order("lap_index", { ascending: true });
      beginSave({
        kind: "auto",
        activity: current,
        laps: ((laps as unknown) as BenchmarkLap[] | null) ?? null,
      });
    } catch (e: any) {
      toast.error("Couldn't load activity", { description: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  const handleReject = async () => {
    if (!current) return;
    setWorking(true);
    try {
      await rejectCandidate({ userId, activityId: current.id, reason: "user_rejected" });
      if (remaining > 0) {
        setIndex((i) => i + 1);
      } else {
        toast.info("No more candidates in the ±48h window.");
        await onDone();
      }
    } catch (e: any) {
      toast.error("Couldn't reject candidate", { description: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  // Step 4: persist with the RPE answers.
  const handleQuestionsSubmit = async (v: {
    rpe: RpeResponse; couldContinue: CouldContinueResponse;
  }) => {
    if (!pending) return;
    setWorking(true);
    try {
      const saved = await confirmBenchmark({
        userId, planId, scheduledDateIso, protocol,
        activity: pending.kind === "auto" ? pending.activity : null,
        laps: pending.kind === "auto" ? pending.laps : null,
        manualDurationS: pending.kind === "manual" ? pending.durationS : undefined,
        manualDistanceM: pending.kind === "manual" ? pending.distanceM : undefined,
        rpeResponse: v.rpe,
        couldContinueResponse: v.couldContinue,
      });
      toast.success("Benchmark saved");
      setQuestionsOpen(false);
      setManualOpen(false);
      setPending(null);

      // Step 5: only 30-min TTs can rebuild HR zones. Skip for 3K/5K per the
      // verbatim override warning.
      if (protocol === "30min" && saved.lthr != null && saved.lthr > 0) {
        setZoneDialog({ benchmarkId: saved.id, measuredLthr: saved.lthr });
      } else {
        await onDone();
      }
    } catch (e: any) {
      toast.error("Couldn't save benchmark", { description: e?.message ?? String(e) });
    } finally {
      setWorking(false);
    }
  };

  const hasHr = current?.avg_heart_rate != null;

  return (
    <>
      <Card className="glass border-primary/40 bg-gradient-to-r from-primary/10 to-accent/10 p-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
            <Award className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary">
              Benchmark to confirm
            </p>
            <p className="text-sm font-semibold truncate">{PROTOCOL_LABEL[protocol]}</p>
          </div>
          {candidates.length > 1 && (
            <span className="text-[10px] font-semibold text-muted-foreground bg-background/60 px-1.5 py-0.5 rounded-full">
              {index + 1}/{candidates.length}
            </span>
          )}
        </div>

        {protocol === "30min" && (
          <p className="text-[11px] leading-relaxed text-muted-foreground bg-background/40 border border-border/40 rounded-lg p-2 mb-2">
            {EFFORT_INSTRUCTION_30MIN}
          </p>
        )}

        {current ? (
          <>
            <div className="rounded-lg bg-background/60 border border-border/40 p-2.5 space-y-1.5">
              <p className="text-xs font-semibold">
                {format(new Date(current.start_time), "EEE d MMM · HH:mm")}
              </p>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {current.distance_meters != null && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {(current.distance_meters / 1000).toFixed(2)} km
                  </span>
                )}
                {current.duration_seconds != null && (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {Math.round(current.duration_seconds / 60)} min
                  </span>
                )}
                <span className={cn(
                  "inline-flex items-center gap-1",
                  hasHr ? "text-foreground" : "text-destructive/80",
                )}>
                  <HeartPulse className="w-3 h-3" />
                  {hasHr ? `${Math.round(current.avg_heart_rate!)} bpm avg` : "no HR data"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-2.5">
              <Button
                size="sm"
                className="flex-1"
                onClick={handleConfirm}
                disabled={working}
              >
                {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Confirm"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReject}
                disabled={working}
              >
                <ThumbsDown className="w-3.5 h-3.5 mr-1" />
                Reject
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-lg bg-background/60 border border-dashed border-border/40 p-3 text-xs text-muted-foreground">
            No matching activity found within ±48 hours.
          </div>
        )}

        <button
          type="button"
          onClick={() => setManualOpen(true)}
          className="mt-2 text-xs text-primary/90 hover:text-primary underline underline-offset-2 inline-flex items-center gap-1"
        >
          <Pencil className="w-3 h-3" /> Enter result manually
        </button>
      </Card>

      <ManualEntryDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        protocol={protocol}
        working={working}
        onSubmit={({ durationS, distanceM }) => {
          beginSave({ kind: "manual", durationS, distanceM });
        }}
      />

      <BenchmarkOverrideDialog
        open={overrideOpen}
        protocol={protocol}
        onCancel={() => { setOverrideOpen(false); setPending(null); }}
        onAcknowledge={() => { setOverrideOpen(false); setQuestionsOpen(true); }}
      />

      <BenchmarkPostQuestionsDialog
        open={questionsOpen}
        working={working}
        onCancel={() => { setQuestionsOpen(false); setPending(null); }}
        onSubmit={handleQuestionsSubmit}
      />

      {zoneDialog && (
        <ZoneComparisonDialog
          open={!!zoneDialog}
          onOpenChange={(o) => {
            if (!o) {
              setZoneDialog(null);
              // Regardless of apply vs skip, we're done with this benchmark cycle.
              void onDone();
            }
          }}
          userId={userId}
          benchmarkId={zoneDialog.benchmarkId}
          protocol={protocol}
          measuredLthr={zoneDialog.measuredLthr}
          currentZones={currentZones}
          planId={planId}
        />
      )}
    </>
  );
}

// ─── Manual entry dialog ───────────────────────────────────────────────────

interface ManualProps {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  protocol: BenchmarkProtocol;
  working: boolean;
  onSubmit: (v: { durationS: number; distanceM: number }) => void | Promise<void>;
}

function ManualEntryDialog({ open, onOpenChange, protocol, working, onSubmit }: ManualProps) {
  const [duration, setDuration] = useState("");
  const [distanceKm, setDistanceKm] = useState(
    protocol === "30min" ? "" : (PROTOCOL_DEFAULT_DIST_M[protocol] / 1000).toString(),
  );

  const durationHelp = useMemo(() => {
    switch (protocol) {
      case "30min": return "Effort time only (excluding warm-up/cool-down). Format m:ss";
      case "3k": return "Time to complete 3 km. Format m:ss";
      case "5k": return "Time to complete 5 km. Format m:ss";
    }
  }, [protocol]);

  const submit = async () => {
    const durS = parseMmSs(duration);
    const distM = Math.round(parseFloat(distanceKm) * 1000);
    if (!durS || durS <= 0) return toast.error("Enter a valid duration (m:ss).");
    if (!Number.isFinite(distM) || distM <= 0) return toast.error("Enter a valid distance in km.");
    await onSubmit({ durationS: durS, distanceM: distM });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Manual benchmark result</DialogTitle>
          <DialogDescription>
            {PROTOCOL_LABEL[protocol]} — enter what you actually ran.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="bm-dur" className="text-xs">Duration</Label>
            <Input
              id="bm-dur"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 24:30"
              inputMode="numeric"
              className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{durationHelp}</p>
          </div>

          <div>
            <Label htmlFor="bm-dist" className="text-xs">Distance (km)</Label>
            <Input
              id="bm-dist"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder={protocol === "30min" ? "e.g. 6.20" : "3.00"}
              inputMode="decimal"
              className="mt-1"
            />
          </div>

          <Button className="w-full" onClick={submit} disabled={working}>
            {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Continue"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
