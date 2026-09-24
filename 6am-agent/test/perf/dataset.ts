/**
 * Synthetic Claude Code data dir for the H31 initial-sync memory measurement. Deterministic for
 * a given seed, no real data: every string is generated. The shape follows the real data dir
 * measured in claude-data-contract §1 (main + subagent transcripts, API messages split over
 * several lines with non-decreasing usage, most lines a few KB, a tail of tool results from
 * 100 KB up to ~5 MB).
 */
import { mkdirSync, openSync, writeSync, closeSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { seeded } from '../validation/gen.js';

export interface DatasetOptions {
  /** `CLAUDE_CONFIG_DIR`: `projects/` and `.claude.json` are created inside. */
  dir: string;
  sessions: number;
  /** Distinct API messages (usage records after dedup) across all sessions. */
  usageRecords: number;
  seed: number;
}

export interface DatasetStats {
  projects: number;
  mainFiles: number;
  subagentFiles: number;
  lines: number;
  usageLines: number;
  usageRecords: number;
  bytes: number;
  largestLine: number;
}

const PROJECTS = 40;
const BASE_MS = Date.parse('2026-08-01T08:00:00.000Z');
const DAY_MS = 86_400_000;
const MODELS = ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'] as const;
const VERSIONS = ['2.1.270', '2.1.272', '2.1.274'] as const;
const WORDS =
  'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua const function return import export interface "quoted" \\path\\ tab\t newline\n unicode é ü 日本 ✓'.split(
    ' ',
  );

type Rng = ReturnType<typeof seeded>;

/** A pool of text sliced at random offsets: cheap to produce, varied enough for JSON escaping. */
function textPool(rng: Rng, size: number): string {
  const parts: string[] = [];
  let length = 0;
  while (length < size) {
    const w = rng.pick(WORDS);
    parts.push(w);
    length += w.length + 1;
  }
  return parts.join(' ');
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const uuidFor = (kind: number, n: number) =>
  `${pad(kind, 8)}-0000-4000-8000-${pad(n, 12)}`.slice(0, 36);

/** Size of a tool result, in characters: mostly small, a long tail up to ~5 MB. */
function toolResultSize(rng: Rng): number {
  const r = rng.next();
  if (r < 0.7) return rng.int(300, 4_000);
  if (r < 0.95) return rng.int(8_000, 80_000);
  if (r < 0.995) return rng.int(100_000, 600_000);
  return rng.int(1_000_000, 4_900_000);
}

export function generateDataset(o: DatasetOptions): DatasetStats {
  const rng = seeded(o.seed);
  const pool = textPool(rng, 5_200_000);
  const slice = (n: number) => {
    const from = rng.int(0, pool.length - n - 1);
    return pool.slice(from, from + n);
  };
  const projectsDir = path.join(o.dir, 'projects');
  mkdirSync(projectsDir, { recursive: true });
  writeFileSync(
    path.join(o.dir, '.claude.json'),
    JSON.stringify({
      numStartups: 42,
      oauthAccount: {
        accountUuid: 'a3100000-0000-4000-8000-000000000001',
        emailAddress: 'perf.developer@example.com',
        displayName: 'Perf Developer',
        organizationUuid: 'a3100000-0000-4000-8000-000000000002',
        organizationName: 'Example Org',
      },
    }),
  );

  const stats: DatasetStats = {
    projects: 0,
    mainFiles: 0,
    subagentFiles: 0,
    lines: 0,
    usageLines: 0,
    usageRecords: 0,
    bytes: 0,
    largestLine: 0,
  };
  let uuidSeq = 0;
  let msgSeq = 0;

  const perSession = Math.max(1, Math.round(o.usageRecords / o.sessions));
  let remaining = o.usageRecords;

  for (let s = 0; s < o.sessions; s++) {
    const project = s % PROJECTS;
    const cwd = `/Users/perf/work/project-${pad(project, 3)}`;
    const projectDir = path.join(projectsDir, cwd.replace(/[^A-Za-z0-9]/g, '-'));
    if (s < PROJECTS) {
      mkdirSync(projectDir, { recursive: true });
      stats.projects += 1;
    }
    const sessionId = uuidFor(31, s + 1);
    const sessionsLeft = o.sessions - s;
    const messages =
      sessionsLeft === 1
        ? remaining
        : Math.max(1, Math.min(remaining - (sessionsLeft - 1), rng.int(1, perSession * 2 - 1)));
    remaining -= messages;
    const withSubagent = messages >= 4 && rng.next() < 0.35;
    const subMessages = withSubagent ? Math.floor(messages / 3) : 0;
    const version = rng.pick(VERSIONS);
    let clock = BASE_MS - rng.int(1, 60) * DAY_MS + rng.int(0, DAY_MS);

    const writeFile = (file: string, sidechain: boolean, count: number) => {
      const fd = openSync(file, 'w');
      const emit = (value: unknown) => {
        const line = `${JSON.stringify(value)}\n`;
        const bytes = Buffer.byteLength(line);
        writeSync(fd, line);
        stats.lines += 1;
        stats.bytes += bytes;
        stats.largestLine = Math.max(stats.largestLine, bytes);
      };
      const base = () => ({
        parentUuid: null,
        isSidechain: sidechain,
        userType: 'external',
        cwd,
        sessionId,
        version,
        gitBranch: 'main',
        entrypoint: 'cli',
      });
      const stamp = () => {
        clock += rng.int(200, 90_000);
        return new Date(clock).toISOString();
      };
      if (!sidechain) {
        emit({ type: 'permission-mode', permissionMode: 'default', sessionId });
        emit({
          type: 'file-history-snapshot',
          messageId: uuidFor(32, ++uuidSeq),
          snapshot: { trackedFileBackups: {}, timestamp: stamp() },
          isSnapshotUpdate: false,
        });
      }
      emit({
        ...base(),
        type: 'user',
        message: { role: 'user', content: slice(rng.int(40, 2_000)) },
        uuid: uuidFor(33, ++uuidSeq),
        timestamp: stamp(),
      });
      for (let m = 0; m < count; m++) {
        const id = `msg_01perf${pad(++msgSeq, 16)}`;
        const requestId = `req_01perf${pad(msgSeq, 16)}`;
        const model = sidechain ? 'claude-haiku-4-5' : rng.pick(MODELS);
        const input = rng.int(1, 40);
        const cacheCreation = rng.int(0, 30_000);
        const cacheRead = rng.int(0, 400_000);
        const finalOutput = rng.int(20, 8_000);
        // One API message is written as 1–3 lines (thinking, text, tool_use), usage growing.
        const splits = rng.int(1, 3);
        let toolUseId: string | null = null;
        for (let k = 0; k < splits; k++) {
          const last = k === splits - 1;
          let content: unknown;
          if (!last) {
            content = [{ type: 'thinking', thinking: slice(rng.int(100, 6_000)), signature: 'x' }];
          } else {
            toolUseId = `toolu_01perf${pad(msgSeq, 16)}`;
            const toolInput =
              rng.next() < 0.03
                ? { file_path: `${cwd}/src/file.ts`, content: slice(toolResultSize(rng)) }
                : { command: slice(rng.int(20, 400)) };
            content = [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: toolInput }];
          }
          emit({
            ...base(),
            message: {
              model,
              id,
              type: 'message',
              role: 'assistant',
              content,
              stop_reason: last ? 'tool_use' : null,
              stop_sequence: null,
              usage: {
                input_tokens: input,
                cache_creation_input_tokens: cacheCreation,
                cache_read_input_tokens: cacheRead,
                output_tokens: last ? finalOutput : Math.floor(finalOutput / (splits - k + 1)),
                service_tier: 'standard',
              },
            },
            requestId,
            type: 'assistant',
            uuid: uuidFor(34, ++uuidSeq),
            timestamp: stamp(),
          });
          stats.usageLines += 1;
        }
        stats.usageRecords += 1;
        const result = slice(toolResultSize(rng));
        emit({
          ...base(),
          type: 'user',
          message: {
            role: 'user',
            content: [{ tool_use_id: toolUseId, type: 'tool_result', content: result }],
          },
          uuid: uuidFor(35, ++uuidSeq),
          timestamp: stamp(),
          toolUseResult: { stdout: result.slice(0, 2_000), stderr: '', interrupted: false },
        });
        if (rng.next() < 0.05) {
          emit({
            ...base(),
            type: 'system',
            subtype: 'informational',
            content: slice(rng.int(50, 300)),
            uuid: uuidFor(36, ++uuidSeq),
            timestamp: stamp(),
          });
        }
      }
      closeSync(fd);
    };

    writeFile(path.join(projectDir, `${sessionId}.jsonl`), false, messages - subMessages);
    stats.mainFiles += 1;
    if (withSubagent) {
      const subDir = path.join(projectDir, sessionId, 'subagents');
      mkdirSync(subDir, { recursive: true });
      writeFile(path.join(subDir, `agent-${pad(s, 6)}.jsonl`), true, subMessages);
      stats.subagentFiles += 1;
    }
  }
  return stats;
}
