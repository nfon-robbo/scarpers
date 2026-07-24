/**
 * BenchmarkFirstDialog — shown when the athlete clicks "Generate Plan".
 *
 * Decision:
 *   • Schedule benchmark first (default, date = tomorrow) — the AI plan is
 *     generated later, from measured threshold pace/HR.
 *   • Skip & use provisional pace — plan is generated immediately on
 *     history-seeded easy pace.
 *
 * Skipping must always be one tap. Nothing here can block generation.
 */
import { useState } from "react";
import { Award, Zap, CheckCircle2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduleBenchmark: (dateIso: string, protocol: BenchmarkProtocol) => void | Promise<void>;
  onSkip: () => void;
  /** When present, offers a "use existing benchmark" shortcut that builds the
   *  plan straight from the athlete's most recent confirmed benchmark. */
  existingBenchmarkDate?: string | null;
  onUseExisting?: () => void;
  scheduling?: boolean;
}

function tomorrowIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function formatUk(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function BenchmarkFirstDialog({
  open, onOpenChange, onScheduleBenchmark, onSkip, existingBenchmarkDate, onUseExisting, scheduling,
}: Props) {
  const [dateIso, setDateIso] = useState(tomorrowIso());
  const [protocol] = useState<BenchmarkProtocol>("30min");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Award className="w-4 h-4 text-primary" /> Benchmark first?
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            The benchmark is a 30-minute threshold run. Measuring it first means every
            pace and HR target in your plan is built on real data — not a history-based
            guess.
          </DialogDescription>
        </DialogHeader>

        {existingBenchmarkDate && onUseExisting && (
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              You already have a confirmed benchmark
            </div>
            <p className="text-xs text-muted-foreground">
              Last benchmark: {formatUk(existingBenchmarkDate)}. Build your plan straight
              from those measured anchors.
            </p>
            <Button
              size="sm"
              className="w-full"
              disabled={scheduling}
              onClick={onUseExisting}
            >
              Use my last benchmark ({formatUk(existingBenchmarkDate)})
            </Button>
          </div>
        )}

        <div className="space-y-2 pt-2">
          <Label htmlFor="benchmark-date" className="text-xs">Schedule a new benchmark</Label>
          <Input
            id="benchmark-date"
            type="date"
            value={dateIso}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setDateIso(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            Protocol: 30-minute threshold. 3K / 5K options can be added later.
          </p>
        </div>

        <DialogFooter className="flex-col sm:flex-col gap-2 sm:space-x-0">
          <Button
            className="w-full"
            variant={existingBenchmarkDate ? "outline" : "default"}
            disabled={!dateIso || scheduling}
            onClick={() => onScheduleBenchmark(dateIso, protocol)}
          >
            <Award className="w-4 h-4 mr-2" />
            {scheduling ? "Scheduling…" : "Schedule new benchmark"}
          </Button>
          <Button variant="outline" className="w-full" onClick={onSkip} disabled={scheduling}>
            <Zap className="w-4 h-4 mr-2" />
            Skip — generate now on provisional pace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
