const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`;

// Client-side watchdog. We use an IDLE timeout (reset on every byte) rather
// than an absolute one, because plan generation runs the initial model call
// plus up to 4 server-side continuation passes to guarantee the plan reaches
// race day — easily >2 minutes for long plans. As long as the server is
// streaming tokens, we keep the connection alive.
const IDLE_TIMEOUT_MS_DEFAULT = 90_000;    // non-plan calls: 90s idle
const IDLE_TIMEOUT_MS_PLAN = 180_000;      // plan calls: 3min idle (server heartbeats every 20s)
// Hard ceiling so a runaway server can't keep the UI spinning forever.
const MAX_TOTAL_MS_DEFAULT = 180_000;      // most calls (chat, day-adjust, etc.)
const MAX_TOTAL_MS_PLAN = 600_000;         // plan generation may chain 4+ model calls
const PLAN_TYPES = new Set([
  "training-plan", "plan-adjust", "plan-easier", "plan-harder",
  "plan-apply", "plan-continuation",
]);

const TIMEOUT_MESSAGE = "AI gateway timed out. This usually resolves quickly.";

export async function streamAICoach({
  type,
  token,
  raceDistance,
  goalTime,
  currentPaceMin,
  currentPaceMax,
  trainingDays,
  startDate,
  raceDate,
  currentPlan,
  adjustment,
  reviewText,
  targetDate,
  todayWorkout,
  activitySummary,
  plannedWorkout,
  preservePast,
  planStartFromDate,
  todayDateUk,
  targetIsNotToday,
  measuredThresholdPaceSecPerKm,
  measuredThresholdHr,
  measuredBenchmarkDateIso,
  featureName,
  onDelta,
  onDone,
  onError,
}: {
  type: "analysis" | "training-plan" | "plan-review" | "plan-adjust" | "day-adjust" | "workout-review" | "post-plan-analysis" | "plan-continuation" | "plan-easier" | "plan-harder" | "plan-apply";
  token: string;
  raceDistance?: string;
  goalTime?: string;
  currentPaceMin?: string;
  currentPaceMax?: string;
  trainingDays?: string[];
  startDate?: string;
  raceDate?: string;
  currentPlan?: string;
  adjustment?: string;
  reviewText?: string;
  targetDate?: string;
  todayWorkout?: string;
  activitySummary?: string;
  plannedWorkout?: string;
  preservePast?: boolean;
  planStartFromDate?: string;
  todayDateUk?: string;
  targetIsNotToday?: boolean;
  /** Measured LT pace from most recent confirmed benchmark (seconds per km). */
  measuredThresholdPaceSecPerKm?: number;
  /** Measured threshold HR (bpm) — from same benchmark row. */
  measuredThresholdHr?: number;
  /** ISO date of the measured benchmark, for prompt context. */
  measuredBenchmarkDateIso?: string;
  /** Optional label for telemetry (e.g. "day-adjust", "chat"). */
  featureName?: string;
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  let settled = false;
  const maxTotalMs = PLAN_TYPES.has(type) ? MAX_TOTAL_MS_PLAN : MAX_TOTAL_MS_DEFAULT;

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;

  const fireTimeout = (reason: "idle" | "hard") => {
    if (settled) return;
    console.warn("[AI_TIMEOUT]", {
      feature: featureName || "unknown",
      reason,
      duration: Date.now() - startedAt,
      timestamp: Date.now(),
    });
    settled = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    try { controller.abort(); } catch { /* noop */ }
    onError(TIMEOUT_MESSAGE);
  };

  const resetIdle = () => {
    if (settled) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => fireTimeout("idle"), IDLE_TIMEOUT_MS);
  };

  const settle = () => {
    if (settled) return false;
    settled = true;
    if (idleTimer) clearTimeout(idleTimer);
    if (hardTimer) clearTimeout(hardTimer);
    return true;
  };

  const safeDone = () => { if (settle()) onDone(); };
  const safeError = (msg: string) => { if (settle()) onError(msg); };

  hardTimer = setTimeout(() => fireTimeout("hard"), maxTotalMs);
  resetIdle();

  try {
    const body: Record<string, unknown> = { type };
    if (raceDistance) body.race_distance = raceDistance;
    if (goalTime) body.goal_time = goalTime;
    if (currentPaceMin) body.current_pace_min = currentPaceMin;
    if (currentPaceMax) body.current_pace_max = currentPaceMax;
    if (trainingDays) body.training_days = trainingDays;
    if (startDate) body.start_date = startDate;
    if (raceDate) body.race_date = raceDate;
    if (currentPlan) body.current_plan = currentPlan;
    if (adjustment) body.adjustment = adjustment;
    if (reviewText) body.review_text = reviewText;
    if (targetDate) body.target_date = targetDate;
    if (todayWorkout) body.today_workout = todayWorkout;
    if (activitySummary) body.activity_summary = activitySummary;
    if (plannedWorkout) body.planned_workout = plannedWorkout;
    if (preservePast) body.preserve_past = true;
    if (planStartFromDate) body.plan_start_from_date = planStartFromDate;
    if (todayDateUk) body.today_date_uk = todayDateUk;
    if (targetIsNotToday) body.target_is_not_today = true;
    if (typeof measuredThresholdPaceSecPerKm === "number") body.measured_threshold_pace_s_per_km = measuredThresholdPaceSecPerKm;
    if (typeof measuredThresholdHr === "number") body.measured_threshold_hr = measuredThresholdHr;
    if (measuredBenchmarkDateIso) body.measured_benchmark_date = measuredBenchmarkDateIso;

    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!resp.ok) {
      if (resp.status === 504 || resp.status === 408) {
        safeError(TIMEOUT_MESSAGE);
        return;
      }
      const err = await resp.json().catch(() => ({ error: "Request failed" }));
      safeError(err.error || `Error ${resp.status}`);
      return;
    }

    if (!resp.body) {
      safeError("No response body");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      if (settled) return; // timeout fired while we were reading
      const { done, value } = await reader.read();
      if (done) break;
      resetIdle(); // bytes received → reset idle watchdog
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          safeDone();
          return;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content && !settled) onDelta(content);
        } catch {
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }

    // Final flush
    if (buffer.trim()) {
      for (let raw of buffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content && !settled) onDelta(content);
        } catch { /* ignore */ }
      }
    }

    safeDone();
  } catch (e: any) {
    // The timeout watchdog aborts the fetch — its onError has already fired,
    // so swallow the resulting AbortError instead of toasting "Stream failed".
    if (e?.name === "AbortError" || settled) return;
    safeError(e?.message || "Stream failed");
  }
}
