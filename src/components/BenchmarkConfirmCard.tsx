/**
 * BenchmarkConfirmCard — confirmation surface for a scheduled benchmark.
 *
 * Flow:
 *   1. Show the card; 30-min TTs show the verbatim effort instruction.
 *   2. On Confirm/Save:
 *      - 3K/5K: open BenchmarkOverrideDialog first (verbatim HR warning).
 *      - 30min: skip straight to step 3.
 *   3. Run detection (slowdown / breaks) from laps, load hr_sensor_type
 *      from profile, then open BenchmarkInterviewDialog.
 *   4. Persist via confirmBenchmark with the full interview payload.
 *   5. If athlete chose "Yes, reschedule": discard + reschedule, SKIP the
 *      pace-recalc and zone-comparison dialogs.
 *   6. Otherwise: threshold-pace push + optional zones + optional pace recalc.
 *   7. Fire-and-forget: benchmark-coach-verdict edge function.
 */
import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Award, Loader2, Pencil, ThumbsDown, HeartPulse, Clock, MapPin, HeartHandshake,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";
import type { CandidateActivity, ActivityForDetection } from "@/lib/benchmark-detection";
import type { BenchmarkLap } from "@/lib/benchmark-lap-matcher";
import { confirmBenchmark, rejectCandidate } from "@/lib/benchmark-persist";
import { requestBenchmarkRedo } from "@/lib/benchmark-redo";
import BenchmarkOverrideDialog from "@/components/BenchmarkOverrideDialog";
import BenchmarkInterviewDialog from "@/components/BenchmarkInterviewDialog";
import ZoneComparisonDialog from "@/components/ZoneComparisonDialog";
import PlanPaceRecalcDialog from "@/components/PlanPaceRecalcDialog";
import { pushBenchmarkThresholdPace } from "@/lib/push-benchmark-threshold-pace";
import { useHrZones } from "@/hooks/useHrZones";
import { detectBenchmarkSignals } from "@/lib/benchmark-detection-signals";
import type { InterviewAnswers, InterviewContext } from "@/lib/benchmark-interview";

interface Props {
  userId: string;
  planId: string | null;
  scheduledDateIso: string;
  protocol: BenchmarkProtocol;
  candidates: CandidateActivity[];
  onDone: () => void | Promise<void>;
  /**
   * When present, the card SKIPS the pace-recalc dialog after a successful
   * benchmark save (non-redo path) and instead invokes this callback so the
   * parent can trigger a full plan generation using the measured anchors.
   * Called after the zone-comparison dialog closes (if it was shown).
   */
  onBenchmarkConfirmed?: () => void | Promise<void>;
}

const PROTOCOL_LABEL: Record<BenchmarkProtocol, string> = {
  "30min": "30-minute threshold",
  "3k": "3K time trial",
  "5k": "5K time trial",
};

const PROTOCOL_DEFAULT_DIST_M: Record<BenchmarkProtocol, number> = {
  "30min": 0, "3k": 3000, "5k": 5000,
};

const EFFORT_INSTRUCTION_30MIN =
  "Run at the hardest pace you believe you can maintain evenly for the full 30 minutes. You should finish feeling you gave almost everything, but not having sprinted the first few minutes.";

function parseMmSs(v: string): number | null {
  const m = v.trim().match(/^(\d{1,3}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

type Pending =
  | {
      kind: "auto"; activity: ActivityForDetection; laps: BenchmarkLap[] | null;
      ctx: InterviewContext;
      storedHrSensor: string | null;
    }
  | {
      kind: "manual"; durationS: number; distanceM: number;
      ctx: InterviewContext;
      storedHrSensor: string | null;
    };

export default function BenchmarkConfirmCard({
  userId, planId, scheduledDateIso, protocol, candidates, onDone, onBenchmarkConfirmed,
}: Props) {
  const [index, setIndex] = useState(0);
  const [working, setWorking] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [redoDate, setRedoDate] = useState<{ benchmarkId: string } | null>(null);
  const [redoDateValue, setRedoDateValue] = useState<string>("");
  const [injuryPrompt, setInjuryPrompt] = useState(false);
  const [zoneDialog, setZoneDialog] = useState<{ benchmarkId: string; measuredLthr: number } | null>(null);
  const [recalcDialog, setRecalcDialog] = useState<{ thresholdSecPerKm: number; planContent: string } | null>(null);
  const { zones: currentZones } = useHrZones();

  const current = candidates[index] ?? null;
  const remaining = candidates.length - index - 1;

  const openInterview = (p: Pending) => {
    setPending(p);
    if (protocol === "3k" || protocol === "5k") {
      setOverrideOpen(true);
    } else {
      setInterviewOpen(true);
    }
  };

  const loadProfileHrSensor = async (): Promise<string | null> => {
    const { data } = await supabase
      .from("profiles").select("hr_sensor_type" as any)
      .eq("user_id", userId).maybeSingle();
    return ((data as any)?.hr_sensor_type as string | null) ?? null;
  };

  const handleConfirm = async () => {
    if (!current) return;
    setWorking(true);
    try {
      const { data: laps } = await supabase
        .from("activity_laps" as any)
        .select("lap_index, elapsed_time_s, moving_time_s, distance_m")
        .eq("activity_id", current.id)
        .order("lap_index", { ascending: true });
      const lapsArr = (laps as unknown as any[]) ?? [];
      const detection = detectBenchmarkSignals(lapsArr);
      const storedHrSensor = await loadProfileHrSensor();
      const ctx: InterviewContext = {
        hasHrStream: current.avg_heart_rate != null,
        hasActivity: true,
        detection,
        hrSensorAlreadyKnown: !!storedHrSensor,
      };
      openInterview({
        kind: "auto", activity: current, laps: lapsArr as BenchmarkLap[],
        ctx, storedHrSensor,
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
      if (remaining > 0) setIndex((i) => i + 1);
      else {
        toast.info("No more candidates in the ±48h window.");
        await onDone();
      }
    } catch (e: any) {
      toast.error("Couldn't reject candidate", { description: e?.message ?? String(e) });
    } finally { setWorking(false); }
  };

  const kickCoachVerdict = (benchmarkId: string) => {
    // Fire-and-forget — verdict failure must never block the athlete.
    void supabase.functions
      .invoke("benchmark-coach-verdict", { body: { benchmarkId } })
      .catch(() => {});
  };

  const handleInterviewSubmit = async (answers: InterviewAnswers) => {
    if (!pending) return;
    setWorking(true);
    try {
      const effectiveHrSensor = answers.hrSensorType ?? pending.storedHrSensor;
      const saved = await confirmBenchmark({
        userId, planId, scheduledDateIso, protocol,
        activity: pending.kind === "auto" ? pending.activity : null,
        laps: pending.kind === "auto" ? pending.laps : null,
        manualDurationS: pending.kind === "manual" ? pending.durationS : undefined,
        manualDistanceM: pending.kind === "manual" ? pending.distanceM : undefined,
        interview: answers,
        detection: pending.ctx.detection,
        hrSensorType: effectiveHrSensor,
      });
      toast.success("Benchmark saved");
      setInterviewOpen(false);
      setManualOpen(false);
      setPending(null);

      kickCoachVerdict(saved.id);

      if (saved.injuryFlagged) setInjuryPrompt(true);

      // ── REDO PATH ──────────────────────────────────────────────────────
      if (answers.redoChoice === "Yes, reschedule") {
        setRedoDate({ benchmarkId: saved.id });
        // Skip pace-recalc + zone-comparison dialogs entirely.
        return;
      }

      // ── NORMAL PATH ───────────────────────────────────────────────────
      void pushBenchmarkThresholdPace(saved.thresholdPaceSecPerKm).then((r) => {
        if (r.ok) toast.success(`Threshold pace synced to intervals.icu (${r.mPerSec} m/s)`);
      });

      let planContent: string | null = null;
      if (planId) {
        const { data: plan } = await supabase
          .from("training_plans").select("content").eq("id", planId).maybeSingle();
        planContent = (plan as any)?.content ?? null;
      }

      if (protocol === "30min" && saved.lthr != null && saved.lthr > 0) {
        setZoneDialog({ benchmarkId: saved.id, measuredLthr: saved.lthr });
        // Skip the pace-recalc dialog when the parent will regenerate the plan
        // from measured anchors (avoids the confusing "no pace tokens matched"
        // dialog on stub benchmark-only plans).
        if (planContent && !onBenchmarkConfirmed) {
          setRecalcDialog({ thresholdSecPerKm: saved.thresholdPaceSecPerKm, planContent });
        }
      } else if (planContent && !onBenchmarkConfirmed) {
        setRecalcDialog({ thresholdSecPerKm: saved.thresholdPaceSecPerKm, planContent });
      } else if (onBenchmarkConfirmed) {
        // No zone dialog will open — trigger the parent regeneration now.
        await onBenchmarkConfirmed();
      } else if (!injuryPrompt) {
        await onDone();
      }
    } catch (e: any) {
      toast.error("Couldn't save benchmark", { description: e?.message ?? String(e) });
    } finally { setWorking(false); }
  };

  const submitRedo = async () => {
    if (!redoDate) return;
    const iso = redoDateValue;
    if (!iso) return toast.error("Pick a date for the redo.");
    setWorking(true);
    try {
      await requestBenchmarkRedo({
        discardedBenchmarkId: redoDate.benchmarkId,
        userId, planId, protocol, newDateIso: iso,
      });
      toast.success(`Benchmark rescheduled for ${format(new Date(`${iso}T12:00:00Z`), "d MMM yyyy")}. Keep it easy until then.`);
      setRedoDate(null); setRedoDateValue("");
      await onDone();
    } catch (e: any) {
      toast.error("Couldn't reschedule", { description: e?.message ?? String(e) });
    } finally { setWorking(false); }
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
              <Button size="sm" className="flex-1" onClick={handleConfirm} disabled={working}>
                {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Confirm"}
              </Button>
              <Button size="sm" variant="outline" onClick={handleReject} disabled={working}>
                <ThumbsDown className="w-3.5 h-3.5 mr-1" /> Reject
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
        onSubmit={async ({ durationS, distanceM }) => {
          const storedHrSensor = await loadProfileHrSensor();
          const ctx: InterviewContext = {
            hasHrStream: false, // manual — no stream
            hasActivity: false,
            detection: { slowdownDetected: false, breaksDetected: false, slowdownFraction: null, totalStoppageS: null },
            hrSensorAlreadyKnown: !!storedHrSensor,
          };
          openInterview({ kind: "manual", durationS, distanceM, ctx, storedHrSensor });
        }}
      />

      <BenchmarkOverrideDialog
        open={overrideOpen}
        protocol={protocol}
        onCancel={() => { setOverrideOpen(false); setPending(null); }}
        onAcknowledge={() => { setOverrideOpen(false); setInterviewOpen(true); }}
      />

      {pending && (
        <BenchmarkInterviewDialog
          open={interviewOpen}
          working={working}
          ctx={pending.ctx}
          onCancel={() => { setInterviewOpen(false); setPending(null); }}
          onSubmit={handleInterviewSubmit}
        />
      )}

      {/* Redo date picker — only after a benchmark row was saved with redoChoice=Yes */}
      <Dialog open={!!redoDate} onOpenChange={(o) => { if (!o) { setRedoDate(null); void onDone(); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reschedule your benchmark</DialogTitle>
            <DialogDescription>
              Pick a date to redo this benchmark. Keep intensity easy until then.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="redo-date" className="text-xs">New date</Label>
            <Input
              id="redo-date" type="date"
              value={redoDateValue}
              min={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setRedoDateValue(e.target.value)}
            />
            <Button className="w-full" onClick={submitRedo} disabled={working || !redoDateValue}>
              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Reschedule"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Injury follow-up: single toast-style prompt after save. */}
      <Dialog open={injuryPrompt} onOpenChange={setInjuryPrompt}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HeartHandshake className="w-4 h-4 text-primary" /> Flagged: old injury
            </DialogTitle>
            <DialogDescription>
              You mentioned an old injury during your benchmark. Want to record any detail so future
              plans keep it in mind?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setInjuryPrompt(false)}>
              Not now
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                setInjuryPrompt(false);
                // Deep-link to profile injuries — path already exists in the app.
                window.location.href = "/settings?section=injuries";
              }}
            >
              Add details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {zoneDialog && (
        <ZoneComparisonDialog
          open={!!zoneDialog}
          onOpenChange={(o) => {
            if (!o) {
              setZoneDialog(null);
              if (onBenchmarkConfirmed) void onBenchmarkConfirmed();
              else if (!recalcDialog) void onDone();
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

      {recalcDialog && planId && (
        <PlanPaceRecalcDialog
          open={!!recalcDialog}
          onOpenChange={(o) => {
            if (!o) { setRecalcDialog(null); void onDone(); }
          }}
          planId={planId}
          planContent={recalcDialog.planContent}
          newThresholdSecPerKm={recalcDialog.thresholdSecPerKm}
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
              id="bm-dur" value={duration} onChange={(e) => setDuration(e.target.value)}
              placeholder="e.g. 24:30" inputMode="numeric" className="mt-1"
            />
            <p className="text-[11px] text-muted-foreground mt-1">{durationHelp}</p>
          </div>
          <div>
            <Label htmlFor="bm-dist" className="text-xs">Distance (km)</Label>
            <Input
              id="bm-dist" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)}
              placeholder={protocol === "30min" ? "e.g. 6.20" : "3.00"}
              inputMode="decimal" className="mt-1"
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
