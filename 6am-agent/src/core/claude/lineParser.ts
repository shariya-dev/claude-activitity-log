/**
 * Tolerant transcript line parser (claude-data-contract §4–5). Returns null for lines that
 * are skipped: not JSON, not an object, or an unknown `type`. Category gating happens here:
 * git branch, model and prompt text are only read when their category is ON.
 */
import { extractPrompt } from './prompt.js';

export const KNOWN_LINE_TYPES: ReadonlySet<string> = new Set([
  'assistant',
  'user',
  'attachment',
  'system',
  'queue-operation',
  'file-history-delta',
  'pr-link',
  'frame-link',
  'last-prompt',
  'ai-title',
  'cost-state',
  'bridge-session',
  'atis-latch',
  'mode',
  'permission-mode',
  'file-history-snapshot',
  'artifact-autoreact-ledger',
  'artifact-comment-monitor',
]);

const SYNTHETIC_MODEL = '<synthetic>';

export interface LineGates {
  model: boolean;
  git: boolean;
  prompt: boolean;
}

export interface LineUsage {
  /** Dedup key: `message.id`, else `requestId`, else line `uuid`. */
  key: string;
  requestId: string | null;
  /** `<synthetic>` placeholder lines are local, not API calls: never sent. */
  synthetic: boolean;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
}

export interface ParsedLine {
  type: string;
  sessionId: string | null;
  uuid: string | null;
  timestampMs: number | null;
  cwd: string | null;
  version: string | null;
  entrypoint: string | null;
  gitBranch: string | null;
  isSidechain: boolean;
  model: string | null;
  usage: LineUsage | null;
  prompt: string | null;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function tokens(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parseUsage(line: Json, message: Json, rawModel: string | null): LineUsage | null {
  const usage = message.usage;
  if (!isObject(usage)) return null;
  const requestId = str(line.requestId, 64);
  const key = str(message.id, 64) ?? requestId ?? str(line.uuid, 64);
  if (key === null) return null;
  return {
    key,
    requestId,
    synthetic: rawModel === SYNTHETIC_MODEL,
    input: tokens(usage.input_tokens),
    output: tokens(usage.output_tokens),
    cacheCreation: tokens(usage.cache_creation_input_tokens),
    cacheRead: tokens(usage.cache_read_input_tokens),
  };
}

export function parseLine(text: string, gates: LineGates): ParsedLine | null {
  let line: unknown;
  try {
    line = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(line) || typeof line.type !== 'string' || !KNOWN_LINE_TYPES.has(line.type)) {
    return null;
  }
  const type = line.type;
  const message = type === 'assistant' && isObject(line.message) ? line.message : null;
  const rawModel = message === null ? null : str(message.model, 128);
  return {
    type,
    sessionId: str(line.sessionId, 64),
    uuid: str(line.uuid, 64),
    timestampMs: timestampMs(line.timestamp),
    cwd: str(line.cwd, 4096),
    version: str(line.version, 64),
    entrypoint: str(line.entrypoint, 64),
    gitBranch: gates.git ? str(line.gitBranch, 191) : null,
    isSidechain: line.isSidechain === true,
    model: gates.model && rawModel !== SYNTHETIC_MODEL ? rawModel : null,
    usage: message === null ? null : parseUsage(line, message, rawModel),
    prompt: gates.prompt && type === 'user' ? extractPrompt(line) : null,
  };
}
