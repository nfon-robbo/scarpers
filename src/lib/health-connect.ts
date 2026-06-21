import { Capacitor } from "@capacitor/core";
import { HealthConnect } from "@devmaxime/capacitor-health-connect";
import { supabase } from "@/integrations/supabase/client";

export const isHealthConnectPlatform = () =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

// Record types we READ via readRecords (per-record)
const READ_RECORD_TYPES = ["RestingHeartRate", "SleepSession"] as const;
// Aggregate types we READ via aggregateRecords (daily totals)
const AGGREGATE_TYPES = ["Steps", "ActiveCaloriesBurned"] as const;

type ReadRecordType = (typeof READ_RECORD_TYPES)[number];
type AggregateType = (typeof AGGREGATE_TYPES)[number];
type AnyType = ReadRecordType | AggregateType;

// All record types we request permission for. Note: aggregate of
// ActiveCaloriesBurned still needs the underlying read permission. The plugin
// asks the native side to map these strings to Health Connect permissions.
const ALL_READ_TYPES = [
  "Steps",
  "ActiveCaloriesBurned",
  "RestingHeartRate",
  "SleepSession",
] as const;

type HealthConnectAny = {
  readRecords: (o: {
    start: string;
    end: string;
    type: string;
    pageSize?: number;
  }) => Promise<{ records: unknown[] }>;
  aggregateRecords: (o: {
    start: string;
    end: string;
    type: string;
    groupBy?: "day" | "hour" | "week" | "month";
  }) => Promise<{ aggregates: { startTime: string; endTime: string; value: number; unit?: string }[] }>;
  requestPermissions: (o: { read: string[]; write: string[]; readHistory?: boolean }) => Promise<{ read: string[]; write: string[]; raw?: string[] }>;
  getGrantedPermissions: () => Promise<{ read: string[]; write: string[]; raw?: string[] }>;
};

const HC = HealthConnect as unknown as HealthConnectAny;

type DailyMetricPatch = {
  user_id: string;
  date: string;
  source_file?: string;
  steps?: number;
  active_calories?: number;
  resting_heart_rate?: number;
  deep_sleep_minutes?: number;
  rem_sleep_minutes?: number;
  light_sleep_minutes?: number;
  awake_during_night_minutes?: number;
  sleep_duration_seconds?: number;
};

type SleepStageName = "deep" | "rem" | "light" | "awake" | "sleep";
type SleepStageTotals = Record<SleepStageName, number>;

type RestingHrRecord = { time: string; beatsPerMinute: number };
type SleepStageSegment = { startTime: string; endTime: string; stage: string };
type SleepSessionRecord = {
  startTime: string;
  endTime: string;
  stages?: SleepStageSegment[];
};

// Stage string → our normalized name. devmaxime plugin returns Health Connect
// stage constants like "SLEEP_STAGE_DEEP".
const HC_STAGE_MAP: Record<string, SleepStageName | "out_of_bed"> = {
  SLEEP_STAGE_AWAKE: "awake",
  SLEEP_STAGE_SLEEPING: "sleep",
  SLEEP_STAGE_OUT_OF_BED: "out_of_bed",
  SLEEP_STAGE_LIGHT: "light",
  SLEEP_STAGE_DEEP: "deep",
  SLEEP_STAGE_REM: "rem",
  SLEEP_STAGE_UNKNOWN: "sleep",
};

export async function ensureHealthConnectAvailable() {
  const status = await HealthConnect.checkAvailability();
  return status.availability;
}

export async function requestHealthConnectPermissions() {
  return HC.requestPermissions({ read: [...ALL_READ_TYPES], write: [], readHistory: true });
}

export async function getGrantedHealthConnectPermissions(): Promise<string[]> {
  try {
    const res = await HC.getGrantedPermissions();
    const read = Array.isArray(res?.read) ? res.read : [];
    const raw = Array.isArray(res?.raw) ? res.raw : [];
    return [...read, ...raw];
  } catch {
    return [];
  }
}

export const HEALTH_CONNECT_ALL_HISTORY_START_ISO = "2024-01-01T00:00:00.000Z";
export const HEALTH_CONNECT_HISTORY_PERMISSION = "android.permission.health.READ_HEALTH_DATA_HISTORY";

export type HealthConnectProgress = {
  phase: string;
  percent: number; // 0-100
};
export type HealthConnectProgressCallback = (p: HealthConnectProgress) => void;

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const m = (error as { message?: unknown; errorMessage?: unknown }).message ??
      (error as { message?: unknown; errorMessage?: unknown }).errorMessage;
    if (typeof m === "string") return m;
  }
  try { return JSON.stringify(error); } catch { return String(error); }
};

const dayBucket = (iso: string | Date) => new Date(iso).toISOString().split("T")[0];

export async function syncHealthConnect(
  userId: string,
  daysBack = 3650,
  onProgress?: HealthConnectProgressCallback,
) {
  const report = (phase: string, percent: number) => {
    try { onProgress?.({ phase, percent: Math.max(0, Math.min(100, Math.round(percent))) }); } catch { /* noop */ }
  };
  report("Starting…", 1);

  const end = new Date();
  const requestedStart = new Date(end.getTime() - daysBack * 86400000);
  const allHistoryStart = new Date(HEALTH_CONNECT_ALL_HISTORY_START_ISO);
  const start = requestedStart < allHistoryStart ? requestedStart : allHistoryStart;
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  report("Checking permissions…", 3);
  const grantedSet = new Set(await getGrantedHealthConnectPermissions());
  const readErrors: { type: string; message: string }[] = [];

  // ----- Aggregate daily totals: Steps + ActiveCaloriesBurned -----
  const aggDaily: Record<AggregateType, Record<string, number>> = {
    Steps: {},
    ActiveCaloriesBurned: {},
  };
  const aggLabels: Record<AggregateType, string> = {
    Steps: "Reading steps…",
    ActiveCaloriesBurned: "Reading calories…",
  };
  for (let i = 0; i < AGGREGATE_TYPES.length; i++) {
    const t = AGGREGATE_TYPES[i];
    report(aggLabels[t], 5 + (i * 10));
    if (!grantedSet.has(t)) continue;
    try {
      const res = await HC.aggregateRecords({ start: startIso, end: endIso, type: t, groupBy: "day" });
      for (const a of res?.aggregates ?? []) {
        const day = dayBucket(a.startTime);
        aggDaily[t][day] = (aggDaily[t][day] ?? 0) + Number(a.value || 0);
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      console.warn(`[HC] aggregate ${t} failed:`, msg);
      readErrors.push({ type: t, message: msg });
    }
  }

  // ----- Per-record reads: RestingHeartRate + SleepSession -----
  const restingHrRecs: RestingHrRecord[] = [];
  const sleepRecs: SleepSessionRecord[] = [];
  const readLabels: Record<ReadRecordType, string> = {
    RestingHeartRate: "Reading resting heart rate…",
    SleepSession: "Reading sleep sessions…",
  };
  for (let i = 0; i < READ_RECORD_TYPES.length; i++) {
    const t = READ_RECORD_TYPES[i];
    report(readLabels[t], 25 + (i * 15));
    if (!grantedSet.has(t)) {
      readErrors.push({ type: t, message: `Permission not granted for ${t}.` });
      continue;
    }
    try {
      const res = await HC.readRecords({ start: startIso, end: endIso, type: t, pageSize: 500 });
      const records = (res?.records ?? []) as unknown[];
      if (t === "RestingHeartRate") {
        restingHrRecs.push(...(records as RestingHrRecord[]));
      } else if (t === "SleepSession") {
        sleepRecs.push(...(records as SleepSessionRecord[]));
      }
    } catch (e) {
      const msg = getErrorMessage(e);
      console.warn(`[HC] read ${t} failed:`, msg);
      readErrors.push({ type: t, message: msg });
    }
  }

  // Resting HR: average per day
  const restingByDay: Record<string, number[]> = {};
  for (const r of restingHrRecs) {
    const day = dayBucket(r.time);
    const bpm = Number(r.beatsPerMinute);
    if (bpm > 0) (restingByDay[day] ??= []).push(bpm);
  }

  // ----- Write daily_metrics (steps/calories/RHR) -----
  const allDates = new Set<string>([
    ...Object.keys(aggDaily.Steps),
    ...Object.keys(aggDaily.ActiveCaloriesBurned),
    ...Object.keys(restingByDay),
  ]);

  let updated = 0;
  for (const date of allDates) {
    const steps = aggDaily.Steps[date];
    const activeCal = aggDaily.ActiveCaloriesBurned[date];
    const restingArr = restingByDay[date];
    const restingHr = restingArr?.length
      ? Math.round(restingArr.reduce((a, b) => a + b, 0) / restingArr.length)
      : null;

    if (steps == null && activeCal == null && restingHr == null) continue;

    const patch: DailyMetricPatch = { user_id: userId, date, source_file: "health_connect" };
    if (steps != null) patch.steps = Math.round(steps);
    if (activeCal != null) patch.active_calories = Math.round(activeCal);
    if (restingHr != null) patch.resting_heart_rate = restingHr;

    const { data: existing } = await supabase
      .from("daily_metrics")
      .select("id")
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();

    if (existing) await supabase.from("daily_metrics").update(patch).eq("id", existing.id);
    else await supabase.from("daily_metrics").insert(patch);
    updated++;
  }

  // ----- Sleep stages → sleep_stages + daily_metrics rollup -----
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
  const dailyTotals: Record<string, SleepStageTotals> = {};
  const nightDates = new Set<string>();
  let sleepCount = 0;

  for (const session of sleepRecs) {
    const sessionStart = new Date(session.startTime);
    const sessionEnd = new Date(session.endTime);
    if (Number.isNaN(sessionStart.getTime()) || Number.isNaN(sessionEnd.getTime())) continue;
    const wakeDate = dayBucket(sessionEnd);
    nightDates.add(wakeDate);

    const stages = Array.isArray(session.stages) ? session.stages : [];
    let writtenForSession = 0;

    for (const seg of stages) {
      const segStart = new Date(seg.startTime);
      const segEnd = new Date(seg.endTime);
      if (Number.isNaN(segStart.getTime()) || Number.isNaN(segEnd.getTime())) continue;
      const stageName = HC_STAGE_MAP[seg.stage];
      if (!stageName || stageName === "out_of_bed") continue;
      const durationSeconds = Math.max(0, Math.round((segEnd.getTime() - segStart.getTime()) / 1000));
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
      if (!dailyTotals[wakeDate]) dailyTotals[wakeDate] = { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 };
      dailyTotals[wakeDate][stageName as SleepStageName] += durationSeconds;
    }

    // Fallback: session with no per-stage breakdown — record one generic 'sleep' row.
    if (writtenForSession === 0) {
      const durationSeconds = Math.max(0, Math.round((sessionEnd.getTime() - sessionStart.getTime()) / 1000));
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
        if (!dailyTotals[wakeDate]) dailyTotals[wakeDate] = { deep: 0, rem: 0, light: 0, awake: 0, sleep: 0 };
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
    if (insertErr) console.warn("HC sleep_stages insert failed", insertErr);
    else sleepCount = stageRows.length;
  }

  for (const [date, t] of Object.entries(dailyTotals)) {
    const totalSecs = t.deep + t.rem + t.light + t.sleep;
    if (totalSecs <= 0) continue;
    const patch: DailyMetricPatch = {
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
    if (existing) await supabase.from("daily_metrics").update(patch).eq("id", existing.id);
    else await supabase.from("daily_metrics").insert(patch);
  }

  return { metricsCount: updated, sleepCount, sleepSupported: true as const, readErrors };
}
