/**
 * Opt-in: H23_REAL_CLAUDE_DIR=<claude data dir> [H23_REAL_SESSION=<session id>]
 * Reads a real Claude data dir read-only with the agent scanner and the oracle and compares
 * every total, session, day, model and session-day. Output carries ids and numbers only.
 *
 * Sessions still being written while the test runs (e.g. the Claude Code session running it)
 * are read at different moments by the two sides, so they are excluded and only counted.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  agentBreakdown,
  agentScanner,
  oracleBreakdown,
  runOracle,
  scanAll,
  serverMerge,
  usageOf,
  validationOptions,
  type Breakdown,
  type Metrics,
} from './support.js';

const DIR = process.env.H23_REAL_CLAUDE_DIR;
const SESSION = process.env.H23_REAL_SESSION;

type Diff = { group: string; key: string; agent: Metrics | null; oracle: Metrics | null };

function diff(agent: Breakdown, oracle: Breakdown): Diff[] {
  const out: Diff[] = [];
  const same = (a: Metrics | undefined, b: Metrics | undefined) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (!same(agent.totals, oracle.totals)) {
    out.push({ group: 'totals', key: '-', agent: agent.totals, oracle: oracle.totals });
  }
  for (const group of ['sessions', 'days', 'models', 'sessionDays'] as const) {
    const keys = new Set([...Object.keys(agent[group]), ...Object.keys(oracle[group])]);
    for (const key of keys) {
      const a = agent[group][key];
      const o = oracle[group][key];
      if (!same(a, o)) out.push({ group, key, agent: a ?? null, oracle: o ?? null });
    }
  }
  return out;
}

/** Session ids with a main or subagent transcript modified at or after `sinceMs`. */
async function liveSessions(dir: string, sinceMs: number): Promise<Set<string>> {
  const live = new Set<string>();
  const projects = path.join(dir, 'projects');
  const recent = async (file: string) => (await stat(file)).mtimeMs >= sinceMs;
  for (const project of await readdir(projects, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const pdir = path.join(projects, project.name);
    for (const e of await readdir(pdir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.jsonl')) {
        if (await recent(path.join(pdir, e.name))) live.add(e.name.slice(0, -'.jsonl'.length));
      } else if (e.isDirectory()) {
        const sub = path.join(pdir, e.name, 'subagents');
        const files = await readdir(sub).catch(() => [] as string[]);
        for (const f of files.filter((n) => n.endsWith('.jsonl'))) {
          if (await recent(path.join(sub, f))) live.add(e.name);
        }
      }
    }
  }
  return live;
}

describe.skipIf(!DIR)('H23 agent validation — real Claude data (opt-in, read-only)', () => {
  it('agent == oracle on totals, every session, day, model and session-day', async () => {
    const started = Date.now();
    let report = runOracle(DIR!, SESSION ? { sessions: [SESSION] } : {});
    const oracleMs = Date.now() - started;

    const chunks = await scanAll(agentScanner(DIR!), new Map(), validationOptions());
    let usage = usageOf(chunks);
    const agentMs = Date.now() - started - oracleMs;

    const live = await liveSessions(DIR!, started - 1000);
    if (SESSION) {
      expect(live.has(SESSION), 'the chosen session is still being written').toBe(false);
      usage = usage.filter((u) => u.source_session_id === SESSION);
    } else if (live.size > 0) {
      const ids = new Set([
        ...report.sessions.map((r) => r.session_id),
        ...usage.map((u) => u.source_session_id),
      ]);
      const settled = [...ids].filter((id): id is string => id !== null && !live.has(id));
      report = runOracle(DIR!, { sessions: settled });
      usage = usage.filter((u) => !live.has(u.source_session_id));
    }
    const oracle = oracleBreakdown(report);
    const agent = agentBreakdown(serverMerge(usage));

    const diffs = diff(agent, oracle);
    console.log(
      JSON.stringify({
        files: report.diagnostics.files,
        chunks: chunks.length,
        emittedUsage: usage.length,
        sessions: Object.keys(oracle.sessions).length,
        days: Object.keys(oracle.days).length,
        models: Object.keys(oracle.models).length,
        oracleMessages: oracle.totals.message_count,
        agentMessages: agent.totals.message_count,
        oracleMs,
        agentMs,
        liveSessionsExcluded: SESSION ? 0 : live.size,
        mismatches: diffs.length,
      }),
    );
    for (const d of diffs.slice(0, 50)) console.log(JSON.stringify(d));

    expect(diffs).toEqual([]);
    expect(agent).toEqual(oracle);
  }, 300_000);
});
