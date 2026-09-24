/**
 * Claude Code transcript lines for appending "new activity" to a scenario's CLAUDE_CONFIG_DIR.
 * Same shape as the H02 fixtures (`6am-agent/test/fixtures/claude/basic-session.jsonl`), with
 * fresh ids and current timestamps. Synthetic text only.
 */
import { randomUUID } from 'node:crypto';

export const PROJECT_CWD = '/home/dev/projects/demo-app';

export interface Tokens {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

let seq = 0;
/** A timestamp a few ms after the previous one, so appended lines keep their order. */
function nextTimestamp(): string {
  seq += 1;
  return new Date(Date.now() - 60_000 + seq).toISOString();
}

export function newMessageId(): string {
  return `msg_01E2E${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function base(sessionId: string, type: string) {
  return {
    parentUuid: null,
    isSidechain: false,
    userType: 'external',
    cwd: PROJECT_CWD,
    sessionId,
    version: '2.1.274',
    gitBranch: 'main',
    entrypoint: 'cli',
    type,
    uuid: randomUUID(),
    timestamp: nextTimestamp(),
  };
}

/** A typed prompt (a `user` line with string content): becomes a message only when Prompt is ON. */
export function userPrompt(sessionId: string, text: string): Record<string, unknown> {
  return { ...base(sessionId, 'user'), message: { role: 'user', content: text } };
}

/** One API message with usage. `splitLines` > 1 repeats it with identical usage, as Claude Code does. */
export function assistantMessage(
  sessionId: string,
  tokens: Tokens,
  o: { messageId?: string; model?: string; splitLines?: number } = {},
): { id: string; lines: Record<string, unknown>[] } {
  const id = o.messageId ?? newMessageId();
  const requestId = `req_01E2E${id.slice(9)}`;
  const parts = o.splitLines ?? 1;
  const lines = Array.from({ length: parts }, (_, i) => ({
    ...base(sessionId, 'assistant'),
    requestId,
    message: {
      id,
      type: 'message',
      role: 'assistant',
      model: o.model ?? 'claude-sonnet-5',
      content: [{ type: 'text', text: 'Lorem ipsum dolor sit amet.' }],
      stop_reason: i === parts - 1 ? 'end_turn' : null,
      stop_sequence: null,
      usage: {
        input_tokens: tokens.input,
        cache_creation_input_tokens: tokens.cacheCreation,
        cache_read_input_tokens: tokens.cacheRead,
        output_tokens: tokens.output,
        service_tier: 'standard',
      },
    },
  }));
  return { id, lines };
}

/** A prompt followed by one API message: the smallest realistic "turn". */
export function turn(
  sessionId: string,
  prompt: string,
  tokens: Tokens,
  o: { splitLines?: number } = {},
): { messageId: string; lines: Record<string, unknown>[] } {
  const reply = assistantMessage(sessionId, tokens, o);
  return { messageId: reply.id, lines: [userPrompt(sessionId, prompt), ...reply.lines] };
}
