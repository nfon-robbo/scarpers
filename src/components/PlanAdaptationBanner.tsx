import { useState } from "react";
import { TrendingUp, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { pushUndoEntry } from "@/lib/plan-undo-history";
import { dismissUpwardToday } from "@/lib/plan-adaptation";

interface Props {
  userId: string;
  detail?: string;
  onDone: () => void;
}

export default function PlanAdaptationBanner({ userId, detail, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleAccept = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plan-auto-adapt", {
        body: { mode: "up", reason: "readiness_high_3d_accepted" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason || "Adaptation skipped");
      if (data.plan_id && data.prev_content) {
        pushUndoEntry(data.plan_id, data.prev_content, "auto bump (up)");
      }
      toast.success("Plan bumped — go get it.", {
        description: "We added a small intensity bump to this week.",
        action: { label: "View", onClick: () => navigate("/training-plan") },
      });
      onDone();
    } catch (e) {
      toast.error("Could not adjust plan", {
        description: String((e as Error)?.message || e),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDismiss = () => {
    dismissUpwardToday(userId);
    onDone();
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-accent/10 to-background p-4 backdrop-blur-md shadow-lg">
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1.5 rounded-lg hover:bg-foreground/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-muted-foreground" />
      </button>

      <div className="flex items-start gap-3 pr-8">
        <div className="shrink-0 w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">You're trending strong</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Recovery and Running IQ have been climbing for 3+ days. Want a small intensity bump this week?
          </p>
          {detail && (
            <p className="text-[11px] text-muted-foreground/70 mt-1">{detail}</p>
          )}

          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleAccept}
              disabled={loading}
              className="h-8 rounded-lg"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Bump it
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={loading}
              className="h-8 rounded-lg"
            >
              Not now
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
