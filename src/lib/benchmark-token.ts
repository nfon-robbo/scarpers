/**
 * Benchmark protocol types + physical duration windows.
 *
 * NOTE: This module used to also parse `[benchmark:30min]` tokens embedded in
 * plan markdown. That machinery is gone — benchmarks are now scheduled as
 * standalone `benchmark_results` rows (status='scheduled') and read via
 * `src/lib/benchmark-scheduled.ts`. Detection code should never scan plan
 * content for tokens again.
 */

export type BenchmarkProtocol = "30min" | "3k" | "5k";

/**
 * Return the expected total duration window (seconds) for an activity to be
 * considered a candidate for this protocol.
 */
export function protocolDurationWindow(
  protocol: BenchmarkProtocol,
): { minSeconds: number; maxSeconds: number } {
  switch (protocol) {
    case "30min":
      // Scheduled threshold tests are a 30-min main effort plus optional
      // warm-up/cool-down. Athletes may trim the easy bookends, so candidate
      // matching must allow runs shorter than the ideal 40-min total.
      return { minSeconds: 28 * 60, maxSeconds: 55 * 60 };
    case "3k":
      // Fast enough that the whole session sits inside ~20–45 min.
      return { minSeconds: 20 * 60, maxSeconds: 45 * 60 };
    case "5k":
      return { minSeconds: 25 * 60, maxSeconds: 55 * 60 };
  }
}
