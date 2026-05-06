import { Capacitor } from "@capacitor/core";
import { HealthConnect } from "capacitor-health-connect";
import { supabase } from "@/integrations/supabase/client";

export const isHealthConnectPlatform = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

const READ_TYPES = [
  "SleepSession",
  "HeartRate",
  "RestingHeartRate",
  "Steps",
  "ActiveCaloriesBurned",
  "TotalCaloriesBurned",
] as const;

export async function ensureHealthConnectAvailable() {
  const status = await HealthConnect.checkAvailability();
  return status.availability; // "Available" | "NotInstalled" | "NotSupported"
}

export async function requestHealthConnectPermissions() {
  const perms = READ_TYPES.map((t) => ({ type: t, accessType: "read" as const }));
  return HealthConnect.requestHealthPermissions({ readTypes: READ_TYPES as unknown as string[] });
}

// Map Health Connect sleep stage codes to our stage names
// 1=Awake, 2=Sleeping(generic), 4=Light, 5=Deep, 6=REM, 7=Out of bed, 0=Unknown
const STAGE_MAP: Record<number, string> = {
  1: "awake",
  2: "sleep",
  4: "light",
  5: "deep",
  6: "rem",
};

export async function syncHealthConnect(userId: string, daysBack = 7) {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400000);
  const range = {
    type: "between" as const,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
  };

  let sleepCount = 0;
  let metricsCount = 0;

  // ---------- Sleep ----------
  try {
    const sleep: any = await HealthConnect.readRecords({
      type: "SleepSession",
      timeRangeFilter: range,
    });
    const records = sleep?.records ?? [];
    for (const session of records) {
      const sleepDate = new Date(session.endTime).toISOString().split("T")[0];

      // Wipe prior health-connect data for this date so re-sync is idempotent
      await supabase
        .from("sleep_stages")
        .delete()
        .eq("user_id", userId)
        .eq("date", sleepDate)
        .eq("source", "health_connect");

      const stages = session.stages ?? [];
      if (stages.length > 0) {
        for (const s of stages) {
          const name = STAGE_MAP[s.stage];
          if (!name) continue;
          const dur = Math.round(
            (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / 1000
          );
          if (dur <= 0) continue;
          await supabase.from("sleep_stages").insert({
            user_id: userId,
            date: sleepDate,
            stage: name,
            duration_seconds: dur,
            start_time: new Date(s.startTime).toISOString(),
            end_time: new Date(s.endTime).toISOString(),
            source: "health_connect",
          });
          sleepCount++;
        }
      } else {
        const dur = Math.round(
          (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000
        );
        await supabase.from("sleep_stages").insert({
          user_id: userId,
          date: sleepDate,
          stage: "sleep",
          duration_seconds: dur,
          start_time: new Date(session.startTime).toISOString(),
          end_time: new Date(session.endTime).toISOString(),
          source: "health_connect",
        });
        sleepCount++;
      }
    }
  } catch (e) {
    console.error("HC sleep error", e);
  }

  // ---------- Daily metrics: steps, calories, resting HR ----------
  // Aggregate per day client-side
  const days: string[] = [];
  for (let i = 0; i < daysBack; i++) {
    const d = new Date(end.getTime() - i * 86400000);
    days.push(d.toISOString().split("T")[0]);
  }

  const safeRead = async (type: string) => {
    try {
      const res: any = await HealthConnect.readRecords({ type, timeRangeFilter: range });
      return res?.records ?? [];
    } catch (e) {
      console.warn(`HC read ${type} failed`, e);
      return [];
    }
  };

  const [stepsRecs, activeCalRecs, totalCalRecs, restingHrRecs] = await Promise.all([
    safeRead("Steps"),
    safeRead("ActiveCaloriesBurned"),
    safeRead("TotalCaloriesBurned"),
    safeRead("RestingHeartRate"),
  ]);

  const dayBucket = (iso: string) => new Date(iso).toISOString().split("T")[0];
  const sumBy = (recs: any[], field: string, unitKey?: string) => {
    const map: Record<string, number> = {};
    for (const r of recs) {
      const day = dayBucket(r.startTime ?? r.time);
      const val =
        typeof r[field] === "number"
          ? r[field]
          : unitKey && r[field]?.[unitKey] != null
          ? r[field][unitKey]
          : r[field]?.inKilocalories ?? r[field]?.value ?? 0;
      map[day] = (map[day] ?? 0) + (Number(val) || 0);
    }
    return map;
  };

  const stepsByDay = sumBy(stepsRecs, "count");
  const activeCalByDay = sumBy(activeCalRecs, "energy", "inKilocalories");
  const totalCalByDay = sumBy(totalCalRecs, "energy", "inKilocalories");

  const restingByDay: Record<string, number[]> = {};
  for (const r of restingHrRecs) {
    const day = dayBucket(r.time ?? r.startTime);
    const bpm = r.beatsPerMinute ?? r.bpm ?? 0;
    if (bpm > 0) (restingByDay[day] ??= []).push(Number(bpm));
  }

  for (const date of days) {
    const steps = stepsByDay[date];
    const activeCal = activeCalByDay[date];
    const totalCal = totalCalByDay[date];
    const restingArr = restingByDay[date];
    const restingHr = restingArr?.length
      ? Math.round(restingArr.reduce((a, b) => a + b, 0) / restingArr.length)
      : null;

    if (steps == null && activeCal == null && totalCal == null && restingHr == null) continue;

    const patch: any = {
      user_id: userId,
      date,
      source_file: "health_connect",
    };
    if (steps != null) patch.steps = Math.round(steps);
    if (activeCal != null) patch.active_calories = Math.round(activeCal);
    if (totalCal != null) patch.calories_total = Math.round(totalCal);
    if (restingHr != null) patch.resting_heart_rate = restingHr;

    // Upsert by (user_id, date)
    const { data: existing } = await supabase
      .from("daily_metrics")
      .select("id")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

    if (existing) {
      await supabase.from("daily_metrics").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("daily_metrics").insert(patch);
    }
    metricsCount++;
  }

  return { sleepCount, metricsCount };
}
