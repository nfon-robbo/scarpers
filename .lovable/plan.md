## Parsed output from current code

The current parser now identifies the right segment and pace, but it still normalises `MM:SS` durations to minutes:

```text
1. Race Pace Block — 20:00 (mm:ss) — 6:00 Pace (min/km)
   Current: { segment: "Race Pace Block", duration: "20 min", pace: "6:00/km" }
   Required: { segment: "Race Pace Block", duration: "20:00", pace: "6:00/km" }

2. Warm Up Jog — 05:00 (mm:ss) — 7:15 Pace (min/km)
   Current: { segment: "Warm Up Jog", duration: "5 min", pace: "7:15/km" }
   Required: { segment: "Warm Up Jog", duration: "05:00", pace: "7:15/km" }

3. Warm Up Walk — 05:00 (mm:ss) — No pace
   Current: { segment: "Warm Up Walk", duration: "5 min", pace: null }
   Required: { segment: "Warm Up Walk", duration: "05:00", pace: null }
```

## Fix plan

1. In `src/lib/chat-recommendation-parser.ts`, add a strict helper for one Intervals-style segment line using the exact field mapping:

```ts
const segmentPattern = /^(.+?)\s*—\s*(\d{1,2}:\d{2})\s*\(mm:ss\)\s*—\s*(?:(\d{1,2}:\d{2})\s*Pace\s*\(min\/km\)|—|No pace)/i;
```

2. Update `tryParseIntervalsList` so it first splits numbered workout specs into individual lines/items, removes the leading `1.`, `2.`, `3.`, then applies this strict parser.

3. Preserve the exact `MM:SS` duration string from regex group `[2]`; do not call `normaliseDuration` for this strict Intervals-style format.

4. Store pace from regex group `[3]` only. If group `[3]` is absent because the line says `No pace` or `—`, store target as `—` so the UI/export treats it as no pace.

5. Re-run the three exact checks and confirm output before completing:

```text
{ segment: "Race Pace Block", duration: "20:00", pace: "6:00/km" }
{ segment: "Warm Up Jog", duration: "05:00", pace: "7:15/km" }
{ segment: "Warm Up Walk", duration: "05:00", pace: null }
```

No other files or behaviours will be changed.