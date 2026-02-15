

## Fix: Capture HRV Data from Intervals.icu

**The Problem**
The wellness sync function only checks two field names for HRV (`hrv` and `hrvSDNN`), but Intervals.icu likely sends it under a different key. This means your watch IS recording HRV but the sync is silently ignoring it.

**The Fix**

### 1. Add diagnostic logging to the sync function
Log the raw Intervals.icu wellness payload for one record so we can see exactly what field names are being sent. This will confirm the correct HRV field name.

### 2. Expand HRV field mapping
Update `supabase/functions/intervals-wellness/index.ts` to also check these common Intervals.icu field names:
- `rMSSD` (most common HRV metric from wearables)
- `morningHrv`
- `avgHrv`
- `lnRmssd`

### 3. Re-sync to backfill
After deploying the fix, trigger a re-sync to pull in the last 90 days of HRV data that was previously ignored.

### 4. Readiness score improvement
Once real HRV data flows in, the readiness calculation will use actual values instead of the penalty default (25/100), which should bring the score closer to Zepp's number.

### Technical Details

**File: `supabase/functions/intervals-wellness/index.ts`**
- Add `console.log` of the first wellness record's keys to identify the correct HRV field
- Expand the HRV mapping block to try: `hrv`, `hrvSDNN`, `rMSSD`, `morningHrv`, `avgHrv`, `lnRmssd`

**No other files need changes** -- the readiness scoring already handles HRV correctly when the data is present.

