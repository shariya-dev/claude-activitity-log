import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPrompt, toSafeContent } from '../../../src/core/claude/prompt.js';
import { MAX_MESSAGE_CONTENT_CHARS } from '../../../src/core/contract/index.js';

const FIXTURES = path.resolve(import.meta.dirname, '../../fixtures/claude');

function promptsFrom(file: string): string[] {
  const out: string[] = [];
  for (const raw of readFileSync(path.join(FIXTURES, file), 'utf8').split('\n')) {
    if (raw.trim() === '') continue;
    let line: unknown;
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    const p = extractPrompt(line as Record<string, unknown>);
    if (p !== null) out.push(p);
  }
  return out;
}

function expectedContents(file: string): string[] {
  const exp = JSON.parse(readFileSync(path.join(FIXTURES, 'expected', file), 'utf8')) as {
    messages: { content: string }[];
  };
  return exp.messages.map((m) => m.content);
}

const user = (content: unknown, extra: Record<string, unknown> = {}) => ({
  type: 'user',
  uuid: 'u1',
  message: { role: 'user', content },
  ...extra,
});

describe('extractPrompt (fixtures)', () => {
  it('basic-session yields exactly the two typed prompts', () => {
    const got = promptsFrom('basic-session.jsonl');
    expect(got).toEqual(expectedContents('basic-session.json'));
    expect(got).toHaveLength(2);
  });

  it('multi-model yields the 3 prompts including the joined array one', () => {
    const got = promptsFrom('multi-model.jsonl');
    expect(got).toEqual(expectedContents('multi-model.json'));
    expect(got[2]).toBe('Lorem ipsum dolor.\nSit amet consectetur.');
  });
});

describe('extractPrompt (rules)', () => {
  it('returns a typed string prompt', () => {
    expect(extractPrompt(user('hello'))).toBe('hello');
  });

  it('keeps untrimmed content but requires non-blank text', () => {
    expect(extractPrompt(user('  hi  '))).toBe('  hi  ');
    expect(extractPrompt(user('   \n\t'))).toBeNull();
    expect(extractPrompt(user(''))).toBeNull();
  });

  it.each([['assistant'], ['system'], ['queue-operation'], [undefined]])(
    'ignores type %s',
    (type) => {
      expect(extractPrompt({ ...user('hello'), type })).toBeNull();
    },
  );

  it.each([['isMeta'], ['isSidechain'], ['isCompactSummary'], ['isVisibleInTranscriptOnly']])(
    'excludes %s: true',
    (flag) => {
      expect(extractPrompt(user('hello', { [flag]: true }))).toBeNull();
      expect(extractPrompt(user('hello', { [flag]: false }))).toBe('hello');
    },
  );

  it('excludes non-human origin kinds', () => {
    for (const kind of ['task-notification', 'peer', 'coordinator']) {
      expect(extractPrompt(user('hello', { origin: { kind } }))).toBeNull();
    }
    expect(extractPrompt(user('hello', { origin: { kind: 'human' } }))).toBe('hello');
    expect(extractPrompt(user('hello', { origin: {} }))).toBe('hello');
    expect(extractPrompt(user('hello', { origin: null }))).toBe('hello');
    expect(extractPrompt(user('hello', { origin: 'peer' }))).toBeNull();
    expect(extractPrompt(user('hello', { origin: ['human'] }))).toBeNull();
  });

  it.each([
    ['<command-name>/clear</command-name>'],
    ['  \n<system-reminder>x</system-reminder>'],
    ['<bash-input>ls</bash-input>'],
    ['<task-notification>\nx'],
    ['<foo/>'],
    ['<ns:tag attr="1">x'],
    ['<user-prompt-submit-hook>x'],
  ])('excludes string content starting with a tag: %j', (content) => {
    expect(extractPrompt(user(content))).toBeNull();
  });

  it('keeps content that merely contains or starts with a non-tag <', () => {
    expect(extractPrompt(user('a < b and <tag> later'))).toBe('a < b and <tag> later');
    expect(extractPrompt(user('<3 thanks'))).toBe('<3 thanks');
    expect(extractPrompt(user('< spaced'))).toBe('< spaced');
  });

  it('excludes arrays containing a tool_result part', () => {
    expect(
      extractPrompt(
        user([
          { type: 'text', text: 'hi' },
          { type: 'tool_result', tool_use_id: 't', content: 'out' },
        ]),
      ),
    ).toBeNull();
  });

  it('joins text parts, drops tagged parts, ignores images and junk', () => {
    expect(
      extractPrompt(
        user([
          { type: 'text', text: 'first' },
          { type: 'image', source: { type: 'base64', data: 'AAAA' } },
          { type: 'text', text: '<system-reminder>injected</system-reminder>' },
          { type: 'text', text: 42 },
          { type: 'text' },
          null,
          'bare string',
          { text: 'no type' },
          { type: 'text', text: 'second' },
        ]),
      ),
    ).toBe('first\nsecond');
  });

  it('returns null when no usable text parts remain', () => {
    expect(extractPrompt(user([]))).toBeNull();
    expect(extractPrompt(user([{ type: 'image' }]))).toBeNull();
    expect(extractPrompt(user([{ type: 'text', text: '<command-name>x' }]))).toBeNull();
    expect(extractPrompt(user([{ type: 'text', text: '  ' }]))).toBeNull();
  });

  it('returns null for missing or odd message shapes', () => {
    expect(extractPrompt({ type: 'user' })).toBeNull();
    expect(extractPrompt({ type: 'user', message: null })).toBeNull();
    expect(extractPrompt({ type: 'user', message: 'x' })).toBeNull();
    expect(extractPrompt({ type: 'user', message: {} })).toBeNull();
    expect(extractPrompt(user(42))).toBeNull();
    expect(extractPrompt(user({ text: 'obj' }))).toBeNull();
  });

  it('returns safe content', () => {
    expect(extractPrompt(user('a\uD800b'))).toBe('a�b');
    const long = 'x'.repeat(MAX_MESSAGE_CONTENT_CHARS + 10);
    expect(extractPrompt(user(long))).toHaveLength(MAX_MESSAGE_CONTENT_CHARS);
  });
});

describe('toSafeContent', () => {
  it('replaces lone surrogates and keeps valid pairs', () => {
    expect(toSafeContent('a\uD800b')).toBe('a�b');
    expect(toSafeContent('a\uDC00b')).toBe('a�b');
    expect(toSafeContent('\uD800')).toBe('�');
    expect(toSafeContent('end\uD83D')).toBe('end�');
    expect(toSafeContent('\uDE00\uD83D')).toBe('��');
    expect(toSafeContent('ok 😀 fine')).toBe('ok 😀 fine');
    expect(toSafeContent('\uD800😀\uDC00')).toBe('\uFFFD😀\uFFFD');
  });

  it('leaves content at the limit untouched', () => {
    const s = 'y'.repeat(MAX_MESSAGE_CONTENT_CHARS);
    expect(toSafeContent(s)).toBe(s);
  });

  it('truncates to the limit in UTF-16 code units', () => {
    const s = 'z'.repeat(MAX_MESSAGE_CONTENT_CHARS * 2);
    expect(toSafeContent(s)).toHaveLength(MAX_MESSAGE_CONTENT_CHARS);
  });

  it('never splits a surrogate pair straddling the boundary', () => {
    const s = 'a'.repeat(MAX_MESSAGE_CONTENT_CHARS - 1) + '😀' + 'tail';
    const out = toSafeContent(s);
    expect(out).toHaveLength(MAX_MESSAGE_CONTENT_CHARS - 1);
    expect(out).toBe('a'.repeat(MAX_MESSAGE_CONTENT_CHARS - 1));
    expect(out).not.toMatch(/[\uD800-\uDFFF]$/);
  });

  it('keeps a pair that ends exactly on the boundary', () => {
    const s = 'a'.repeat(MAX_MESSAGE_CONTENT_CHARS - 2) + '😀' + 'tail';
    const out = toSafeContent(s);
    expect(out).toHaveLength(MAX_MESSAGE_CONTENT_CHARS);
    expect(out.endsWith('😀')).toBe(true);
  });
});
