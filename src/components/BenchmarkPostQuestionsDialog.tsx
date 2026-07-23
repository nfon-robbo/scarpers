/**
 * BenchmarkPostQuestionsDialog — RPE + could-continue capture after a
 * benchmark save. Answers derive `likely_submaximal` via the single rule in
 * `@/lib/benchmark-rpe`; both the confidence-score deduction and the history
 * flag read the same derived boolean.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  RPE_OPTIONS, COULD_CONTINUE_OPTIONS,
  type RpeResponse, type CouldContinueResponse,
} from "@/lib/benchmark-rpe";

interface Props {
  open: boolean;
  working?: boolean;
  onCancel: () => void;
  onSubmit: (v: {
    rpe: RpeResponse;
    couldContinue: CouldContinueResponse;
  }) => void | Promise<void>;
}

function Chips({
  options, value, onChange,
}: { options: readonly string[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "px-2.5 py-1 rounded-full text-xs border transition-colors",
            value === o
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background/60 border-border/60 hover:border-primary/50",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export default function BenchmarkPostQuestionsDialog({
  open, working, onCancel, onSubmit,
}: Props) {
  const [rpe, setRpe] = useState<RpeResponse | null>(null);
  const [cc, setCc] = useState<CouldContinueResponse | null>(null);
  const canSubmit = !!rpe && !!cc && !working;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>How did that feel?</DialogTitle>
          <DialogDescription>
            Two quick questions so we know how much to trust the result.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-1.5 block">How hard did it feel?</Label>
            <Chips options={RPE_OPTIONS} value={rpe} onChange={(v) => setRpe(v as RpeResponse)} />
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">
              Could you have kept going at that effort?
            </Label>
            <Chips options={COULD_CONTINUE_OPTIONS} value={cc} onChange={(v) => setCc(v as CouldContinueResponse)} />
          </div>

          <Button
            className="w-full"
            disabled={!canSubmit}
            onClick={() => rpe && cc && onSubmit({ rpe, couldContinue: cc })}
          >
            {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save answers"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
