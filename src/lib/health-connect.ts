import { Capacitor } from "@capacitor/core";
import { HealthConnect } from "capacitor-health-connect";
import { supabase } from "@/integrations/supabase/client";

export const isHealthConnectPlatform = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

const READ_TYPES = [
  "Steps",
  "ActiveCaloriesBurned",
  "RestingHeartRate",
  "HeartRateSeries",
] as const;

export async function ensureHealthConnectAvailable() {
  const status = await HealthConnect.checkAvailability();
  return status.availability;
}

export async function requestHealthConnectPermissions() {
  return HealthConnect.requestHealthPermissions({
    read: READ_TYPES as unknown as any,
    write: [],
  });
}

export async function syncHealthConnect(userId: string, daysBack = 7) {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400000);
  const timeRangeFilter = {
    type: "between" as const,
    startTime: start,
    endTime: end,
  };

  const safeRead = async (type: any): Promise<any[]> => {
    try {
      const res: any = await HealthConnect.readRecords({ type, timeRangeFilter });
      return res?.records ?? [];
    } catch (e) {
      console.warn(`HC read ${type} failed`, e);
      return [];
    }
  };

  const [stepsRecs, activeCalRecs, restingHrRecs, hrSeriesRecs] = await Promise.all([
    safeRead("Steps"),
    safeRead("ActiveCaloriesBurned"),
    safeRead("RestingHeartRate"),
    safeRead("HeartRateSeries"),
  ]);

  const dayBucket = (iso: string | Date) =>
    new Date(iso).toISOString().split("T")[0];

  // Steps: r.count
  const stepsByDay: Record<string, number> = {};
  for (const r of stepsRecs) {
    const day = dayBucket(r.startTime);
    stepsByDay[day] = (stepsByDay[day] ?? 0) + (Number(r.count) || 0);
  }

  // Active calories: r.energy.inKilocalories
  const activeCalByDay: Record<string, number> = {};
  for (const r of activeCalRecs) {
    const day = dayBucket(r.startTime);
    const kcal = r.energy?.inKilocalories ?? r.energy?.value ?? 0;
    activeCalByDay[day] = (activeCalByDay[day] ?? 0) + Number(kcal);
  }

  // Resting HR: r.beatsPerMinute (per record), one per day typically — average if multiple
  const restingByDay: Record<string, number[]> = {};
  for (const r of restingHrRecs) {
    const day = dayBucket(r.time);
    const bpm = Number(r.beatsPerMinute);
    if (bpm > 0) (restingByDay[day] ??= []).push(bpm);
  }

  // HR Series fallback for resting HR if RestingHeartRate missing — take daily min of samples
  const hrSeriesMinByDay: Record<string, number> = {};
  for (const r of hrSeriesRecs) {
    const samples = r.samples ?? [];
    for (const s of samples) {
      const day = dayBucket(s.time);
      const bpm = Number(s.beatsPerMinute);
      if (!bpm) continue;
      hrSeriesMinByDay[day] =
        hrSeriesMinByDay[day] != null ? Math.min(hrSeriesMinByDay[day], bpm) : bpm;
    }
  }

  const days: string[] = [];
  for (let i = 0; i < daysBack; i++) {
    days.push(dayBucket(new Date(end.getTime() - i * 86400000)));
  }

  let updated = 0;
  for (const date of days) {
    const steps = stepsByDay[date];
    const activeCal = activeCalByDay[date];
    const restingArr = restingByDay[date];
    const restingHr = restingArr?.length
      ? Math.round(restingArr.reduce((a, b) => a + b, 0) / restingArr.length)
      : hrSeriesMinByDay[date]
      ? Math.round(hrSeriesMinByDay[date])
      : null;

    if (steps == null && activeCal == null && restingHr == null) continue;

    const patch: any = { user_id: userId, date, source_file: "health_connect" };
    if (steps != null) patch.steps = Math.round(steps);
    if (activeCal != null) patch.active_calories = Math.round(activeCal);
    if (restingHr != null) patch.resting_heart_rate = restingHr;

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
    updated++;
  }

  return { metricsCount: updated, sleepCount: 0, sleepSupported: false as const };
}
