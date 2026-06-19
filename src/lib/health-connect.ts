import { Capacitor } from "@capacitor/core";
import { HealthConnect } from "capacitor-health-connect";
import { supabase } from "@/integrations/supabase/client";

export const isHealthConnectPlatform = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

const READ_TYPES = [
  "Steps",
  "ActiveCaloriesBurned",
  "RestingHeartRate",
] as const;

const PERMISSION_BY_TYPE: Record<(typeof READ_TYPES)[number], string> = {
  Steps: "android.permission.health.READ_STEPS",
  ActiveCaloriesBurned: "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
  RestingHeartRate: "android.permission.health.READ_RESTING_HEART_RATE",
};

const UNSUPPORTED_NATIVE_READ_ERRORS = [
  {
    type: "SleepSession",
    message:
      "Skipped before native sync: capacitor-health-connect 0.7.0 does not support SleepSession records, and requesting it crashes the Android plugin instead of returning an error.",
  },
  {
    type: "HeartRateSeries",
    message:
      "Skipped before native sync: high-volume HeartRateSeries reads can crash this Android plugin. RestingHeartRate is used instead.",
  },
];

// Health Connect SleepSession stage types → our normalized stage names.
// Matches the `sleep_stages` table shape used by google-fit-sleep.
const HC_STAGE_MAP: Record<string, string> = {
  awake: "awake",
  awake_in_bed: "awake",
  sleeping: "sleep",       // generic sleep, no breakdown
  out_of_bed: "out_of_bed",
  light: "light",
  deep: "deep",
  rem: "rem",
  // Numeric fallbacks some plugin versions return
  "1": "awake",
  "2": "sleep",
  "3": "out_of_bed",
  "4": "light",
  "5": "deep",
  "6": "rem",
  "7": "awake",
};

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

export async function getGrantedHealthConnectPermissions(): Promise<string[]> {
  try {
    const res: any = await (HealthConnect as any).checkHealthPermissions?.({
      read: READ_TYPES as unknown as any,
      write: [],
    });
    const grantedPermissions: string[] = Array.isArray(res?.grantedPermissions)
      ? res.grantedPermissions
      : [];
    if (res?.hasAllPermissions) return [...READ_TYPES];
    return READ_TYPES.filter((type) => grantedPermissions.includes(PERMISSION_BY_TYPE[type]));
  } catch {
    return [];
  }
}

export async function syncHealthConnect(userId: string, daysBack = 7) {
  const end = new Date();
  const start = new Date(end.getTime() - daysBack * 86400000);
  const timeRangeFilter = {
    type: "between" as const,
    startTime: start,
    endTime: end,
  };

  const grantedTypes = new Set(await getGrantedHealthConnectPermissions());
  const readErrors: { type: string; message: string }[] = [...UNSUPPORTED_NATIVE_READ_ERRORS];

  const safeReadAll = async () => {
    const results: Record<string, any[]> = {};
    for (const t of READ_TYPES) {
      if (!grantedTypes.has(t)) {
        readErrors.push({
          type: t,
          message: `Skipped before native sync: ${PERMISSION_BY_TYPE[t]} is not currently granted to this app.`,
        });
        results[t] = [];
        continue;
      }
      try {
        const res: any = await HealthConnect.readRecords({
          type: t as any,
          timeRangeFilter,
          pageSize: 200,
        });
        results[t] = res?.records ?? [];
      } catch (e: any) {
        const msg =
          e?.message ??
          e?.errorMessage ??
          (typeof e === "string" ? e : JSON.stringify(e));
        console.warn(`[HC] read ${t} failed:`, msg);
        readErrors.push({ type: t, message: String(msg) });
        results[t] = [];
      }
    }
    return results;
  };

  const all = await safeReadAll();
  const stepsRecs = all["Steps"];
  const activeCalRecs = all["ActiveCaloriesBurned"];
  const restingHrRecs = all["RestingHeartRate"];
  const hrSeriesRecs: any[] = [];
  const sleepRecs: any[] = [];

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

  // ---------- Sleep stages (SleepSession) ----------
  // Mirror the google-fit-sleep shape: one row per stage segment, source
  // 'health_connect', date = wake date (end of session). We delete existing
  // health_connect rows for the affected dates first so re-syncs do not
  // create duplicates. Data from other sources (e.g. google_fit) is left
  // untouched because we scope deletes by source.
  type SleepStageInsert = {
    user_id: string;
    date: string;
    stage: string;
    duration_seconds: number;
    start_time: string;
    end_time: string;
    source: string;
  };

  const stageRows: SleepStageInsert[] = [];
  const dailyTotals: Record<
    string,
    { deep: number; rem: number; light: number; awake: number; sleep: number }
  > = {};
  const nightDates = new Set<string>();
  let sleepCount = 0;

  for (const session of sleepRecs) {
    const sessionStart = new Date(session.startTime);
    const sessionEnd = new Date(session.endTime);
    if (Number.isNaN(sessionStart.getTime()) || Number.isNaN(sessionEnd.getTime())) continue;
    const wakeDate = dayBucket(sessionEnd);
    nightDates.add(wakeDate);

    const stages: any[] = Array.isArray(session.stages) ? session.stages : [];
    let writtenForSession = 0;

    for (const seg of stages) {
      const segStart = new Date(seg.startTime);
      const segEnd = new Date(seg.endTime);
      if (Number.isNaN(segStart.getTime()) || Number.isNaN(segEnd.getTime())) continue;
      const rawType = String(seg.stage ?? seg.type ?? "").toLowerCase();
      const stageName = HC_STAGE_MAP[rawType];
      if (!stageName || stageName === "out_of_bed") continue;
      const durationSeconds = Math.max(
        0,
        Math.round((segEnd.getTime() - segStart.getTime()) / 1000)
      );
      if (durationSeconds <= 0) continue;

      stageRows.push({
        user_id: userId,
        date: wakeDate,
        stage: stageName,
        duration_seconds: durationSeconds,
        start_time: segStart.toISOString(),
        end_time: segEnd.toISOString(),
        source: "health_connect",
      });
      writtenForSession++;

      if (!dailyTotals[wakeDate])
        dailyTotals[wakeDate] = { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 };
      (dailyTotals[wakeDate] as any)[stageName] += durationSeconds;
    }

    // Fallback: no per-stage breakdown — record one generic 'sleep' row so
    // total sleep time is still captured.
    if (writtenForSession === 0) {
      const durationSeconds = Math.max(
        0,
        Math.round((sessionEnd.getTime() - sessionStart.getTime()) / 1000)
      );
      if (durationSeconds > 0) {
        stageRows.push({
          user_id: userId,
          date: wakeDate,
          stage: "sleep",
          duration_seconds: durationSeconds,
          start_time: sessionStart.toISOString(),
          end_time: sessionEnd.toISOString(),
          source: "health_connect",
        });
        if (!dailyTotals[wakeDate])
          dailyTotals[wakeDate] = { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 };
        dailyTotals[wakeDate].sleep += durationSeconds;
      }
    }
  }

  if (nightDates.size > 0) {
    await supabase
      .from("sleep_stages")
      .delete()
      .eq("user_id", userId)
      .eq("source", "health_connect")
      .in("date", Array.from(nightDates));
  }

  if (stageRows.length > 0) {
    const { error: insertErr } = await supabase.from("sleep_stages").insert(stageRows);
    if (insertErr) {
      console.warn("HC sleep_stages insert failed", insertErr);
    } else {
      sleepCount = stageRows.length;
    }
  }

  // Roll up per-night totals into daily_metrics so the sleep score
  // recalculates immediately (same shape google-fit-sleep uses).
  for (const [date, t] of Object.entries(dailyTotals)) {
    const totalSecs = t.deep + t.rem + t.light + t.sleep;
    if (totalSecs <= 0) continue;
    const patch: any = {
      user_id: userId,
      date,
      deep_sleep_minutes: Math.round(t.deep / 60),
      rem_sleep_minutes: Math.round(t.rem / 60),
      light_sleep_minutes: Math.round((t.light + t.sleep) / 60),
      awake_during_night_minutes: Math.round(t.awake / 60),
      sleep_duration_seconds: totalSecs,
    };
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
  }

  return {
    metricsCount: updated,
    sleepCount,
    sleepSupported: true as const,
    readErrors,
  };
}
