import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { streamAICoach } from "@/lib/ai-stream";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Brain, Loader2, RotateCcw, BarChart3, HeartPulse, Lightbulb, Activity, ChevronLeft, Trash2, Plus } from "lucide-react";
import { format } from "date-fns";
import MarkdownRenderer from "@/components/MarkdownRenderer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

interface SavedAnalysis {
  id: string;
  content: string;
  created_at: string;
}

const AnalysisPage = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "detail" | "generating">("list");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const loadAnalyses = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("analyses")
      .select("id, content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    setAnalyses(data || []);
    setLoadingList(false);
  }, [user]);

  useEffect(() => { loadAnalyses(); }, [loadAnalyses]);

  const runAnalysis = async () => {
    if (!user) return;
    setLoading(true);
    setContent("");
    setView("generating");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({ title: "Session expired", description: "Please sign in again.", variant: "destructive" });
      setLoading(false);
      setView("list");
      return;
    }

    let accumulated = "";
    streamAICoach({
      type: "analysis",
      token: session.access_token,
      onDelta: (text) => {
        accumulated += text;
        setContent(accumulated);
      },
      onDone: async () => {
        setLoading(false);
        // Save to database
        const { data, error } = await supabase
          .from("analyses")
          .insert({ user_id: user.id, content: accumulated })
          .select("id, content, created_at")
          .single();
        if (!error && data) {
          setAnalyses(prev => [data, ...prev]);
          setSelectedId(data.id);
          setView("detail");
          toast({ title: "Analysis saved" });
        }
      },
      onError: (err) => {
        toast({ title: "Analysis failed", description: err, variant: "destructive" });
        setLoading(false);
        setView("list");
      },
    });
  };

  const deleteAnalysis = async (id: string) => {
    await supabase.from("analyses").delete().eq("id", id);
    setAnalyses(prev => prev.filter(a => a.id !== id));
    if (selectedId === id) {
      setView("list");
      setSelectedId(null);
      setContent("");
    }
    toast({ title: "Analysis deleted" });
    setDeleteId(null);
  };

  const viewAnalysis = (analysis: SavedAnalysis) => {
    setContent(analysis.content);
    setSelectedId(analysis.id);
    setView("detail");
  };

  if (loadingList) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {view !== "list" && (
              <Button variant="ghost" size="icon" onClick={() => { setView("list"); setSelectedId(null); setContent(""); }} className="shrink-0">
                <ChevronLeft className="w-5 h-5" />
              </Button>
            )}
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
              <Brain className="w-6 h-6 sm:w-8 sm:h-8 text-primary shrink-0" />
              AI Analysis
            </h1>
          </div>
          {view === "list" && (
            <Button onClick={runAnalysis} disabled={loading}>
              <Plus className="w-4 h-4 mr-2" />
              New Analysis
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {view === "list"
            ? "Multi-domain training analysis history"
            : "KPI dashboard, execution, physiology & recommendations"
          }
        </p>
      </div>

      {/* List view */}
      {view === "list" && (
        <>
          {analyses.length === 0 ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <FeatureCard icon={BarChart3} title="KPI Dashboard" desc="Training load, ACWR, volume trends" />
                <FeatureCard icon={Activity} title="Execution Analysis" desc="Pace progression, HR efficiency" />
                <FeatureCard icon={HeartPulse} title="Physiology & Readiness" desc="Recovery patterns, crash detection" />
                <FeatureCard icon={Lightbulb} title="Recommendations" desc="Actionable coaching insights" />
              </div>
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">No analyses yet. Run your first one to get started.</p>
                <Button onClick={runAnalysis} size="lg">
                  <Brain className="w-4 h-4 mr-2" />
                  Run Analysis
                </Button>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {analyses.map((a) => (
                <Card key={a.id} className="cursor-pointer hover:bg-accent/30 transition-colors" onClick={() => viewAnalysis(a)}>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <Brain className="w-5 h-5 text-primary shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          Training Analysis
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(a.created_at), "dd MMM yyyy, HH:mm")}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteId(a.id); }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {/* Detail / generating view */}
      {(view === "detail" || view === "generating") && (
        <Card>
          <CardContent className="p-4 sm:p-6">
            {content ? (
              <MarkdownRenderer content={content} />
            ) : (
              <div className="flex items-center gap-3 py-8 justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Analyzing your training data across multiple domains...</span>
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

      {/* Delete dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this analysis?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this analysis. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteAnalysis(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

export default AnalysisPage;
