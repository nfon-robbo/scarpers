import { useState } from "react";
import { TrendingUp, TrendingDown, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { pushUndoEntry } from "@/lib/plan-undo-history";
import { dismissUpwardToday, dismissDownwardToday } from "@/lib/plan-adaptation";

interface Props {
  userId: string;
  direction: "up" | "down";
  detail?: string;
  onDone: () => void;
}

export default function PlanAdaptationBanner({ userId, direction, detail, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const isDown = direction === "down";

  const handleAccept = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plan-auto-adapt", {
        body: {
          mode: direction,
          reason: isDown ? "readiness_low_2d_accepted" : "readiness_high_3d_accepted",
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason || "Adaptation skipped");
      const canUndo = data.plan_id && data.prev_content;
      if (canUndo) {
        pushUndoEntry(
          data.plan_id,
          data.prev_content,
          isDown ? "auto recovery adjustment" : "auto bump (up)"
        );
      }
      toast.success(
        isDown ? "This week eased — get some rest." : "Plan bumped — go get it.",
        {
          description: isDown
            ? "Intervals swapped to easy runs and durations trimmed ~15%."
            : "We added a small intensity bump to this week.",
          action: {
            label: canUndo ? "Undo" : "View",
            onClick: async () => {
              if (canUndo) {
                await supabase.from("training_plans").update({ content: data.prev_content }).eq("id", data.plan_id);
              }
              navigate("/training-plan");
            },
          },
        }
      );
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
    if (isDown) dismissDownwardToday(userId);
    else dismissUpwardToday(userId);
    onDone();
  };

  const Icon = isDown ? TrendingDown : TrendingUp;
  const title = isDown ? "Ease this week?" : "You're trending strong";
  const body = isDown
    ? "Recovery has been low for 2 days. We can drop this week's intensity ~15% and swap any intervals for easy runs."
    : "Recovery and Running IQ have been climbing for 3+ days. Want a small intensity bump this week?";
  const acceptLabel = isDown ? "Ease this week" : "Bump it";
  const dismissLabel = isDown ? "Keep as planned" : "Not now";

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
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{body}</p>
          {/* Readiness trigger details are intentionally hidden while score UI is disabled. */}

          <div className="flex items-center gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleAccept}
              disabled={loading}
              className="h-8 rounded-lg"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              {acceptLabel}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={loading}
              className="h-8 rounded-lg"
            >
              {dismissLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
