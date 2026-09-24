/**
 * H31: peak RSS of the BUILT agent's initial sync over a synthetic data dir.
 *
 *   npm run build
 *   npx tsx test/perf/initialSyncRss.ts [--sessions 600] [--usage 27000] [--seed 31]
 *       [--port 8731] [--target-mb 120] [--data <dir>] [--keep] [--node-flags "--trace-gc"]
 *       [--snapshot-at-mb <n>] [--timeline] [--prompt] [--dist dist/<target>]
 *
 * Everything lives in a temp dir: HOME, CLAUDE_CONFIG_DIR (the generated data) and the agent's
 * data dir, so the real ~/.claude and ~/.claude.json are never read. The agent runs from
 * `dist/<target>/app/agent.cjs` on its bundled Node runtime with the dev overrides (fake adapter,
 * file credentials) against the in-process fake backend (fakeBackend.ts). A `--require` probe in
 * the agent process records `process.resourceUsage().maxRSS` (the kernel's peak) and sampled
 * `process.memoryUsage()` maxima. Settings are the defaults (Prompt OFF; `--prompt` turns it ON)
 * with `initial_sync: all`. Exits 1 when the sync fails or the peak is over the target.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generateDataset } from './dataset.js';
import { PERF_PAIRING_CODE, startFakeBackend } from './fakeBackend.js';

interface Probe {
  maxRssKb: number;
  /** With --timeline: [ms, rss, heapUsed, heapTotal, external, arrayBuffers] every 20 ms. */
  timeline: number[][] | null;
  sampled: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  };
}

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(1);

/** Loaded with `--require` into the agent process. Plain CommonJS, no dependencies. */
const PROBE_SOURCE = `
const fs = require('node:fs');
const v8 = require('node:v8');
const out = process.env.H31_PROBE_OUT;
const snapshotAt = Number(process.env.H31_SNAPSHOT_AT_MB || 0) * 1024 * 1024;
const max = { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 };
const timeline = process.env.H31_TIMELINE === '1' ? [] : null;
const t0 = Date.now();
let snapped = false;
const sample = () => {
  const m = process.memoryUsage();
  for (const k of Object.keys(max)) if (m[k] > max[k]) max[k] = m[k];
  if (timeline !== null) timeline.push([Date.now() - t0, ...Object.keys(max).map((k) => m[k])]);
  if (snapshotAt > 0 && !snapped && m.rss >= snapshotAt) {
    snapped = true;
    v8.writeHeapSnapshot(out + '.heapsnapshot');
  }
};
setInterval(sample, 20).unref();
process.on('exit', () => {
  sample();
  const maxRssKb = process.resourceUsage().maxRSS;
  fs.writeFileSync(out, JSON.stringify({ maxRssKb, sampled: max, timeline }));
});
`;

function findDist(explicit: string | undefined): string {
  if (explicit !== undefined) return path.resolve(explicit);
  const root = path.resolve('dist');
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    const dir = path.join(root, name);
    if (existsSync(path.join(dir, 'app', 'agent.cjs'))) return dir;
  }
  throw new Error('no built agent under dist/: run `npm run build` first');
}

function runtimeNode(dist: string): string {
  for (const name of ['node', 'node.exe']) {
    const p = path.join(dist, 'runtime', name);
    if (existsSync(p)) return p;
  }
  throw new Error(`no bundled Node runtime in ${dist}/runtime`);
}

function run(
  node: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; ms: number; stdout: string; stderr: string }> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(node, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, ms: Date.now() - started, stdout, stderr }));
  });
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      sessions: { type: 'string', default: '600' },
      usage: { type: 'string', default: '27000' },
      seed: { type: 'string', default: '31' },
      port: { type: 'string', default: '8731' },
      'target-mb': { type: 'string', default: '120' },
      data: { type: 'string' },
      keep: { type: 'boolean', default: false },
      'node-flags': { type: 'string', default: '' },
      'snapshot-at-mb': { type: 'string', default: '0' },
      timeline: { type: 'boolean', default: false },
      prompt: { type: 'boolean', default: false },
      dist: { type: 'string' },
    },
  });
  const dist = findDist(values.dist);
  const node = runtimeNode(dist);
  const agent = path.join(dist, 'app', 'agent.cjs');
  const root = mkdtempSync(path.join(tmpdir(), '6am-h31-perf-'));
  const home = path.join(root, 'home');
  const claudeDir =
    values.data === undefined ? path.join(home, '.claude') : path.resolve(values.data);

  try {
    if (values.data === undefined) {
      const started = Date.now();
      const stats = generateDataset({
        dir: claudeDir,
        sessions: Number(values.sessions),
        usageRecords: Number(values.usage),
        seed: Number(values.seed),
      });
      console.log(
        `dataset: ${stats.mainFiles} main + ${stats.subagentFiles} subagent files in ${stats.projects} projects, ` +
          `${stats.lines} lines (${stats.usageLines} usage lines, ${stats.usageRecords} usage records), ` +
          `${mb(stats.bytes)} MB, largest line ${mb(stats.largestLine)} MB, ${Date.now() - started} ms`,
      );
    }

    const probeFile = path.join(root, 'probe.cjs');
    writeFileSync(probeFile, PROBE_SOURCE);
    const backend = await startFakeBackend(Number(values.port), { prompt: values.prompt });
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: home,
      USERPROFILE: home,
      CLAUDE_CONFIG_DIR: claudeDir,
      AGENT_DATA_DIR: path.join(root, 'agent'),
      AGENT_ADAPTER: 'fake',
      AGENT_API_BASE_URL: backend.url,
      AGENT_ALLOW_INSECURE_LOCALHOST: '1',
    };
    const probed = (name: string): NodeJS.ProcessEnv => ({
      ...baseEnv,
      H31_PROBE_OUT: path.join(root, `${name}.json`),
      H31_SNAPSHOT_AT_MB: values['snapshot-at-mb'],
      H31_TIMELINE: values.timeline ? '1' : '0',
    });
    const nodeFlags = values['node-flags'].split(' ').filter((f) => f !== '');
    const readProbe = (name: string): Probe =>
      JSON.parse(readFileSync(path.join(root, `${name}.json`), 'utf8')) as Probe;

    try {
      const pair = await run(node, [agent, 'pair', PERF_PAIRING_CODE], baseEnv);
      if (pair.code !== 0) throw new Error(`pair failed: ${pair.stderr.trim()}`);

      const idle = await run(node, ['--require', probeFile, agent, 'status'], probed('status'));
      if (idle.code !== 0) throw new Error(`status failed: ${idle.stderr.trim()}`);

      const sync = await run(
        node,
        [...nodeFlags, '--require', probeFile, agent, 'sync-now'],
        probed('sync'),
      );
      if (values['node-flags'] !== '') process.stdout.write(sync.stdout);
      const totals = backend.totals();
      const p = readProbe('sync');
      const base = readProbe('status');
      const peakMb = p.maxRssKb / 1024;
      const target = Number(values['target-mb']);

      console.log(`agent: ${path.relative(process.cwd(), agent)} on ${node}`);
      console.log(
        `sync-now: exit ${sync.code}, ${sync.ms} ms: ${sync.stdout.trim()} ${sync.stderr.trim()}`,
      );
      console.log(
        `backend: ${totals.batches} batches, ${totals.sessions} sessions, ${totals.usage} usage, ` +
          `${totals.projects} projects, ${totals.accounts} accounts, ${totals.messages} messages; ` +
          `body ${mb(totals.bodyBytes)} MB (max ${mb(totals.maxBodyBytes)} MB), wire ${mb(totals.wireBytes)} MB`,
      );
      console.log(`payload digest: ${totals.digest}`);
      if (totals.errors.length > 0) console.log(`backend errors: ${totals.errors.join('; ')}`);
      console.log(
        `baseline (status, no sync): peak RSS ${(base.maxRssKb / 1024).toFixed(1)} MB, ` +
          `heap used ${mb(base.sampled.heapUsed)} MB`,
      );
      console.log(
        `sampled maxima during sync: rss ${mb(p.sampled.rss)} MB, heapTotal ${mb(p.sampled.heapTotal)} MB, ` +
          `heapUsed ${mb(p.sampled.heapUsed)} MB, external ${mb(p.sampled.external)} MB, ` +
          `arrayBuffers ${mb(p.sampled.arrayBuffers)} MB`,
      );
      if (p.timeline !== null) {
        console.log('timeline (ms rss heapUsed heapTotal external arrayBuffers, MB):');
        const step = Math.max(1, Math.floor(p.timeline.length / 40));
        p.timeline
          .filter((_, i) => i % step === 0)
          .forEach(([ms, ...m]) => console.log(`  ${ms} ${m.map((v) => mb(v)).join(' ')}`));
      }
      const ok = sync.code === 0 && totals.errors.length === 0 && peakMb < target;
      console.log(
        `PEAK RSS (initial sync): ${peakMb.toFixed(1)} MB (target < ${target} MB) -> ${ok ? 'PASS' : 'FAIL'}`,
      );
      return ok ? 0 : 1;
    } finally {
      await backend.close();
    }
  } finally {
    if (values.keep) console.log(`kept: ${root}`);
    else rmSync(root, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
