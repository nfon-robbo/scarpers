Plan:

1. Replace the RECHARGED tile calculation with a chart-only helper in `BodyBattery48hDialog.tsx`.
   - Identify the most recent contiguous sleep block in `points`.
   - Use the battery value immediately before sleep starts as `eveningBattery`.
   - Use the highest battery value in the sleep block / first wake point after sleep as `morningBattery`.
   - Calculate `actualRecharge = morningBattery - eveningBattery`.

2. Remove the unsafe fallback to `totals.rechargeTotal` for the main tile.
   - `totals.rechargeTotal` is theoretical sleep-stage points and must not drive the displayed `+X% RECHARGED` value.
   - If chart-derived values cannot be found, show a neutral unavailable state instead of a wrong theoretical number.

3. Update the tile copy to make the values auditable.
   - Example: `+46%`
   - Supporting line: `Recharged to 51% from yesterday's low of 5%`.
   - Keep the stage rows only as proportional context, scaled to the actual recharge, or label them clearly so they do not imply raw theoretical battery gain.

4. Validate with the reported scenario.
   - Given chart data around `5% → 51%`, the tile should display `+46% RECHARGED`.
   - It should never display `+95%` unless the chart itself shows an actual 95-point rise.