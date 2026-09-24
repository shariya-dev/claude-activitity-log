import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KNOWN_LINE_TYPES, parseLine } from '../../../src/core/claude/lineParser.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/claude');
const ALL_ON = { model: true, git: true, prompt: true };
const ALL_OFF = { model: false, git: false, prompt: false };

function fixtureLines(name: string): string[] {
  return readFileSync(path.join(FIXTURES, name), 'utf8').split('\n').slice(0, -1);
}

const assistant = (over: Record<string, unknown> = {}, message: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 's1',
    uuid: 'u1',
    requestId: 'req_1',
    timestamp: '2026-09-22T06:50:32.929Z',
    cwd: '/home/dev/p',
    version: '2.1.274',
    entrypoint: 'cli',
    gitBranch: 'main',
    isSidechain: false,
    ...over,
    message: {
      id: 'msg_1',
      model: 'claude-sonnet-5',
      usage: {
        input_tokens: 3,
        output_tokens: 85,
        cache_creation_input_tokens: 1200,
        cache_read_input_tokens: 15000,
      },
      ...message,
    },
  });

describe('parseLine', () => {
  it('skips non-JSON, non-object and unknown types', () => {
    expect(parseLine('{not json', ALL_ON)).toBeNull();
    expect(parseLine('[1,2]', ALL_ON)).toBeNull();
    expect(parseLine('null', ALL_ON)).toBeNull();
    expect(parseLine('', ALL_ON)).toBeNull();
    expect(parseLine('{"type":"future-unknown-type","sessionId":"s"}', ALL_ON)).toBeNull();
    expect(parseLine('{"sessionId":"s"}', ALL_ON)).toBeNull();
  });

  it('knows the 18 contract line types', () => {
    expect(KNOWN_LINE_TYPES.size).toBe(18);
    expect(parseLine('{"type":"last-prompt","lastPrompt":"secret"}', ALL_ON)).toMatchObject({
      type: 'last-prompt',
      timestampMs: null,
      prompt: null,
    });
  });

  it('extracts common fields and usage from assistant lines', () => {
    const line = parseLine(assistant(), ALL_ON);
    expect(line).toEqual({
      type: 'assistant',
      sessionId: 's1',
      uuid: 'u1',
      timestampMs: Date.parse('2026-09-22T06:50:32.929Z'),
      cwd: '/home/dev/p',
      version: '2.1.274',
      entrypoint: 'cli',
      gitBranch: 'main',
      isSidechain: false,
      model: 'claude-sonnet-5',
      usage: {
        key: 'msg_1',
        requestId: 'req_1',
        synthetic: false,
        input: 3,
        output: 85,
        cacheCreation: 1200,
        cacheRead: 15000,
      },
      prompt: null,
    });
  });

  it('does not read git branch or model when those categories are off', () => {
    const line = parseLine(assistant(), ALL_OFF);
    expect(line?.gitBranch).toBeNull();
    expect(line?.model).toBeNull();
    expect(line?.usage?.synthetic).toBe(false);
  });

  it('falls back from message.id to requestId to uuid for the usage key', () => {
    expect(parseLine(assistant({}, { id: undefined }), ALL_ON)?.usage?.key).toBe('req_1');
    expect(
      parseLine(assistant({ requestId: undefined }, { id: undefined }), ALL_ON)?.usage,
    ).toMatchObject({ key: 'u1', requestId: null });
    expect(
      parseLine(assistant({ requestId: undefined, uuid: undefined }, { id: undefined }), ALL_ON)
        ?.usage,
    ).toBeNull();
  });

  it('maps missing or invalid token numbers to 0', () => {
    const usage = parseLine(
      assistant(
        {},
        { usage: { input_tokens: -1, output_tokens: 1.5, cache_read_input_tokens: 'x' } },
      ),
      ALL_ON,
    )?.usage;
    expect(usage).toMatchObject({ input: 0, output: 0, cacheCreation: 0, cacheRead: 0 });
  });

  it('flags <synthetic> usage and nulls its model', () => {
    const line = parseLine(assistant({}, { model: '<synthetic>' }), ALL_ON);
    expect(line?.usage?.synthetic).toBe(true);
    expect(line?.model).toBeNull();
  });

  it('has no usage without a message.usage object', () => {
    expect(parseLine(assistant({}, { usage: null }), ALL_ON)?.usage).toBeNull();
    expect(
      parseLine('{"type":"assistant","sessionId":"s","message":"x"}', ALL_ON)?.usage,
    ).toBeNull();
  });

  it('nulls invalid, empty or over-long strings and bad timestamps', () => {
    const line = parseLine(
      assistant({
        sessionId: 'x'.repeat(65),
        timestamp: 'yesterday',
        cwd: '',
        version: 7,
        entrypoint: 'e'.repeat(65),
        gitBranch: 'b'.repeat(192),
        isSidechain: 'true',
      }),
      ALL_ON,
    );
    expect(line).toMatchObject({
      sessionId: null,
      timestampMs: null,
      cwd: null,
      version: null,
      entrypoint: null,
      gitBranch: null,
      isSidechain: false,
    });
  });

  it('extracts prompts only when the prompt category is on', () => {
    const lines = fixtureLines('basic-session.jsonl');
    const on = lines.map((l) => parseLine(l, ALL_ON)?.prompt).filter((p) => p != null);
    expect(on).toEqual([
      'Lorem ipsum dolor sit amet, first prompt.',
      'Lorem ipsum dolor sit amet, second prompt.',
    ]);
    const off = lines.map((l) => parseLine(l, ALL_OFF)?.prompt).filter((p) => p != null);
    expect(off).toEqual([]);
  });

  it('parses every fixture line of a known type', () => {
    const lines = fixtureLines('basic-session.jsonl');
    expect(lines.every((l) => parseLine(l, ALL_ON) !== null)).toBe(true);
  });
});
