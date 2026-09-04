/**
 * Cadence normalisation.
 *
 * Many devices (and FIT files) report running cadence as single-leg RPM
 * (~55-90) rather than total steps per minute (~110-180). Anything below
 * 120 is treated as single-leg and doubled so the whole app — UI and AI
 * prompts alike — always talks in steps per minute.
 */
export function toStepsPerMinute(raw: number | null | undefined): number | null {
  if (raw == null) return null;
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return null;
  return Math.round(n < 120 ? n * 2 : n);
}
