import { describe, expect, it } from 'vitest';
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, nextDelayMs } from '../../../src/core/sync/backoff.js';

const mid = (): number => 0.5;

describe('nextDelayMs', () => {
  it('exposes the contract constants: 30 s base, 15 min cap', () => {
    expect(BACKOFF_BASE_MS).toBe(30_000);
    expect(BACKOFF_MAX_MS).toBe(900_000);
  });

  it('attempt 0 is about 30 s within ±20 % jitter', () => {
    for (let i = 0; i < 200; i++) {
      const d = nextDelayMs(0);
      expect(d).toBeGreaterThanOrEqual(24_000);
      expect(d).toBeLessThanOrEqual(36_000);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it('doubles per attempt without jitter (rand = 0.5)', () => {
    expect(nextDelayMs(0, mid)).toBe(30_000);
    expect(nextDelayMs(1, mid)).toBe(60_000);
    expect(nextDelayMs(2, mid)).toBe(120_000);
    expect(nextDelayMs(3, mid)).toBe(240_000);
    expect(nextDelayMs(4, mid)).toBe(480_000);
    expect(nextDelayMs(5, mid)).toBe(900_000);
  });

  it('rand = 0 gives 0.8x and rand = 1 gives 1.2x, clamped to the cap', () => {
    expect(nextDelayMs(0, () => 0)).toBe(24_000);
    expect(nextDelayMs(0, () => 1)).toBe(36_000);
    expect(nextDelayMs(10, () => 0)).toBe(720_000);
    expect(nextDelayMs(10, () => 1)).toBe(900_000);
  });

  it('never exceeds 15 min for attempts 0..100', () => {
    for (let n = 0; n <= 100; n++) {
      expect(nextDelayMs(n, () => 1)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      expect(nextDelayMs(n)).toBeLessThanOrEqual(BACKOFF_MAX_MS);
      expect(nextDelayMs(n, () => 0)).toBeGreaterThanOrEqual(24_000);
    }
  });

  it('handles huge attempts without overflow', () => {
    expect(nextDelayMs(1e9, mid)).toBe(900_000);
    expect(nextDelayMs(Number.POSITIVE_INFINITY, mid)).toBe(900_000);
  });

  it('treats negative and NaN attempts as 0', () => {
    expect(nextDelayMs(-3, mid)).toBe(30_000);
    expect(nextDelayMs(Number.NaN, mid)).toBe(30_000);
  });

  it('is deterministic for a given rand', () => {
    const seq = [0.1, 0.9, 0.3];
    const run = (): number[] => {
      let i = 0;
      const rand = (): number => seq[i++ % seq.length] ?? 0;
      return [0, 1, 2].map((n) => nextDelayMs(n, rand));
    };
    expect(run()).toEqual(run());
    expect(run()).toEqual([25_200, 69_600, 110_400]);
  });
});
