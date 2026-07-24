// Client helpers for the durable plan-generation job pipeline.
// See supabase/migrations/*_plan_generation_jobs — a row per in-progress
// plan generation. The edge function mirrors streamed tokens into
// `content`, so if the user navigates away, refreshes, or closes the
// browser mid-generation, they can resume from wherever the server got to
// — no tokens burned re-running the model.

import { supabase } from "@/integrations/supabase/client";

export type PlanJobStatus = "running" | "done" | "error" | "cancelled";

export interface PlanGenerationJob {
  id: string;
  user_id: string;
  type: string;
  status: PlanJobStatus;
  request: Record<string, unknown>;
  content: string;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

const ACTIVE_JOB_KEY = (userId: string) => `plan-gen-job:${userId}`;

export function rememberJobId(userId: string, jobId: string) {
  try { localStorage.setItem(ACTIVE_JOB_KEY(userId), jobId); } catch { /* ignore */ }
}

export function forgetJobId(userId: string) {
  try { localStorage.removeItem(ACTIVE_JOB_KEY(userId)); } catch { /* ignore */ }
}

export function getRememberedJobId(userId: string): string | null {
  try { return localStorage.getItem(ACTIVE_JOB_KEY(userId)); } catch { return null; }
}

/**
 * Create a new plan-generation job row. The returned id is passed to the
 * edge function so it can mirror progress to it.
 */
export async function createPlanJob(params: {
  userId: string;
  type: string;
  request: Record<string, unknown>;
}): Promise<string | null> {
  // Best-effort: cancel any existing "running" job of the same type so the
  // partial-index unique constraint doesn't block us.
  try {
    await supabase
      .from("plan_generation_jobs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("user_id", params.userId)
      .eq("type", params.type)
      .eq("status", "running");
  } catch { /* ignore */ }

  const { data, error } = await supabase
    .from("plan_generation_jobs")
    .insert([{
      user_id: params.userId,
      type: params.type,
      status: "running",
      request: params.request as any,
      content: "",
    }])
    .select("id")
    .single();


  if (error || !data) {
    console.error("[plan-job] create failed:", error);
    return null;
  }
  rememberJobId(params.userId, data.id);
  return data.id;
}

export async function fetchJob(jobId: string): Promise<PlanGenerationJob | null> {
  const { data, error } = await supabase
    .from("plan_generation_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as PlanGenerationJob;
}

/**
 * Find the most-recently-updated running or recently-finished job for this
 * user — used on TrainingPlan mount / app cold-start to resume automatically.
 */
export async function findResumableJob(userId: string): Promise<PlanGenerationJob | null> {
  // Prefer any still-running job.
  const { data: running } = await supabase
    .from("plan_generation_jobs")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "running")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (running && running.length) return running[0] as unknown as PlanGenerationJob;

  // Otherwise fall back to a very recent done/error job that the client
  // hasn't acknowledged yet (localStorage id).
  const remembered = getRememberedJobId(userId);
  if (!remembered) return null;
  const job = await fetchJob(remembered);
  if (!job) return null;
  const finishedAgeMs = job.finished_at ? Date.now() - new Date(job.finished_at).getTime() : Infinity;
  if (job.status === "done" && finishedAgeMs < 24 * 60 * 60 * 1000) return job;
  return null;
}

export interface JobSubscription {
  unsubscribe: () => void;
}

/**
 * Subscribe to live updates on a job row and diff `content` against the
 * caller's local high-water-mark so we can call `onDelta` with only the
 * new suffix (mirroring the SSE flow).
 */
export function subscribeToJob(
  jobId: string,
  initialContent: string,
  handlers: {
    onDelta: (chunk: string) => void;
    onDone: (finalContent: string) => void;
    onError: (message: string) => void;
    onCancelled?: () => void;
  },
): JobSubscription {
  let seen = initialContent.length;

  const apply = (row: PlanGenerationJob) => {
    if (typeof row.content === "string" && row.content.length > seen) {
      const chunk = row.content.slice(seen);
      seen = row.content.length;
      handlers.onDelta(chunk);
    }
    if (row.status === "done") handlers.onDone(row.content ?? "");
    else if (row.status === "error") handlers.onError(row.error || "Plan generation failed");
    else if (row.status === "cancelled") handlers.onCancelled?.();
  };

  const channel = supabase
    .channel(`plan-gen-job:${jobId}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "plan_generation_jobs", filter: `id=eq.${jobId}` },
      (payload) => apply(payload.new as unknown as PlanGenerationJob),
    )
    .subscribe();

  // Also poll once immediately in case we missed events between fetch and subscribe.
  void fetchJob(jobId).then((row) => { if (row) apply(row); });

  return {
    unsubscribe: () => { void supabase.removeChannel(channel); },
  };
}

export async function markJobCancelled(jobId: string) {
  try {
    await supabase
      .from("plan_generation_jobs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", jobId);
  } catch { /* ignore */ }
}
