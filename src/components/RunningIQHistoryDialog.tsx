import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, TrendingUp, Sparkles } from "lucide-react";
import MarkdownRenderer from "./MarkdownRenderer";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current?: {
    adjustedScore: number;
    label: string;
    pillars: { name: string; score: number; weight: number; icon: string }[];
    lowestPillar?: string;
    coachingTip?: string;
  } | null;
}

interface Snapshot {
  recorded_at: string;
  score: number;
  adjusted_score: number;
  label: string;
  pillars: any;
  lowest_pillar: string | null;
  coaching_tip: string | null;
}

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 12,
  fontSize: 12,
  boxShadow: "0 8px 32px -8px hsl(var(--foreground) / 0.1)",
};

const SCORE_BANDS = [
  {
    range: "160 – 200",
    label: "Elite",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    description:
      "Highly trained engine. Strong VO₂ max, solid recovery markers, consistent volume and very few missed sessions.",
  },
  {
    range: "140 – 159",
    label: "Advanced",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    description:
      "Well-developed aerobic base with good form metrics (cadence, HR efficiency) and steady week-on-week training.",
  },
  {
    range: "100 – 139",
    label: "Intermediate",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    description:
      "Solid fitness, room to grow. Usually one or two pillars (volume, consistency, recovery) holding you back.",
  },
  {
    range: "60 – 99",
    label: "Developing",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    description:
      "Building fitness. Often low volume, irregular consistency or recovery markers still settling in.",
  },
  {
    range: "0 – 59",
    label: "Beginner",
    color: "text-destructive",
    bg: "bg-destructive/10",
    description:
      "Just getting started or returning from a break. Focus on regular easy runs and sleep.",
  },
];

const PILLAR_INFO: Record<string, string> = {
  Fitness:
    "VO₂ max, resting HR and HRV — how strong your engine is and how well it recovers.",
  Volume:
    "Weekly running distance vs your historical baseline. Bigger sustained volume → higher score.",
  Consistency:
    "How regularly you train. Streaks, week-on-week stability and missed planned sessions all count.",
  Form:
    "Cadence and HR efficiency (pace at a given heart rate). Improves as running economy improves.",
  Recovery:
    "Sleep score, HRV trend and readiness. Reflects whether you're absorbing the training.",
};

const RunningIQHistoryDialog = ({ open, onOpenChange, current }: Props) => {
  const { user } = useAuth();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [advice, setAdvice] = useState<string>("");
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string>("");

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    supabase
      .from("running_iq_snapshots")
      .select(
        "recorded_at, score, adjusted_score, label, pillars, lowest_pillar, coaching_tip"
      )
      .eq("user_id", user.id)
      .gte("recorded_at", ninetyDaysAgo)
      .order("recorded_at", { ascending: true })
      .then(({ data }) => {
        setSnapshots((data as Snapshot[]) || []);
        setLoading(false);
      });
  }, [open, user]);

  // Fetch AI advice on how to improve
  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    setAdvice("");
    setAdviceError("");
    setAdviceLoading(true);
    supabase.functions
      .invoke("running-iq-advice", {
        body: {
          score: current.adjustedScore,
          label: current.label,
          pillars: current.pillars,
          lowest_pillar: current.lowestPillar,
        },
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.advice) {
          setAdviceError("Couldn't load coaching advice right now.");
        } else {
          setAdvice(data.advice);
        }
      })
      .finally(() => {
        if (!cancelled) setAdviceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, current?.adjustedScore, current?.lowestPillar]);

  const timeline = useMemo(
    () =>
      snapshots.map((s) => ({
        time: new Date(s.recorded_at).toLocaleDateString("en-GB", {
          day: "2-digit",
          month: "short",
        }),
        score: s.adjusted_score,
      })),
    [snapshots]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Running IQ — History & Explainer
          </DialogTitle>
          <DialogDescription>
            How your score is built and how it has trended over the last 90 days.
          </DialogDescription>
        </DialogHeader>

        {/* AI coaching advice — how to raise your score */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-accent/5">
          <CardContent className="pt-5 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              How to raise your score
            </h3>
            {adviceLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
                <Loader2 className="w-4 h-4 animate-spin" />
                Coach Claire Rayners is thinking…
              </div>
            ) : adviceError ? (
              <p className="text-xs text-muted-foreground">{adviceError}</p>
            ) : advice ? (
              <div className="text-xs leading-relaxed">
                <MarkdownRenderer content={advice} />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Coaching advice will appear here once your score is calculated.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Timeline */}
        <Card>
          <CardContent className="pt-5 pb-2 pr-2">
            <h3 className="text-sm font-semibold mb-3 px-2">Score timeline</h3>
            {loading ? (
              <div className="h-[220px] flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : timeline.length < 2 ? (
              <p className="text-sm text-muted-foreground px-2 py-8 text-center">
                Not enough history yet — keep running and snapshots will appear here.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={timeline}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="time"
                    tick={{ fontSize: 10 }}
                    className="fill-muted-foreground"
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 200]}
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <ReferenceLine
                    y={140}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.4}
                    label={{ value: "Advanced", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "right" }}
                  />
                  <ReferenceLine
                    y={80}
                    stroke="hsl(var(--muted-foreground))"
                    strokeDasharray="4 4"
                    strokeOpacity={0.4}
                    label={{ value: "Developing", fontSize: 10, fill: "hsl(var(--muted-foreground))", position: "right" }}
                  />
                  <defs>
                    <linearGradient id="iqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    fill="url(#iqGrad)"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Why this score — pillar breakdown for the current score */}
        {current && (
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-semibold">Why you scored {current.adjustedScore}</h3>
                <span className="text-xs text-muted-foreground">{current.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Your IQ is a weighted blend of five pillars, scaled 0–100 each and combined into a 0–200 total. Today's contribution:
              </p>
              <div className="space-y-2">
                {current.pillars.map((p) => (
                  <div key={p.name} className="text-xs">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium flex items-center gap-1.5">
                        <span>{p.icon}</span>
                        {p.name}
                        <span className="text-muted-foreground/60">
                          ({Math.round(p.weight * 100)}% weight)
                        </span>
                      </span>
                      <span className="font-bold">{p.score}/100</span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      {PILLAR_INFO[p.name] ?? ""}
                    </p>
                  </div>
                ))}
              </div>
              {current.coachingTip && (
                <div className="mt-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
                  <p className="text-xs font-semibold mb-1">Biggest lever: {current.lowestPillar}</p>
                  <p className="text-xs text-muted-foreground">{current.coachingTip}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Score bands */}
        <Card>
          <CardContent className="pt-5 space-y-3">
            <h3 className="text-sm font-semibold">What each score means</h3>
            <div className="space-y-2">
              {SCORE_BANDS.map((band) => (
                <div
                  key={band.range}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border/50"
                >
                  <div
                    className={`shrink-0 px-2 py-1 rounded-md text-xs font-bold ${band.bg} ${band.color}`}
                  >
                    {band.range}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-semibold ${band.color}`}>
                      {band.label}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
                      {band.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground italic pt-1">
              The raw 0–200 score is scaled ±10% by current readiness, so heavy fatigue or poor recovery can temporarily nudge it down even if your underlying fitness hasn't changed.
            </p>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  );
};

export default RunningIQHistoryDialog;
