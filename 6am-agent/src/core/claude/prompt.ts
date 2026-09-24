/**
 * Prompt extraction (claude-data-contract §10). Only ever called when the prompt category is
 * ON; with it OFF this module is never entered. Reads only `user` lines' own content: never
 * assistant text, tool inputs/results or attachments.
 */
import { MAX_MESSAGE_CONTENT_CHARS } from '../contract/index.js';

/** Content that starts with any `<tag` is a harness wrapper (slash commands, shell, hooks). */
const LEADING_TAG = /^<[A-Za-z][\w:-]*[\s>/]/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const EXCLUDING_FLAGS = ['isMeta', 'isSidechain', 'isCompactSummary', 'isVisibleInTranscriptOnly'];

export function extractPrompt(line: Record<string, unknown>): string | null {
  if (line.type !== 'user') return null;
  if (EXCLUDING_FLAGS.some((flag) => line[flag] === true)) return null;
  const origin = line.origin;
  if (isRecord(origin) && origin.kind !== undefined && origin.kind !== 'human') return null;

  const message = line.message;
  if (!isRecord(message)) return null;
  const content = message.content;

  let text: string;
  if (typeof content === 'string') {
    if (startsWithTag(content)) return null;
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((part) => isRecord(part) && part.type === 'tool_result')) return null;
    text = content
      .filter(
        (part): part is { type: 'text'; text: string } =>
          isRecord(part) && part.type === 'text' && typeof part.text === 'string',
      )
      .map((part) => part.text)
      .filter((part) => !startsWithTag(part))
      .join('\n');
  } else {
    return null;
  }

  if (text.trim() === '') return null;
  return toSafeContent(text);
}

/** Lone surrogates → U+FFFD, then cut to the schema limit on a code-point boundary. */
export function toSafeContent(text: string): string {
  const wellFormed = text.replace(LONE_SURROGATE, '\uFFFD');
  if (wellFormed.length <= MAX_MESSAGE_CONTENT_CHARS) return wellFormed;
  let end = MAX_MESSAGE_CONTENT_CHARS;
  const last = wellFormed.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return wellFormed.slice(0, end);
}

function startsWithTag(value: string): boolean {
  return LEADING_TAG.test(value.trimStart());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
