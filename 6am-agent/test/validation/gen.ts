/** Synthetic Claude Code transcript lines for the H23 validation tests (no real data). */

export type Tokens = readonly [
  input: number,
  output: number,
  cacheCreation: number,
  cacheRead: number,
];

export interface LineCtx {
  sessionId: string;
  cwd: string;
  sidechain?: boolean;
}

let uuidSeq = 0;
const nextUuid = () => `c2300000-0000-4000-8000-${String(++uuidSeq).padStart(12, '0')}`;

export function userLine(ctx: LineCtx, timestamp: string): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: ctx.sidechain === true,
    userType: 'external',
    cwd: ctx.cwd,
    sessionId: ctx.sessionId,
    version: '2.1.274',
    gitBranch: 'main',
    entrypoint: 'cli',
    type: 'user',
    message: { role: 'user', content: 'lorem ipsum dolor sit amet' },
    uuid: nextUuid(),
    timestamp,
  });
}

export function assistantLine(
  ctx: LineCtx,
  timestamp: string,
  messageId: string,
  model: string,
  [input, output, cacheCreation, cacheRead]: Tokens,
): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: ctx.sidechain === true,
    userType: 'external',
    cwd: ctx.cwd,
    sessionId: ctx.sessionId,
    version: '2.1.274',
    gitBranch: 'main',
    entrypoint: 'cli',
    message: {
      model,
      id: messageId,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: 'lorem ipsum' }],
      stop_reason: null,
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: cacheCreation,
        cache_read_input_tokens: cacheRead,
        output_tokens: output,
        service_tier: 'standard',
      },
    },
    requestId: `req_H23${messageId.slice(-20)}`,
    type: 'assistant',
    uuid: nextUuid(),
    timestamp,
  });
}

export const jsonl = (lines: string[]) => lines.map((l) => `${l}\n`).join('');

/** mulberry32: a tiny deterministic PRNG so generated datasets never depend on Math.random. */
export function seeded(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  };
}
