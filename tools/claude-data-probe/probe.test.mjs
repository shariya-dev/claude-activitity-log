// Zero-dependency tests for probe.mjs. Run: node --test tools/claude-data-probe/probe.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE = fileURLToPath(new URL('./probe.mjs', import.meta.url));
const SECRET_PROMPT = 'SECRET_PROMPT_TEXT_zq81';
const SECRET_EMAIL = 'secret.person@example.org';
const SECRET_CWD = '/home/secretuser/work/secret-proj';
const SID = '11111111-1111-4111-8111-111111111111';

const usage = (o) => ({
  input_tokens: 3,
  output_tokens: o,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 50,
});
const base = (extra) => ({
  sessionId: SID,
  cwd: SECRET_CWD,
  gitBranch: 'secret-branch',
  version: '2.1.274',
  entrypoint: 'cli',
  isSidechain: false,
  timestamp: '2026-09-22T06:50:32.929Z',
  uuid: 'aaaaaaaa-0000-4000-8000-000000000000',
  ...extra,
});
const assistant = (id, out, part = 'text') =>
  base({
    type: 'assistant',
    requestId: 'req_1',
    message: {
      id,
      model: 'claude-sonnet-5',
      role: 'assistant',
      content: [{ type: part, text: SECRET_PROMPT }],
      usage: usage(out),
    },
  });
const jsonl = (rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'probe-test-'));
  const data = join(root, 'claude');
  const projDir = join(data, 'projects', SECRET_CWD.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(join(projDir, SID, 'subagents'), { recursive: true });
  writeFileSync(
    join(projDir, `${SID}.jsonl`),
    jsonl([
      base({ type: 'user', message: { role: 'user', content: SECRET_PROMPT } }),
      assistant('msg_A', 10, 'thinking'),
      assistant('msg_A', 10, 'text'),
      assistant('msg_A', 10, 'tool_use'),
      assistant('msg_B', 5),
      assistant('msg_C', 7),
      assistant('msg_C', 9),
      { type: 'last-prompt', lastPrompt: SECRET_PROMPT, sessionId: SID },
      '{not json',
    ]),
  );
  writeFileSync(
    join(projDir, SID, 'subagents', 'agent-x1.jsonl'),
    jsonl([{ ...assistant('msg_D', 4), isSidechain: true, agentId: 'x1' }]),
  );
  writeFileSync(join(projDir, SID, 'subagents', 'agent-x1.meta.json'), JSON.stringify({ agentType: 'Explore' }));
  const globalConfig = join(root, 'claude.json');
  writeFileSync(
    globalConfig,
    JSON.stringify({
      numStartups: 3,
      projects: { [SECRET_CWD]: {} },
      oauthAccount: { accountUuid: 'u-1', emailAddress: SECRET_EMAIL, displayName: 'Secret Person' },
    }),
  );
  return { root, data, projDir, globalConfig };
}

function runProbe(f, extra = [], env = {}) {
  const out = join(f.root, `report-${Math.random().toString(36).slice(2)}.json`);
  execFileSync(process.execPath, [PROBE, '--dir', f.data, '--global-config', f.globalConfig, '--out', out, ...extra], {
    env: { ...process.env, CLAUDE_CONFIG_DIR: '', ...env },
  });
  return { out, text: readFileSync(out, 'utf8'), report: JSON.parse(readFileSync(out, 'utf8')) };
}

test('report is structure-only: no prompt text, emails, paths, branches or names', () => {
  const f = makeFixture();
  const { text } = runProbe(f);
  for (const secret of [SECRET_PROMPT, SECRET_EMAIL, 'secretuser', 'secret-proj', 'secret-branch', 'Secret Person', '@']) {
    assert.ok(!text.includes(secret), `report leaked ${secret}`);
  }
  assert.ok(!text.includes(f.root), 'report leaked the temp path');
});

test('counts main and subagent transcript files and malformed lines', () => {
  const { report } = runProbe(makeFixture());
  assert.equal(report.files.transcripts, 2);
  assert.equal(report.files.subagentTranscripts, 1);
  assert.equal(report.files.subagentMetaFiles, 1);
  assert.equal(report.lines.malformed, 1);
});

test('builds a per-type key census with JSON types and presence percent', () => {
  const { report } = runProbe(makeFixture());
  const a = report.lineTypes.assistant;
  assert.equal(a.count, 7);
  assert.deepEqual(a.keys['message.usage.output_tokens'], { types: ['number'], presencePct: 100 });
  assert.deepEqual(a.keys['message.id'], { types: ['string'], presencePct: 100 });
  assert.equal(report.lineTypes['last-prompt'].count, 1);
  assert.deepEqual(report.usageKeys.cache_read_input_tokens.types, ['number']);
});

test('reports message.id split statistics and which usage fields differ', () => {
  const { report } = runProbe(makeFixture());
  const d = report.dedup;
  assert.equal(d.assistantLinesWithUsage, 7);
  assert.equal(d.distinctMessageIds, 4);
  assert.equal(d.splitMessageIds, 2);
  assert.equal(d.splitIdenticalUsage, 1);
  assert.deepEqual(d.differingFields, { output_tokens: 1 });
  assert.equal(d.nonDecreasingWhenDiffering, 1);
  assert.equal(d.idsAcrossMultipleFiles, 0);
});

test('reports sessions spanning several files and filename/sessionId agreement', () => {
  const { report } = runProbe(makeFixture());
  assert.equal(report.sessions.distinctSessionIds, 1);
  assert.equal(report.sessions.withMultipleFiles, 1);
  assert.equal(report.sessions.mainFileNameMatchesSessionIdPct, 100);
});

test('reports shape-only timestamps and safe enum values', () => {
  const { report } = runProbe(makeFixture());
  assert.deepEqual(Object.keys(report.timestampShapes), ['dddd-dd-ddTdd:dd:dd.dddZ']);
  assert.deepEqual(report.enums.version, { '2.1.274': 8 });
  assert.deepEqual(report.enums.entrypoint, { cli: 8 });
  assert.equal(report.enums['message.model']['claude-sonnet-5'], 7);
});

test('checks project dir-name encoding against cwd without printing either', () => {
  const { report } = runProbe(makeFixture());
  assert.equal(report.projectDirEncoding.dirsChecked, 1);
  assert.equal(report.projectDirEncoding.matchesNonAlnumToDash, 1);
});

test('reports global config top-level and oauthAccount key names only', () => {
  const { report } = runProbe(makeFixture());
  assert.deepEqual(report.globalConfig.oauthAccountKeys, ['accountUuid', 'emailAddress', 'displayName']);
  assert.ok(report.globalConfig.topLevelKeys.includes('numStartups'));
});

test('compare mode detects append-only growth with a stable inode', () => {
  const f = makeFixture();
  const first = runProbe(f);
  appendFileSync(join(f.projDir, `${SID}.jsonl`), JSON.stringify(assistant('msg_E', 1)) + '\n');
  const { report } = runProbe(f, ['--compare', first.out]);
  assert.equal(report.appendCheck.grewAppendOnly, 1);
  assert.equal(report.appendCheck.rewritten, 0);
  assert.equal(report.appendCheck.identityChanged, 0);
  assert.equal(report.appendCheck.unchanged, 1);
});

test('compare mode detects a rewritten file', () => {
  const f = makeFixture();
  const first = runProbe(f);
  const p = join(f.projDir, SID, 'subagents', 'agent-x1.jsonl');
  const body = readFileSync(p, 'utf8');
  writeFileSync(p, body.replace('"x1"', '"x9"') + body);
  const { report } = runProbe(f, ['--compare', first.out]);
  assert.equal(report.appendCheck.rewritten, 1);
});

test('labels candidate data dirs symbolically', () => {
  const { report } = runProbe(makeFixture());
  const labels = report.candidates.map((c) => c.label);
  assert.ok(labels.includes('--dir'));
  assert.ok(labels.includes('$HOME/.claude'));
  assert.ok(report.candidates.every((c) => typeof c.exists === 'boolean'));
});

// ---------------------------------------------------------------- review fixes

const SID2 = '22222222-2222-4222-8222-222222222222';

// Fixture whose data hides secrets in map keys, enum values, file names and config keys.
function makeLeakyFixture() {
  const f = makeFixture();
  writeFileSync(join(f.data, 'secretfile-zq.txt'), 'x');
  writeFileSync(
    f.globalConfig,
    JSON.stringify({ numStartups: 1, 'secret-key-zq': 1, oauthAccount: { accountUuid: 'u-1' } }),
  );
  writeFileSync(
    join(f.projDir, `${SID2}.jsonl`),
    jsonl([
      base({
        sessionId: SID2,
        type: 'user',
        entrypoint: 'secret-proj',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] },
        toolUseResult: { secretkeyone: { secretkeytwo: 1 } },
        mcpMeta: { structuredContent: { secretkeythree: 'v' } },
        wireToolInputs: { secretkeyfour: { a: 1 } },
      }),
    ]),
  );
  return f;
}

test('never leaks map keys, derived enum values, data-dir names or odd config keys', () => {
  const f = makeLeakyFixture();
  const { text, report } = runProbe(f);
  for (const secret of ['secretkeyone', 'secretkeytwo', 'secretkeythree', 'secretkeyfour', 'secretfile', 'secret-key-zq', 'secret-proj']) {
    assert.ok(!text.includes(secret), `report leaked ${secret}`);
  }
  assert.equal(report.enums.entrypoint['<redacted>'], 1);
  assert.equal(report.dataDirEntries.unlistedEntries, 1);
  assert.ok(report.dataDirEntries.listed.some((e) => e.name === 'projects'));
  assert.equal(report.globalConfig.unlistedKeys, 1);
  assert.deepEqual(report.lineTypes.user.keys.toolUseResult, { types: ['object'], presencePct: 50 });
  assert.ok(report.lineTypes.assistant.keys['message.usage.output_tokens']);
});

// Fixture exercising the extra dedup and prompt-exclusion counters.
function makeCounterFixture() {
  const f = makeFixture();
  const withStop = (id, out, stop) => {
    const a = assistant(id, out);
    a.message.stop_reason = stop;
    return a;
  };
  const zero = assistant('msg_Z', 0);
  zero.message.usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const synth = assistant('33333333-3333-4333-8333-333333333333', 0);
  synth.message.model = '<synthetic>';
  delete synth.requestId;
  const user = (content, extra = {}) => base({ type: 'user', message: { role: 'user', content }, ...extra });
  writeFileSync(
    join(f.projDir, `${SID2}.jsonl`),
    jsonl(
      [
        withStop('msg_S', 1, null),
        withStop('msg_S', 2, null),
        withStop('msg_S', 3, 'end_turn'),
        assistant('msg_Z', 5),
        zero,
        synth,
        user('<command-name>/x</command-name>'),
        user('  <weird-tag>x</weird-tag>'),
        user('plain text', { isMeta: true, promptSource: 'typed', origin: { kind: 'human' } }),
        user('summary', { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
        { type: 'queue-operation', operation: 'enqueue', content: 'queued', sessionId: SID2 },
        { type: 'system', subtype: 'informational', content: 'sys', sessionId: SID2 },
      ].map((r) => (typeof r === 'string' ? r : { ...r, sessionId: SID2 })),
    ),
  );
  return f;
}

test('reports message-id shapes, missing requestIds, stop_reason and zero-trailing splits', () => {
  const { report } = runProbe(makeCounterFixture());
  const d = report.dedup;
  assert.deepEqual(d.messageIdShapes, { api: { msg_: 6, uuid: 0, other: 0 }, synthetic: { msg_: 0, uuid: 1, other: 0 } });
  assert.deepEqual(d.requestIdMissing, { synthetic: 1, nonSynthetic: 0 });
  assert.equal(d.splitStopReasonOnlyOnLast, 1);
  assert.equal(d.splitStopReasonOnlyOnLastAll, 1);
  assert.equal(d.zeroTrailingLineIds, 1);
});

test('reports prompt-exclusion evidence for user lines', () => {
  const { report } = runProbe(makeCounterFixture());
  const u = report.userLines;
  assert.equal(u.isCompactSummary, 1);
  assert.equal(u.isVisibleInTranscriptOnly, 1);
  assert.equal(u.isMeta, 1);
  assert.deepEqual(u.promptSource, { typed: 1 });
  assert.deepEqual(u.originKind, { human: 1 });
  assert.deepEqual(u.leadingTag, { 'command-name': 1, '<other-tag>': 1, none: 3 });
  assert.equal(u.queueOperationStringContent, 1);
  assert.equal(u.systemStringContent, 1);
});

test('compare mode: same-size middle edit is rewritten', () => {
  const f = makeFixture();
  const first = runProbe(f);
  const p = join(f.projDir, `${SID}.jsonl`);
  const body = readFileSync(p, 'utf8');
  writeFileSync(p, body.replace('"msg_B"', '"msg_Q"'));
  const { report } = runProbe(f, ['--compare', first.out]);
  assert.equal(report.appendCheck.rewritten, 1);
  assert.equal(report.appendCheck.grewAppendOnly, 0);
});

test('compare mode: truncation is shrank', () => {
  const f = makeFixture();
  const first = runProbe(f);
  truncateSync(join(f.projDir, `${SID}.jsonl`), 10);
  const { report } = runProbe(f, ['--compare', first.out]);
  assert.equal(report.appendCheck.shrank, 1);
  assert.equal(report.appendCheck.rewritten, 0);
});

test('compare mode: replacing the file (new inode) is identityChanged', { skip: process.platform === 'win32' }, () => {
  const f = makeFixture();
  const first = runProbe(f);
  const p = join(f.projDir, `${SID}.jsonl`);
  writeFileSync(p + '.tmp', readFileSync(p));
  renameSync(p + '.tmp', p);
  const { report } = runProbe(f, ['--compare', first.out]);
  assert.equal(report.appendCheck.identityChanged, 1);
  assert.equal(report.appendCheck.unchanged, 1);
});

test('snapshot stores a full-file hash', () => {
  const { report } = runProbe(makeFixture());
  for (const s of Object.values(report.fileSnapshot)) assert.match(s.full, /^[0-9a-f]{16}$/);
});

test('worker-thread path gives the same results as the inline path', () => {
  const f = makeCounterFixture();
  const inline = runProbe(f).report;
  const workers = runProbe(f, [], { PROBE_INLINE_BYTES: '0' }).report;
  assert.equal(inline.meta.scanMode, 'inline');
  assert.match(workers.meta.scanMode, /^workers:[2-8]$/);
  assert.deepEqual(workers.dedup, inline.dedup);
  assert.deepEqual(workers.lineTypes, inline.lineTypes);
  assert.deepEqual(workers.sessions, inline.sessions);
});

test('counts unreadable transcripts by error code', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const f = makeFixture();
  chmodSync(join(f.projDir, SID, 'subagents', 'agent-x1.jsonl'), 0o000);
  const { report } = runProbe(f);
  assert.deepEqual(report.files.unreadable, { EACCES: 1 });
});

test('counts and skips symlinked transcripts', { skip: process.platform === 'win32' }, () => {
  const f = makeFixture();
  symlinkSync(join(f.projDir, `${SID}.jsonl`), join(f.projDir, 'link.jsonl'));
  const { report } = runProbe(f);
  assert.equal(report.files.symlinksSkipped, 1);
  assert.equal(report.files.transcripts, 2);
});
