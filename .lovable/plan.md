## Fix: Group Readiness Trend by local date

**Problem:** In `ReadinessWidget.tsx` (lines 743–771), the 7-day morning/EOD trend groups snapshots by UTC date (`s.recorded_at.split("T")[0]`) and labels days from UTC midnight. A snapshot at 00:45 Tuesday BST (= 23:45 Monday UTC) gets filed under Monday, so "Monday EOD" actually shows a Tuesday-morning value.

**Fix (frontend only, scope-limited):**

1. Add a small helper `localDateKey(iso)` inside the effect that returns `YYYY-MM-DD` using the browser's local timezone (same pattern already used at line 719 for the "today" branch).
2. Replace the `days` array generation to use local-date keys:
   - Start from `today` at local midnight and walk back 7 days using local-date math (avoid `toISOString().split("T")[0]`, which is UTC).
3. Replace `const d = s.recorded_at.split("T")[0]` with `const d = localDateKey(s.recorded_at)` when bucketing into `byDay`.
4. Keep the weekday label using `new Date(${d}T00:00:00)` so the "Mon/Tue/…" label matches the local-date bucket.

No changes to:
- Edge functions / hourly snapshot writer (deferred per request).
- "Morning" snapshot window definition (deferred).
- Deduping (deferred).
- Backend, DB, or any other component.

**Result:** A snapshot at 00:45 Tue BST is bucketed under Tue, "Monday EOD" only contains Monday-local snapshots, and BST/other-timezone users see correctly-labelled days.

**File touched:** `src/components/ReadinessWidget.tsx` only (the `useEffect` at lines 712–772).
