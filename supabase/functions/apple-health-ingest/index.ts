// Receives Apple Health data pushed from the iPhone app "Health Auto Export"
// (REST API automation) and stores sleep stages + daily metrics for the user
// that owns the personal token supplied with the request.
//
// Auth: Bearer token / x-api-key header / ?token= query param. The token is
// matched against a SHA-256 hash stored in public.apple_health_tokens.

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sha256Hex = async (value: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const extractToken = (req: Request): string | null => {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const apiKey = req.headers.get("x-api-key");
  if (apiKey?.trim()) return apiKey.trim();
  const url = new URL(req.url);
  const q = url.searchParams.get("token") ?? url.searchParams.get("key");
  return q?.trim() || null;
};

/**
 * Health Auto Export dates look like "2026-09-14 06:12:00 +0100".
 * Convert to a real Date plus the local calendar day the reading belongs to.
 */
const parseHaeDate = (raw: unknown): { date: Date; localDay: string } | null => {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const m = raw.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?\s*([+-]\d{2}):?(\d{2})?$/,
  );
  if (m) {
    const [, y, mo, d, h, mi, s, offH, offM = "00"] = m;
    const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${offH}:${offM}`;
    const date = new Date(iso);
    if (isNaN(date.getTime())) return null;
    return { date, localDay: `${y}-${mo}-${d}` };
  }
  const date = new Date(raw);
  if (isNaN(date.getTime())) return null;
  return { date, localDay: date.toISOString().slice(0, 10) };
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Hours (HAE sleep units) -> seconds */
const hoursToSecs = (v: unknown): number => Math.max(0, Math.round((num(v) ?? 0) * 3600));

type StageRow = {
  user_id: string;
  date: string;
  stage: string;
  duration_seconds: number;
  start_time: string | null;
  end_time: string | null;
  source: string;
};

type MetricPatch = Record<string, number | null>;

const METRIC_FIELD: Record<string, string> = {
  resting_heart_rate: "resting_heart_rate",
  heart_rate_variability: "hrv",
  step_count: "steps",
  active_energy: "active_calories",
  vo2_max: "vo2_max",
  respiratory_rate: "respiration_avg",
  blood_oxygen_saturation: "spo2",
  weight_body_mass: "weight",
  body_fat_percentage: "body_fat_percentage",
};

/**
 * The sleep night is attributed to the WAKE-UP day (matching how the rest of
 * the app treats a night's sleep).
 */
const sleepDayFor = (start: ReturnType<typeof parseHaeDate>, end: ReturnType<typeof parseHaeDate>, fallback: string) =>
  end?.localDay ?? start?.localDay ?? fallback;

/** Convert an HAE quantity object / plain number to a number in base units. */
const qty = (v: unknown): number | null => {
  if (v && typeof v === "object") return num((v as any).qty ?? (v as any).value);
  return num(v);
};

/** Distance/elevation values arrive with a unit label; normalise to metres. */
const toMetres = (v: unknown): number | null => {
  const value = qty(v);
  if (value === null) return null;
  const units = String((v as any)?.units ?? "").toLowerCase();
  if (units.includes("mi")) return value * 1609.344;
  if (units === "m" || units.includes("meter") || units.includes("metre")) return value;
  if (units.includes("ft") || units.includes("feet")) return value * 0.3048;
  if (units.includes("cm")) return value / 100;
  return value * 1000; // default km
};

/** Map an Apple workout name onto the app's activity types. */
const workoutType = (raw: string): string => {
  const n = raw.toLowerCase();
  if (n.includes("run")) return "running";
  if (n.includes("walk")) return "walking";
  if (n.includes("hik")) return "hiking";
  if (n.includes("cycl") || n.includes("bike") || n.includes("biking")) return "cycling";
  if (n.includes("swim")) return "swimming";
  return raw || "workout";
};

const avgOf = (rows: unknown): { avg: number | null; max: number | null } => {
  if (!Array.isArray(rows) || rows.length === 0) return { avg: null, max: null };
  const values = rows
    .map((r: any) => num(r?.Avg ?? r?.avg ?? r?.qty ?? r?.value))
    .filter((v): v is number => v !== null);
  const maxes = rows
    .map((r: any) => num(r?.Max ?? r?.max ?? r?.qty ?? r?.value))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return { avg: null, max: null };
  return {
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
    max: maxes.length ? Math.round(Math.max(...maxes)) : null,
  };
};


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const token = extractToken(req);
    if (!token) return json({ error: "Missing token" }, 401);

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "Payload too large" }, 413);

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tokenHash = await sha256Hex(token);
    const { data: tokenRow, error: tokenErr } = await supabase
      .from("apple_health_tokens")
      .select("id, user_id, revoked_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tokenErr) {
      console.error("token lookup failed", tokenErr);
      return json({ error: "Token lookup failed" }, 500);
    }
    if (!tokenRow || tokenRow.revoked_at) return json({ error: "Invalid token" }, 401);

    const userId = tokenRow.user_id as string;

    const metrics: any[] = Array.isArray(payload?.data?.metrics)
      ? payload.data.metrics
      : Array.isArray(payload?.metrics)
      ? payload.metrics
      : [];

    const workouts: any[] = Array.isArray(payload?.data?.workouts)
      ? payload.data.workouts
      : Array.isArray(payload?.workouts)
      ? payload.workouts
      : [];

    // ---- Workouts (runs, walks, rides, ...) -------------------------------
    let workoutsAdded = 0;
    for (const w of workouts) {
      const start = parseHaeDate(w?.start ?? w?.startDate ?? w?.date);
      if (!start) continue;
      const end = parseHaeDate(w?.end ?? w?.endDate);

      const name = String(w?.name ?? w?.workoutActivityType ?? "").trim();
      const type = workoutType(name);

      let duration = qty(w?.duration);
      if (duration !== null && duration < 1000 && end) {
        // HAE sometimes reports duration in minutes; prefer the real span.
        const span = (end.date.getTime() - start.date.getTime()) / 1000;
        if (span > 0 && Math.abs(span - duration) > 120) duration = span;
      }
      if (duration === null && end) duration = (end.date.getTime() - start.date.getTime()) / 1000;
      if (!duration || duration < 60) continue; // ignore stubs

      const distance = toMetres(w?.distance);
      const hr = avgOf(w?.heartRateData);
      const calories = qty(w?.activeEnergyBurned ?? w?.activeEnergy ?? w?.totalEnergy);
      const ascent = toMetres(w?.elevationUp ?? w?.elevation?.ascent);
      const steps = qty(w?.stepCount);

      // Skip if an activity already exists around this start time (Strava,
      // Intervals.icu or a FIT upload may already have it).
      const windowStart = new Date(start.date.getTime() - 15 * 60 * 1000).toISOString();
      const windowEnd = new Date(start.date.getTime() + 15 * 60 * 1000).toISOString();
      const { data: clash } = await supabase
        .from("activities")
        .select("id")
        .eq("user_id", userId)
        .gte("start_time", windowStart)
        .lte("start_time", windowEnd)
        .limit(1);
      if (clash && clash.length > 0) continue;

      const { error: actErr } = await supabase.from("activities").insert({
        user_id: userId,
        activity_type: type,
        start_time: start.date.toISOString(),
        duration_seconds: Math.round(duration),
        distance_meters: distance,
        avg_heart_rate: hr.avg,
        max_heart_rate: hr.max,
        avg_speed: distance && duration ? distance / duration : null,
        total_ascent: ascent,
        calories: calories ?? null,
        total_steps: steps ? Math.round(steps) : null,
        source_file: "apple_health",
        raw_data: w,
      });
      if (actErr) console.error("workout insert failed", actErr);
      else workoutsAdded += 1;
    }

    if (metrics.length === 0) {
      const summaryOnly = `${workoutsAdded} workout(s)`;
      await supabase
        .from("apple_health_tokens")
        .update({ last_seen_at: new Date().toISOString(), last_payload_summary: summaryOnly })
        .eq("id", tokenRow.id);
      return json({ ok: true, sleepSegments: 0, days: 0, workouts: workoutsAdded });
    }


    const stageRows: StageRow[] = [];
    const sleepTotals = new Map<string, { deep: number; rem: number; light: number; awake: number; total: number }>();
    const dayPatches = new Map<string, MetricPatch>();
    const dayAccum = new Map<string, Record<string, { sum: number; count: number; isSum: boolean }>>();

    for (const metric of metrics) {
      const name = String(metric?.name ?? "").toLowerCase();
      const points: any[] = Array.isArray(metric?.data) ? metric.data : [];
      if (points.length === 0) continue;

      if (name === "sleep_analysis") {
        for (const p of points) {
          const start = parseHaeDate(p?.sleepStart ?? p?.startDate ?? p?.date);
          const end = parseHaeDate(p?.sleepEnd ?? p?.endDate ?? p?.date);
          const fallback = parseHaeDate(p?.date)?.localDay;
          if (!fallback && !start && !end) continue;
          const day = sleepDayFor(start, end, fallback ?? new Date().toISOString().slice(0, 10));

          const deep = hoursToSecs(p?.deep);
          const rem = hoursToSecs(p?.rem);
          const light = hoursToSecs(p?.core ?? p?.light);
          const awake = hoursToSecs(p?.awake);
          let asleep = hoursToSecs(p?.asleep ?? p?.totalSleep);
          if (!asleep) asleep = deep + rem + light;
          if (!deep && !rem && !light && !awake && !asleep) continue;

          const prev = sleepTotals.get(day) ?? { deep: 0, rem: 0, light: 0, awake: 0, total: 0 };
          sleepTotals.set(day, {
            deep: prev.deep + deep,
            rem: prev.rem + rem,
            light: prev.light + light,
            awake: prev.awake + awake,
            total: prev.total + asleep,
          });

          const startIso = start?.date.toISOString() ?? null;
          const endIso = end?.date.toISOString() ?? null;
          const add = (stage: string, secs: number) => {
            if (secs <= 0) return;
            stageRows.push({
              user_id: userId,
              date: day,
              stage,
              duration_seconds: secs,
              start_time: startIso,
              end_time: endIso,
              source: "apple_health",
            });
          };
          add("deep", deep);
          add("rem", rem);
          add("light", light);
          add("awake", awake);
        }
        continue;
      }

      const field = METRIC_FIELD[name];
      if (!field) continue;
      const isSum = field === "steps" || field === "active_calories";

      for (const p of points) {
        const parsed = parseHaeDate(p?.date ?? p?.startDate);
        if (!parsed) continue;
        const value = num(p?.qty ?? p?.Avg ?? p?.avg ?? p?.value);
        if (value === null) continue;
        const bucket = dayAccum.get(parsed.localDay) ?? {};
        const cur = bucket[field] ?? { sum: 0, count: 0, isSum };
        cur.sum += value;
        cur.count += 1;
        bucket[field] = cur;
        dayAccum.set(parsed.localDay, bucket);
      }
    }

    for (const [day, fields] of dayAccum) {
      const patch: MetricPatch = dayPatches.get(day) ?? {};
      for (const [field, agg] of Object.entries(fields)) {
        const value = agg.isSum ? agg.sum : agg.sum / Math.max(1, agg.count);
        patch[field] = field === "steps" ? Math.round(value) : Math.round(value * 10) / 10;
      }
      dayPatches.set(day, patch);
    }

    for (const [day, totals] of sleepTotals) {
      const patch = dayPatches.get(day) ?? {};
      patch.deep_sleep_minutes = Math.round(totals.deep / 60);
      patch.rem_sleep_minutes = Math.round(totals.rem / 60);
      patch.light_sleep_minutes = Math.round(totals.light / 60);
      patch.awake_during_night_minutes = Math.round(totals.awake / 60);
      patch.sleep_duration_seconds = totals.total;
      dayPatches.set(day, patch);
    }

    // Replace this source's stage rows for the affected nights so repeat sends
    // overwrite rather than duplicate.
    const sleepDays = [...sleepTotals.keys()];
    if (sleepDays.length > 0) {
      const { error: delErr } = await supabase
        .from("sleep_stages")
        .delete()
        .eq("user_id", userId)
        .eq("source", "apple_health")
        .in("date", sleepDays);
      if (delErr) console.error("stage cleanup failed", delErr);
    }

    if (stageRows.length > 0) {
      const { error: insErr } = await supabase.from("sleep_stages").insert(stageRows);
      if (insErr) {
        console.error("stage insert failed", insErr);
        return json({ error: "Failed to save sleep stages", details: insErr.message }, 500);
      }
    }

    let daysWritten = 0;
    for (const [day, patch] of dayPatches) {
      const { data: existing } = await supabase
        .from("daily_metrics")
        .select("id")
        .eq("user_id", userId)
        .eq("date", day)
        .maybeSingle();

      const row = { ...patch, source_file: "apple_health" };
      const { error } = existing
        ? await supabase.from("daily_metrics").update(row).eq("id", existing.id)
        : await supabase.from("daily_metrics").insert({ user_id: userId, date: day, ...row });

      if (error) console.error(`daily_metrics write failed for ${day}`, error);
      else daysWritten += 1;
    }

    const summary = `${stageRows.length} sleep segment(s) · ${daysWritten} day(s) of metrics`;
    await supabase
      .from("apple_health_tokens")
      .update({ last_seen_at: new Date().toISOString(), last_payload_summary: summary })
      .eq("id", tokenRow.id);

    return json({ ok: true, sleepSegments: stageRows.length, days: daysWritten, summary });
  } catch (e) {
    console.error("apple-health-ingest failed", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
