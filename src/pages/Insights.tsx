import { Brain, Moon } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import WellnessTab from "@/components/insights/WellnessTab";
import AnalysisTab from "@/components/insights/AnalysisTab";

const InsightsPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "analysis" ? "analysis" : "wellness";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Brain className="w-6 h-6 sm:w-8 sm:h-8 text-primary shrink-0" />
          Insights
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Wellness metrics & AI-powered training analysis</p>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => setSearchParams(v === "analysis" ? { tab: "analysis" } : {}, { replace: true })}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="wellness" className="gap-1.5">
            <Moon className="w-4 h-4" />
            Wellness
          </TabsTrigger>
          <TabsTrigger value="analysis" className="gap-1.5">
            <Brain className="w-4 h-4" />
            AI Analysis
          </TabsTrigger>
        </TabsList>
        <TabsContent value="wellness">
          <WellnessTab />
        </TabsContent>
        <TabsContent value="analysis">
          <AnalysisTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InsightsPage;
