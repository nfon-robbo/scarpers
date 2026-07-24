import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Loader2, Circle, AlertTriangle, Database, Activity, Heart, Target, Sparkles, Save, Search, HardDrive, Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type BuildStepStatus = "pending" | "active" | "done" | "warn" | "skip";

export interface BuildStep {
  id: string;
  label: string;
  status: BuildStepStatus;
  icon?: "db" | "activity" | "heart" | "target" | "sparkles" | "save" | "search";
  /** Data the coach IS using for this step (facts pulled from your history). */
  inputs?: string[];
  /** What the app found / decided from the inputs. */
  findings?: string[];
  /** How this feeds into the plan being built. */
  usage?: string[];
}

export interface BuildJobProgress {
  bytes: number;
  status: string;
  updatedAt: string | null;
  jobId?: string | null;
}

const ICONS = {
  db: Database,
  activity: Activity,
  heart: Heart,
  target: Target,
  sparkles: Sparkles,
  save: Save,
  search: Search,
} as const;

function StatusDot({ status }: { status: BuildStepStatus }) {
  if (status === "active") return <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />;
  if (status === "done") return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  if (status === "skip") return <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />;
  return <Circle className="w-4 h-4 text-muted-foreground/40 shrink-0" />;
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  if (bytes < 1024) return `${bytes.toLocaleString()} bytes`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatUpdatedAt(value: string | null) {
  if (!value) return "not written yet";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
}

export default function PlanBuildProgress({
  steps,
  title = "Building your plan",
  jobProgress,
}: {
  steps: BuildStep[];
  title?: string;
  jobProgress?: BuildJobProgress | null;
}) {
  const total = steps.filter((s) => s.status !== "skip").length;
  const done = steps.filter((s) => s.status === "done").length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <Card className="border-primary/30">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-4 h-4 text-primary" />
            {title}
          </CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">{done}/{total} · {pct}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        {jobProgress ? (
          <div className="grid gap-2 rounded-lg border border-border/80 bg-muted/30 p-3 text-xs sm:grid-cols-2">
            <div className="flex items-center gap-2 text-foreground">
              <HardDrive className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">Persisted</span>
              <span className="tabular-nums text-muted-foreground">{formatBytes(jobProgress.bytes)}</span>
            </div>
            <div className="flex items-center gap-2 text-foreground sm:justify-end">
              <Clock3 className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium">Last write</span>
              <span className="tabular-nums text-muted-foreground">{formatUpdatedAt(jobProgress.updatedAt)}</span>
            </div>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {steps.map((step) => {
          const Icon = step.icon ? ICONS[step.icon] : null;
          const dim = step.status === "pending" || step.status === "skip";
          return (
            <div
              key={step.id}
              className={cn(
                "rounded-lg border p-3 transition-colors",
                step.status === "active" && "border-primary/40 bg-primary/5",
                step.status === "done" && "border-emerald-500/20 bg-emerald-500/[0.03]",
                step.status === "warn" && "border-amber-500/30 bg-amber-500/[0.04]",
                dim && "opacity-60",
              )}
            >
              <div className="flex items-start gap-2">
                <StatusDot status={step.status} />
                {Icon && <Icon className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium leading-tight">
                    {step.label}
                    {step.status === "skip" && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">skipped</span>}
                  </div>
                  {(step.inputs?.length || step.findings?.length || step.usage?.length) ? (
                    <div className="mt-2 space-y-1.5 text-xs">
                      {step.inputs?.length ? (
                        <DetailRow label="Data used" items={step.inputs} tone="muted" />
                      ) : null}
                      {step.findings?.length ? (
                        <DetailRow label="Found" items={step.findings} tone="foreground" />
                      ) : null}
                      {step.usage?.length ? (
                        <DetailRow label="Feeding into plan" items={step.usage} tone="primary" />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function DetailRow({ label, items, tone }: { label: string; items: string[]; tone: "muted" | "foreground" | "primary" }) {
  return (
    <div>
      <div className={cn(
        "text-[10px] uppercase tracking-wide font-semibold mb-0.5",
        tone === "muted" && "text-muted-foreground",
        tone === "foreground" && "text-foreground/80",
        tone === "primary" && "text-primary",
      )}>{label}</div>
      <ul className="space-y-0.5 pl-3 list-disc marker:text-muted-foreground/60">
        {items.map((it, i) => (
          <li key={i} className="text-foreground/90 leading-snug break-words">{it}</li>
        ))}
      </ul>
    </div>
  );
}
