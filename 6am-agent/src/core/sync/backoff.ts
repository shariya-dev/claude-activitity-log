/** Retry backoff for failed requests (contract §9.3): 30 s · 2^n, capped at 15 min, ±20 % jitter. */
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 900_000;

const JITTER = 0.2;

/** Doubling steps after which the base delay is already at the cap (30 s · 2^5 > 15 min). */
const MAX_EXPONENT = Math.ceil(Math.log2(BACKOFF_MAX_MS / BACKOFF_BASE_MS));

/**
 * Delay before retry number `attempt` (0-based). The cap applies before jitter and again after,
 * so the result is never above 15 min. `rand` is injectable for deterministic tests.
 */
export function nextDelayMs(attempt: number, rand: () => number = Math.random): number {
  const n = Number.isNaN(attempt) || attempt < 0 ? 0 : Math.min(attempt, MAX_EXPONENT);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** n, BACKOFF_MAX_MS);
  const jittered = base * (1 - JITTER + 2 * JITTER * rand());
  return Math.round(Math.min(jittered, BACKOFF_MAX_MS));
}
