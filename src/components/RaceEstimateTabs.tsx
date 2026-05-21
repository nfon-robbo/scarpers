import { useState } from "react";
import { Target, LineChart as LineChartIcon } from "lucide-react";
import RaceTimeEstimate from "@/components/RaceTimeEstimate";
import RacePredictionGraph from "@/components/RacePredictionGraph";
import type { ParsedWorkout } from "@/lib/plan-export";

interface Props {
  workouts: ParsedWorkout[];
  linkedActivities: Record<string, any>;
  raceDistance?: string;
  goalTime?: string;
  goalSeconds?: number | null;
  refreshKey?: number;
}

function distanceLabel(rd?: string): string {
  switch ((rd || "").toLowerCase()) {
    case "5k": return "5K";
    case "10k": return "10K";
    case "half-marathon": return "Half Marathon";
    case "marathon": return "Marathon";
    default: return rd || "Race";
  }
}

export default function RaceEstimateTabs({
  workouts,
  linkedActivities,
  raceDistance,
  goalTime,
  goalSeconds,
  refreshKey,
}: Props) {
  const [tab, setTab] = useState<"estimate" | "progress">("estimate");

  const tabs: { id: "estimate" | "progress"; label: string; icon: React.ReactNode }[] = [
    { id: "estimate", label: `Estimated ${distanceLabel(raceDistance)} Time`, icon: <Target className="w-3.5 h-3.5" /> },
    { id: "progress", label: "Progress", icon: <LineChartIcon className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="relative">
      {/* Browser-style tab strip */}
      <div className="flex items-end gap-1 px-1 -mb-px relative z-10">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={[
                "group flex items-center gap-1.5 px-3 pt-2 pb-2.5 text-xs font-medium",
                "rounded-t-lg border border-b-0 transition-colors",
                "max-w-[220px] truncate",
                active
                  ? "bg-card text-foreground border-border/40 shadow-[0_-1px_0_0_hsl(var(--background))]"
                  : "bg-muted/40 text-muted-foreground border-transparent hover:bg-muted/60 hover:text-foreground/80",
              ].join(" ")}
            >
              <span className={active ? "text-primary" : "text-muted-foreground"}>{t.icon}</span>
              <span className="truncate">{t.label}</span>
            </button>
          );
        })}
        {/* faux address-bar dot row, purely decorative */}
        <div className="ml-auto hidden sm:flex items-center gap-1 pb-2 pr-2 opacity-60">
          <span className="w-2 h-2 rounded-full bg-destructive/60" />
          <span className="w-2 h-2 rounded-full bg-amber-400/60" />
          <span className="w-2 h-2 rounded-full bg-green-500/60" />
        </div>
      </div>

      {/* Content panel — styled like the body of a browser window */}
      <div className="rounded-xl rounded-tl-none border border-border/40 bg-card overflow-hidden [&>*]:!border-0 [&>*]:!bg-transparent [&>*]:!shadow-none [&>*]:!rounded-none">
        {tab === "estimate" ? (
          <RaceTimeEstimate
            workouts={workouts}
            linkedActivities={linkedActivities}
            raceDistance={raceDistance}
            goalTime={goalTime}
          />
        ) : (
          <RacePredictionGraph
            raceDistance={raceDistance}
            goalSeconds={goalSeconds}
            refreshKey={refreshKey}
          />
        )}
      </div>
    </div>
  );
}
