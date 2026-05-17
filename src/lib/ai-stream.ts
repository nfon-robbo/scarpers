const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-coach`;

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
  onDelta,
  onDone,
  onError,
}: {
  type: "analysis" | "training-plan" | "plan-review" | "plan-adjust" | "day-adjust" | "workout-review" | "post-plan-analysis";
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
  onDelta: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
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

    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Request failed" }));
      onError(err.error || `Error ${resp.status}`);
      return;
    }

    if (!resp.body) {
      onError("No response body");
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
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
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as string | undefined;
          if (content) onDelta(content);
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
          if (content) onDelta(content);
        } catch { /* ignore */ }
      }
    }

    onDone();
  } catch (e: any) {
    onError(e.message || "Stream failed");
  }
}
