## Plan

1. **Fetch the active plan content**
   - Read the latest non-archived row from `training_plans`.
   - Work from the returned `content` string directly, not through the existing validator.

2. **Manually remove only the second duplicate plain-text lines**
   - Replace consecutive duplicate occurrences of:
     - `Monday 18/05/2026 — Rest Day (session moved)`
     - `Monday 29/06/2026 — Rest Day`
   - Keep exactly one copy of each line when those duplicate pairs exist.
   - Save the corrected full content back to the same active `training_plans` row with a direct database update.

3. **Verify the database update**
   - Fetch the same row back after the update.
   - Count exact plain-text line occurrences for both target lines.
   - Confirm each appears no more than once in returned `content`.
   - Also confirm the date-start count for each target date is not duplicated unexpectedly.

4. **Simplify and harden `dedupeDates`**
   - Add an early pass in `src/lib/plan-validation.ts` that checks consecutive lines.
   - If two consecutive lines start with the same `Weekday DD/MM/YYYY` pattern, remove the second line, regardless of markdown/plain-text format.
   - This will catch:
     - `Monday 18/05/2026 — ...`
     - `### **Monday 18/05/2026** — ...`
     - mixed consecutive duplicates where both lines start with the same logical date.

5. **Validate the validator change**
   - Run a focused local smoke test against sample markdown containing two consecutive identical plain date lines.
   - Confirm `dedupeDates` removes the second line and reports a correction.

## Technical details

- Use `supabase.insert` for the database `UPDATE` because this is a data change, not a schema migration.
- Avoid relying on the existing full validation pipeline for the database cleanup; perform the direct string correction first.
- Keep the validator change scoped to duplicate consecutive date-start lines only, so it does not alter unrelated plan content.