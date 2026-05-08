import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Undo2, Loader2 } from "lucide-react";
import {
  getGarminUndoInfo, undoLastGarminImport, type GarminUndoSnapshot,
} from "@/lib/garmin-export-import";

const UndoGarminImportButton = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [info, setInfo] = useState<GarminUndoSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => setInfo(user ? getGarminUndoInfo(user.id) : null);
  useEffect(() => { refresh(); }, [user?.id]);

  if (!info || !user) return null;

  const handleUndo = async () => {
    setBusy(true);
    try {
      const res = await undoLastGarminImport(user.id);
      if (res.errors.length) {
        toast({
          title: "Undo finished with errors",
          description: res.errors.slice(0, 2).join(" • "),
          variant: "destructive",
        });
      } else {
        toast({
          title: "Import undone",
          description: `Restored ${res.restored} previous record(s).`,
        });
      }
      refresh();
      // Reload so the page reflects restored data
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      toast({ title: "Undo failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Undo2 className="w-4 h-4 mr-2" />}
          Undo Garmin import
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Undo last Garmin import?</AlertDialogTitle>
          <AlertDialogDescription>
            Reverts the import from <strong>{info.fileName}</strong> ({new Date(info.createdAt).toLocaleString("en-GB")}).
            <br />
            This will remove the {info.counts.activities} imported activities, {info.counts.dailyMetrics} wellness days,
            and {info.counts.sleepDays} sleep nights, and restore your previous data.
            {info.truncated && (
              <span className="block mt-2 text-destructive">
                Note: snapshot was too large to store fully — previously-overlapping records cannot be restored, but the imported records will be removed.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleUndo}>Undo import</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default UndoGarminImportButton;
