/**
 * BenchmarkOverrideDialog — shown BEFORE confirming a 3K or 5K benchmark.
 *
 * The verbatim HR warning informs the athlete that a 3K/5K result cannot be
 * used to rebuild HR zones — only pace. They must explicitly acknowledge.
 * 30-minute benchmarks bypass this dialog entirely.
 */
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import type { BenchmarkProtocol } from "@/lib/benchmark-token";

interface Props {
  open: boolean;
  protocol: BenchmarkProtocol;
  onCancel: () => void;
  onAcknowledge: () => void;
}

export default function BenchmarkOverrideDialog({
  open, protocol, onCancel, onAcknowledge,
}: Props) {
  const label = protocol === "3k" ? "3K time trial" : "5K time trial";

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            {label} — pace only
          </AlertDialogTitle>
          <AlertDialogDescription className="leading-relaxed">
            This benchmark estimates running pace only. It cannot calculate
            threshold heart rate or rebuild your heart-rate zones.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onAcknowledge}>
            Continue anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
