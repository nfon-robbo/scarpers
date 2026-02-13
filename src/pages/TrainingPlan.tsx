import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, RotateCcw, Target, Layers, Clock } from "lucide-react";
import MarkdownRenderer from "@/components/MarkdownRenderer";

const TrainingPlanPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const generatePlan = async () => {
    if (!user) return;
    setLoading(true);
    setContent("");
    setHasRun(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setLoading(false);
      return;
    }

    let accumulated = "";
    streamAICoach({
      type: "training-plan",
      token: session.access_token,
      onDelta: (text) => {
        accumulated += text;
        setContent(accumulated);
      },
      onDone: () => setLoading(false),
      onError: (err) => {
        toast({ title: "Plan generation failed", description: err, variant: "destructive" });
        setLoading(false);
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Calendar className="w-8 h-8 text-primary" />
            Training Plan
          </h1>
          <p className="text-muted-foreground mt-1">
            Season strategy + detailed 4-week periodized plan
          </p>
        </div>
        <Button onClick={generatePlan} disabled={loading} size="lg">
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : hasRun ? (
            <>
              <RotateCcw className="w-4 h-4 mr-2" />
              Regenerate
            </>
          ) : (
            <>
              <Calendar className="w-4 h-4 mr-2" />
              Generate Plan
            </>
          )}
        </Button>
      </div>

      {!hasRun && !loading && (
        <div className="grid gap-4 sm:grid-cols-3">
          <FeatureCard icon={Target} title="Season Strategy" desc="12-24 week macro-cycle with race anchors and phase architecture" />
          <FeatureCard icon={Layers} title="4-Week Block" desc="28-day detailed plan with daily workouts, zones, and targets" />
          <FeatureCard icon={Clock} title="Periodization" desc="Build weeks + recovery week with progressive overload" />
        </div>
      )}

      {(content || loading) && (
        <Card>
          <CardContent className="p-6">
            {content ? (
              <MarkdownRenderer content={content} />
            ) : (
              <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Generating your personalized training plan...</span>
              </div>
            )}
            {loading && content && (
              <div className="flex items-center gap-2 mt-4 text-sm text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Still generating...</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

const FeatureCard = ({ icon: Icon, title, desc }: { icon: any; title: string; desc: string }) => (
  <Card className="border-dashed">
    <CardHeader className="p-4">
      <div className="rounded-lg bg-primary/10 p-2 w-fit mb-2">
        <Icon className="w-5 h-5 text-primary" />
      </div>
      <CardTitle className="text-sm">{title}</CardTitle>
      <CardDescription className="text-xs">{desc}</CardDescription>
    </CardHeader>
  </Card>
);

export default TrainingPlanPage;
