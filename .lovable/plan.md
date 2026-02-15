

# Fix: Stale Sleep Data + AI Hallucination About Unsynced Sleep

## Problem

You haven't synced last night's sleep yet, but the widget is using the **previous night's** data (Feb 13-14) and presenting it as current. The AI coach then praises your "top-tier sleep" based on data that's a full day old. Two issues to fix:

1. **Widget shows stale sleep as current** -- no indication the data is old
2. **AI coach comments on sleep it hasn't actually seen** -- needs to be told explicitly when sleep data is missing/stale

## Changes

### 1. `src/components/ReadinessWidget.tsx` -- Detect stale/missing sleep

- After fetching sleep stages, check if the most recent date is actually "last night" (today or yesterday). If the latest sleep date is older than yesterday, treat sleep as **not synced**.
- Build a `missingData` array (e.g., `["sleep"]`) and pass it in the POST body to the readiness-advice function.
- Update the cache key to include `factors.length` so stale advice (from when sleep WAS available) gets evicted when data context changes.

### 2. `src/lib/readiness.ts` -- Show "No data synced" factor

- When `sleepScore` is `null`, instead of silently omitting the Sleep Quality factor, **push a visible warning row**:
  ```
  Sleep Quality    Not synced    [warning]
  ```
- This ensures the user sees it, AND the AI coach receives it as a factor with status "warning".

### 3. `supabase/functions/readiness-advice/index.ts` -- Guard against hallucination

- Accept `missing_data` from the request body.
- Add an explicit rule to the system prompt: "MISSING DATA: [list]. Do NOT praise, comment on, or reference any metric listed as missing. If sleep is missing, do NOT mention sleep quality."
- Append the missing data to the user prompt so the AI has no excuse.

## Technical Details

### ReadinessWidget.tsx

After computing `finalSleepScore`:
```
const missingData: string[] = [];
if (finalSleepScore == null) missingData.push("sleep");
if (!latestMetrics?.hrv) missingData.push("HRV");
if (!latestMetrics?.resting_heart_rate) missingData.push("resting heart rate");
```

In the POST body to readiness-advice, add:
```
missing_data: missingData
```

Update cache key comparison to include `result.factors.length` so changing data availability busts the cache.

### readiness.ts

In `computeReadiness`, at the start of the Sleep Quality section:
```typescript
if (d.sleepScore == null) {
  factors.push({
    label: "Sleep Quality",
    status: "warning",
    detail: "Not synced",
  });
}
```

### readiness-advice/index.ts

Read `missing_data` from the request JSON. Add to system prompt:
```
CRITICAL: The following data has NOT been synced today: ${missing_data.join(', ')}.
Do NOT praise, reference, or comment on any missing metric.
If sleep is missing, say NOTHING about sleep quality.
```

