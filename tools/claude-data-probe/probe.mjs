#!/usr/bin/env node
// Privacy-safe structure probe for Claude Code's local data directory.
//
// Prints STRUCTURE AND STATISTICS ONLY: allowlisted key names, JSON types, counts,
// strictly validated enum values and hashes. It never outputs prompt text, paths,
// emails, hostnames, branch names, cwd values, display names or project directory
// names, and refuses to write a report that contains any of them (backstop guard).
//
// Usage: node probe.mjs [--dir <claudeDataDir>] [--global-config <.claude.json>]
//                       [--out report.json] [--compare <previous report.json>]
// Env:   PROBE_INLINE_BYTES=<n>  total transcript bytes below which no worker threads are used.
// Tests: node --test tools/claude-data-probe/probe.test.mjs
// Zero dependencies (node: built-ins only), ESM, Node >= 18, macOS/Windows/Linux.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const PROBE_VERSION = '1.1.0';
const KEY_RE = /^[A-Za-z_$][A-Za-z0-9_$-]{0,63}$/;
// Keys that look like generated ids (tool-use ids, many digits) are data, not schema.
const ID_LIKE_RE = /^[A-Za-z]{2,10}_[A-Za-z0-9]{12,}$|(?:\d\D*){6,}/;
const CONFIG_KEY_RE = /^[a-z][A-Za-z0-9]{0,63}$/;
const TS_SHAPE_RE = /^[dTZ:.+\- ]{1,40}$/;
const EXT_RE = /^\.[A-Za-z0-9]{1,10}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const END_MARKER_RE = /end|exit|close|stop|summary/i;
const MAX_DEPTH = 3; // max path segments in the per-type key census
const MAP_THRESHOLD = 40; // allowlisted objects with more keys are treated as maps
const ENUM_CAP = 40; // distinct values reported per enum path
const ENUM_HARD_CAP = 5000; // distinct values tracked per enum path before folding into '<other>'
const HISTORY_LINES = 500;
const TOKEN_FIELDS = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const COMMON_BRANCHES = new Set(['main', 'master', 'develop', 'dev', 'trunk']);

// Below this many transcript bytes, scan inline instead of spawning workers.
const INLINE_BYTES = (() => {
  const n = Number(process.env.PROBE_INLINE_BYTES);
  return process.env.PROBE_INLINE_BYTES !== undefined && process.env.PROBE_INLINE_BYTES !== '' && Number.isFinite(n)
    ? n
    : 64 * 1024 * 1024;
})();

// Only these object paths are descended in the key census; every other nested value
// is recorded with its JSON type only (tool results, MCP payloads, snapshots, maps...).
const SCHEMA_PARENTS = new Set([
  'message',
  'message.usage',
  'message.usage.cache_creation',
  'message.usage.server_tool_use',
  'message.usage.output_tokens_details',
  'message.context_management',
  'message.diagnostics',
  'attachment',
  'error',
  'compactMetadata',
  'origin',
  'commandRun',
]);
const USAGE_PARENTS = new Set(['cache_creation', 'server_tool_use', 'output_tokens_details']);

// Strict per-field value patterns for enums.
const LOWER = /^[a-z][a-z0-9_-]{0,40}$/;
const CAMEL = /^[a-z][A-Za-z0-9_-]{0,40}$/;
const BOOL = /^(true|false)$/;
const VERSION = /^\d+\.\d+\.\d+([.-][0-9A-Za-z.]+)?$/;
const MODEL = /^(claude-[a-z0-9.-]{1,60}|<synthetic>)$/;
const LINE_ENUMS = [
  ['type', LOWER],
  ['version', VERSION],
  ['entrypoint', LOWER],
  ['userType', LOWER],
  ['message.model', MODEL],
  ['message.role', LOWER],
  ['message.stop_reason', LOWER],
  ['subtype', LOWER],
  ['operation', LOWER],
  ['isSidechain', BOOL],
  ['isMeta', BOOL],
  ['permissionMode', CAMEL],
  ['level', LOWER],
].map(([p, re]) => [p, p.split('.'), re]);

// Leading tags of string user content that mark non-prompt (command/hook/system) text.
const KNOWN_TAGS = new Set([
  'command-name',
  'command-message',
  'command-args',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'bash-input',
  'bash-stdout',
  'bash-stderr',
  'task-notification',
  'system-reminder',
  'user-prompt-submit-hook',
]);

// Top-level data-dir entries whose names may be printed.
const KNOWN_DATA_ENTRIES = new Set([
  'projects',
  'sessions',
  'history.jsonl',
  'settings.json',
  'settings.local.json',
  'plugins',
  'cache',
  'backups',
  'chrome',
  'commands',
  'downloads',
  'file-history',
  'ide',
  'paste-cache',
  'plans',
  'session-env',
  'shell-snapshots',
  'skills',
  'state',
  'tasks',
  'telemetry',
  'todos',
  'statsig',
  'logs',
  'agents',
  '.credentials.json',
  '.last-cleanup',
  '.last-update-result.json',
  'mcp-needs-auth-cache.json',
]);

// ---------------------------------------------------------------- helpers

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v);
const safeKey = (k) => (KEY_RE.test(k) && !ID_LIKE_RE.test(k) ? k : '<dynamic>');
const sha16 = (data) => createHash('sha256').update(data).digest('hex').slice(0, 16);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const inc = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);
const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || '';

// Sanitised enum value: must match the field's pattern, else '<redacted>'.
function enumValue(v, re) {
  if (v === undefined) return '<none>';
  if (v === null || typeof v === 'object') return `<${jsonType(v)}>`;
  const s = String(v);
  if (s === '') return '<empty>';
  return re.test(s) ? s : '<redacted>';
}

function getPath(obj, segs) {
  let cur = obj;
  for (const s of segs) {
    if (!isObj(cur) || !(s in cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}

function countEnum(acc, p, value, re) {
  let m = acc.enums.get(p);
  if (!m) acc.enums.set(p, (m = new Map()));
  const v = enumValue(value, re);
  if (!m.has(v) && m.size >= ENUM_HARD_CAP) inc(m, '<other>');
  else inc(m, v);
}

// Record a path/type in a census map, counting each path at most once per line.
function record(map, p, t, lineNo) {
  let e = map.get(p);
  if (!e) map.set(p, (e = { count: 0, types: new Set(), last: -1 }));
  if (e.last !== lineNo) {
    e.count++;
    e.last = lineNo;
  }
  e.types.add(t);
  return e;
}

// Flatten into dotted key paths with JSON types, descending only into SCHEMA_PARENTS.
function census(obj, prefix, depth, map, lineNo) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? `${prefix}.${safeKey(k)}` : safeKey(k);
    let t = jsonType(v);
    if (t === 'object' && Object.keys(v).length > MAP_THRESHOLD) t = '<map>';
    record(map, p, t, lineNo);
    if (t === 'object' && depth < MAX_DEPTH && SCHEMA_PARENTS.has(p)) census(v, p, depth + 1, map, lineNo);
  }
}

// Flatten message.usage (known sub-objects only) into leaves and feed the usage census.
function flattenUsage(acc, u, prefix, out, lineNo) {
  for (const k of Object.keys(u)) {
    const v = u[k];
    const p = prefix ? `${prefix}.${safeKey(k)}` : safeKey(k);
    const t = jsonType(v);
    const e = record(acc.usage.keys, p, t, lineNo);
    if (t === 'number') {
      e.min = e.min === undefined ? v : Math.min(e.min, v);
      e.max = e.max === undefined ? v : Math.max(e.max, v);
      if (v < 0) {
        e.negative = (e.negative || 0) + 1;
        acc.usage.negativeValues++;
      }
    }
    if (t === 'object' && !prefix && USAGE_PARENTS.has(k) && Object.keys(v).length <= MAP_THRESHOLD) {
      flattenUsage(acc, v, p, out, lineNo);
    } else {
      out[p] = v;
    }
  }
}

function leadingTag(content) {
  const t = content.trimStart();
  if (t[0] !== '<') return 'none';
  const m = /^<([a-z][a-z0-9-]{0,40})(?=[\s>/])/.exec(t);
  return m && KNOWN_TAGS.has(m[1]) ? m[1] : '<other-tag>';
}

// ---------------------------------------------------------------- accumulator

function newAcc() {
  return {
    lineNo: 0,
    lines: { total: 0, blank: 0, malformed: 0, nonObject: 0, maxLineBytes: 0, outOfOrderTimestamps: 0, withoutTimestamp: 0 },
    lineTypes: new Map(), // type -> { count, keys: Map(path -> census entry) }
    usage: { lines: 0, nonAssistant: 0, negativeValues: 0, keys: new Map() },
    enums: new Map(), // path -> Map(value -> count)
    tsShapes: new Map(),
    assistantUsageLines: 0,
    missingMessageId: 0,
    requestIdMissing: { synthetic: 0, nonSynthetic: 0 },
    ids: new Map(), // message.id -> { entries: [{ f, u, stop }], files, sessions, reqs, models }
    sessions: new Map(), // sessionId -> { files, cwds, models, branches, versions }
    sidechain: { main: new Map(), subagent: new Map(), other: new Map() },
    userLines: {
      total: 0,
      isCompactSummary: 0,
      isVisibleInTranscriptOnly: 0,
      isMeta: 0,
      isSidechain: 0,
      stringContent: 0,
      leadingTag: new Map(),
      queueOperationStringContent: 0,
      systemStringContent: 0,
    },
    // Values that must never appear in the report (kept in memory only).
    sensitive: { cwds: new Set(), branches: new Set() },
    unreadable: new Map(),
    perFile: [],
  };
}

function scanFile(acc, fi, prev) {
  const st = fs.statSync(fi.abs, { bigint: true });
  const buf = fs.readFileSync(fi.abs);
  const size = buf.length;
  const pf = {
    idx: fi.idx,
    key: fi.key,
    kind: fi.kind,
    projectDir: fi.projectDir,
    size,
    ino: st.ino.toString(),
    mtimeMs: Number(st.mtimeNs) / 1e6,
    full: sha16(buf),
    endsWithNewline: size === 0 || buf[size - 1] === 10,
    lastType: null,
    sidLines: 0,
    sidMismatch: 0,
    cwds: fi.kind === 'main' ? new Set() : null,
    // For --compare: hash of the bytes the previous snapshot covered.
    prevPrefix: prev && size > prev.size ? sha16(buf.subarray(0, prev.size)) : null,
  };

  const ctx = { prevTs: NaN };
  let pos = 0;
  while (pos < size) {
    let end = buf.indexOf(10, pos);
    if (end === -1) end = size;
    const len = end - pos;
    acc.lines.total++;
    if (len > acc.lines.maxLineBytes) acc.lines.maxLineBytes = len;
    const text = buf.toString('utf8', pos, end);
    pos = end + 1;
    if (text.trim() === '') {
      acc.lines.blank++;
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(text);
    } catch {
      acc.lines.malformed++;
      continue;
    }
    if (!isObj(obj)) {
      acc.lines.nonObject++;
      continue;
    }
    analyzeLine(acc, obj, fi, pf, ctx);
  }
  acc.perFile.push(pf);
}

function analyzeLine(acc, obj, fi, pf, ctx) {
  const lineNo = ++acc.lineNo;
  const type = enumValue(obj.type, LOWER);
  pf.lastType = type;

  let lt = acc.lineTypes.get(type);
  if (!lt) acc.lineTypes.set(type, (lt = { count: 0, keys: new Map() }));
  lt.count++;
  census(obj, '', 1, lt.keys, lineNo);

  // Allowlisted enums.
  for (const [p, segs, re] of LINE_ENUMS) {
    const v = getPath(obj, segs);
    if (v !== undefined) countEnum(acc, p, v, re);
  }
  const msg = isObj(obj.message) ? obj.message : null;
  if (msg && Array.isArray(msg.content)) {
    for (const part of msg.content) if (isObj(part)) countEnum(acc, 'message.content[].type', part.type, LOWER);
  }

  // User-line evidence for prompt exclusion rules.
  if (obj.type === 'user') {
    const u = acc.userLines;
    u.total++;
    if (obj.isCompactSummary === true) u.isCompactSummary++;
    if (obj.isVisibleInTranscriptOnly === true) u.isVisibleInTranscriptOnly++;
    if (obj.isMeta === true) u.isMeta++;
    if (obj.isSidechain === true) u.isSidechain++;
    if ('promptSource' in obj) countEnum(acc, 'user:promptSource', obj.promptSource, LOWER);
    if (isObj(obj.origin) && 'kind' in obj.origin) countEnum(acc, 'user:origin.kind', obj.origin.kind, LOWER);
    if (msg && 'content' in msg) {
      countEnum(acc, 'user:message.content(kind)', jsonType(msg.content), LOWER);
      if (typeof msg.content === 'string') {
        u.stringContent++;
        inc(u.leadingTag, leadingTag(msg.content));
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) if (isObj(part)) countEnum(acc, 'user:message.content[].type', part.type, LOWER);
      }
    }
  } else if (obj.type === 'queue-operation' && typeof obj.content === 'string') {
    acc.userLines.queueOperationStringContent++;
  } else if (obj.type === 'system' && typeof obj.content === 'string') {
    acc.userLines.systemStringContent++;
  }

  // Timestamp shape and ordering.
  if ('timestamp' in obj) {
    const ts = obj.timestamp;
    let shape = `<${jsonType(ts)}>`;
    if (typeof ts === 'string') {
      shape = ts.replace(/\d/g, 'd');
      if (!TS_SHAPE_RE.test(shape)) shape = '<other>';
      const t = Date.parse(ts);
      if (!Number.isNaN(t)) {
        if (t < ctx.prevTs) acc.lines.outOfOrderTimestamps++;
        ctx.prevTs = t;
      }
    }
    inc(acc.tsShapes, shape);
  } else {
    acc.lines.withoutTimestamp++;
  }

  // Usage census and message.id dedup data.
  const sid = typeof obj.sessionId === 'string' ? obj.sessionId : null;
  const model = msg && typeof msg.model === 'string' ? msg.model : null;
  if (msg && isObj(msg.usage)) {
    acc.usage.lines++;
    if (obj.type !== 'assistant') acc.usage.nonAssistant++;
    const flat = {};
    flattenUsage(acc, msg.usage, '', flat, lineNo);
    if (obj.type === 'assistant') {
      acc.assistantUsageLines++;
      if (typeof obj.requestId !== 'string') acc.requestIdMissing[model === '<synthetic>' ? 'synthetic' : 'nonSynthetic']++;
      if (typeof msg.id === 'string') {
        let e = acc.ids.get(msg.id);
        if (!e) {
          e = { entries: [], files: new Set(), sessions: new Set(), reqs: new Set(), models: new Set() };
          acc.ids.set(msg.id, e);
        }
        e.entries.push({ f: fi.idx, u: flat, stop: msg.stop_reason });
        e.files.add(fi.idx);
        if (sid) e.sessions.add(sid);
        if (typeof obj.requestId === 'string') e.reqs.add(obj.requestId);
        if (model) e.models.add(model);
      } else {
        acc.missingMessageId++;
      }
    }
  }

  // Session bookkeeping (values stay in memory; only counts are reported).
  const cwd = typeof obj.cwd === 'string' ? obj.cwd : null;
  const branch = typeof obj.gitBranch === 'string' ? obj.gitBranch : null;
  if (cwd) acc.sensitive.cwds.add(cwd);
  if (branch) acc.sensitive.branches.add(branch);
  if (sid) {
    let s = acc.sessions.get(sid);
    if (!s) {
      s = { files: new Set(), cwds: new Set(), models: new Set(), branches: new Set(), versions: new Set() };
      acc.sessions.set(sid, s);
    }
    s.files.add(fi.idx);
    if (cwd) s.cwds.add(cwd);
    if (model) s.models.add(model);
    if (branch) s.branches.add(branch);
    if (typeof obj.version === 'string') s.versions.add(obj.version);
    if (fi.expectedSid !== null) {
      pf.sidLines++;
      if (sid !== fi.expectedSid) pf.sidMismatch++;
    }
  }
  if (pf.cwds && cwd) pf.cwds.add(cwd);
  inc(acc.sidechain[fi.kind], 'isSidechain' in obj ? enumValue(obj.isSidechain, BOOL) : '<none>');
}

function mergeCensus(dst, src) {
  for (const [p, e] of src) {
    const d = dst.get(p);
    if (!d) {
      dst.set(p, e);
      continue;
    }
    d.count += e.count;
    for (const t of e.types) d.types.add(t);
    if (e.min !== undefined) d.min = d.min === undefined ? e.min : Math.min(d.min, e.min);
    if (e.max !== undefined) d.max = d.max === undefined ? e.max : Math.max(d.max, e.max);
    if (e.negative) d.negative = (d.negative || 0) + e.negative;
  }
}

function addNumbers(dst, src) {
  for (const k of Object.keys(dst)) {
    if (typeof dst[k] === 'number') dst[k] = k === 'maxLineBytes' ? Math.max(dst[k], src[k]) : dst[k] + src[k];
  }
}

const unionInto = (d, s) => {
  for (const k of Object.keys(s)) if (s[k] instanceof Set) for (const v of s[k]) d[k].add(v);
};

// Merge a worker's accumulator into the main one.
function mergeAcc(a, b) {
  addNumbers(a.lines, b.lines);
  for (const [t, lt] of b.lineTypes) {
    const d = a.lineTypes.get(t);
    if (!d) a.lineTypes.set(t, lt);
    else {
      d.count += lt.count;
      mergeCensus(d.keys, lt.keys);
    }
  }
  addNumbers(a.usage, b.usage);
  mergeCensus(a.usage.keys, b.usage.keys);
  for (const [p, m] of b.enums) {
    let d = a.enums.get(p);
    if (!d) a.enums.set(p, (d = new Map()));
    for (const [v, c] of m) inc(d, v, c);
  }
  for (const [s, c] of b.tsShapes) inc(a.tsShapes, s, c);
  a.assistantUsageLines += b.assistantUsageLines;
  a.missingMessageId += b.missingMessageId;
  addNumbers(a.requestIdMissing, b.requestIdMissing);
  for (const [id, e] of b.ids) {
    const d = a.ids.get(id);
    if (!d) a.ids.set(id, e);
    else {
      d.entries.push(...e.entries);
      unionInto(d, e);
    }
  }
  for (const [sid, s] of b.sessions) {
    const d = a.sessions.get(sid);
    if (!d) a.sessions.set(sid, s);
    else unionInto(d, s);
  }
  for (const kind of Object.keys(a.sidechain)) for (const [v, c] of b.sidechain[kind]) inc(a.sidechain[kind], v, c);
  addNumbers(a.userLines, b.userLines);
  for (const [v, c] of b.userLines.leadingTag) inc(a.userLines.leadingTag, v, c);
  unionInto(a.sensitive, b.sensitive);
  for (const [v, c] of b.unreadable) inc(a.unreadable, v, c);
  a.perFile.push(...b.perFile);
}

// Scan a list of files, counting read errors (EACCES, too large, vanished...) by code.
function scanFiles(acc, files, prev) {
  for (const fi of files) {
    try {
      scanFile(acc, fi, prev[fi.key]);
    } catch (err) {
      inc(acc.unreadable, (err && (err.code || err.name)) || 'error');
    }
  }
}

// ---------------------------------------------------------------- worker entry

if (!isMainThread && workerData && workerData.probeWorker) {
  const acc = newAcc();
  scanFiles(acc, workerData.files, workerData.prev);
  parentPort.postMessage(acc);
}

// ---------------------------------------------------------------- discovery

function parseArgs(argv) {
  const opts = { dir: null, globalConfig: null, out: null, compare: null };
  const flags = { '--dir': 'dir', '--global-config': 'globalConfig', '--out': 'out', '--compare': 'compare' };
  for (let i = 0; i < argv.length; i++) {
    const name = flags[argv[i]];
    if (!name || i + 1 >= argv.length) {
      process.stderr.write(
        'Usage: node probe.mjs [--dir <claudeDataDir>] [--global-config <path>] [--out report.json] [--compare prev.json]\n',
      );
      process.exit(1);
    }
    opts[name] = argv[++i];
  }
  return opts;
}

function tryStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function candidateDirs(opts) {
  const home = os.homedir();
  const env = process.env;
  const list = [];
  if (opts.dir) list.push(['--dir', path.resolve(opts.dir)]);
  if (env.CLAUDE_CONFIG_DIR) list.push(['$CLAUDE_CONFIG_DIR', path.resolve(env.CLAUDE_CONFIG_DIR)]);
  list.push(['$HOME/.claude', path.join(home, '.claude')]);
  if (env.XDG_CONFIG_HOME) list.push(['$XDG_CONFIG_HOME/claude', path.join(env.XDG_CONFIG_HOME, 'claude')]);
  list.push(['$HOME/.config/claude', path.join(home, '.config', 'claude')]);
  if (process.platform === 'win32') {
    if (env.APPDATA) list.push(['%APPDATA%\\claude', path.join(env.APPDATA, 'claude')]);
    if (env.LOCALAPPDATA) list.push(['%LOCALAPPDATA%\\claude', path.join(env.LOCALAPPDATA, 'claude')]);
  }
  const posix = process.platform !== 'win32';
  return list.map(([label, abs]) => {
    const st = tryStat(abs);
    let readable = false;
    if (st) {
      try {
        fs.accessSync(abs, fs.constants.R_OK);
        readable = true;
      } catch {
        readable = false;
      }
    }
    const projects = st && tryStat(path.join(abs, 'projects'));
    return {
      label,
      abs,
      exists: !!st,
      readable,
      hasProjectsDir: !!(projects && projects.isDirectory()),
      mode: st && posix ? (st.mode & 0o777).toString(8).padStart(3, '0') : null,
      ownedByCurrentUser: st && posix && process.getuid ? st.uid === process.getuid() : null,
    };
  });
}

// Walk <dataDir>/projects and classify every entry.
function discover(dataDir) {
  const found = {
    projectDirs: [],
    transcripts: [],
    metaFiles: [],
    toolResultDirs: 0,
    symlinksSkipped: 0,
    otherByExt: new Map(),
  };
  const walk = (dir, parts) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = [...parts, ent.name];
      if (ent.isSymbolicLink()) {
        if (ent.name.endsWith('.jsonl')) found.symlinksSkipped++;
      } else if (ent.isDirectory()) {
        if (rel.length === 1) found.projectDirs.push(ent.name);
        if (ent.name === 'tool-results') found.toolResultDirs++;
        walk(abs, rel);
      } else if (ent.isFile()) {
        const parent = parts[parts.length - 1];
        if (ent.name.endsWith('.jsonl')) {
          let kind = 'other';
          let expectedSid = null;
          if (rel.length === 2) {
            kind = 'main';
            expectedSid = ent.name.slice(0, -'.jsonl'.length);
          } else if (parent === 'subagents') {
            kind = 'subagent';
            expectedSid = rel.length >= 4 ? rel[rel.length - 3] : null;
          }
          found.transcripts.push({
            abs,
            key: sha16(['projects', ...rel].join('/')),
            kind,
            projectDir: rel[0],
            expectedSid,
            size: 0,
          });
        } else if (parent === 'subagents' && ent.name.endsWith('.meta.json')) {
          found.metaFiles.push(abs);
        } else {
          const ext = path.extname(ent.name);
          inc(found.otherByExt, ext === '' ? '<none>' : EXT_RE.test(ext) ? ext.toLowerCase() : '<other>');
        }
      }
    }
  };
  walk(path.join(dataDir, 'projects'), []);
  found.transcripts.forEach((fi, idx) => {
    fi.idx = idx;
    fi.size = tryStat(fi.abs)?.size ?? 0;
  });
  return found;
}

// ---------------------------------------------------------------- scanning

function runWorker(files, prev) {
  return new Promise((resolve, reject) => {
    const subPrev = {};
    for (const fi of files) if (prev[fi.key]) subPrev[fi.key] = prev[fi.key];
    const w = new Worker(new URL(import.meta.url), { workerData: { probeWorker: true, files, prev: subPrev } });
    let result = null;
    w.once('message', (m) => {
      result = m;
    });
    w.once('error', reject);
    // A worker that dies without posting a result must not hang the probe.
    w.once('exit', (code) => (result && code === 0 ? resolve(result) : reject(new Error(`worker exit ${code}`))));
  });
}

async function scanAll(transcripts, prev) {
  const total = transcripts.reduce((s, f) => s + f.size, 0);
  const cpus = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  const n = Math.max(1, Math.min(8, Math.max(2, cpus - 1), transcripts.length));
  const acc = newAcc();
  if (total < INLINE_BYTES || n === 1) {
    acc.scanMode = 'inline';
    scanFiles(acc, transcripts, prev);
  } else {
    acc.scanMode = `workers:${n}`;
    // Greedy size-balanced buckets, one worker each.
    const buckets = Array.from({ length: n }, () => ({ bytes: 0, files: [] }));
    for (const fi of [...transcripts].sort((x, y) => y.size - x.size)) {
      const b = buckets.reduce((m, c) => (c.bytes < m.bytes ? c : m));
      b.bytes += fi.size;
      b.files.push(fi);
    }
    const parts = await Promise.all(buckets.map((b) => runWorker(b.files, prev)));
    for (const p of parts) mergeAcc(acc, p);
  }
  acc.perFile.sort((x, y) => x.idx - y.idx);
  return acc;
}

// ---------------------------------------------------------------- redaction

// Values that may pass an enum pattern yet identify the user, machine or project.
function blockedEnumValues(acc) {
  const blocked = new Set();
  const add = (s) => s && blocked.add(s.toLowerCase());
  add(os.userInfo().username);
  add(os.hostname());
  add(os.hostname().split('.')[0]);
  for (const c of acc.sensitive.cwds) add(baseName(c));
  for (const b of acc.sensitive.branches) add(b);
  return blocked;
}

// Fold any blocked enum values / line-type names into '<redacted>'.
function redactAcc(acc, blocked) {
  const isBlocked = (v) => blocked.has(v.toLowerCase());
  for (const [p, m] of acc.enums) {
    const out = new Map();
    for (const [v, c] of m) inc(out, isBlocked(v) ? '<redacted>' : v, c);
    acc.enums.set(p, out);
  }
  for (const [t, lt] of [...acc.lineTypes]) {
    if (!isBlocked(t)) continue;
    acc.lineTypes.delete(t);
    const d = acc.lineTypes.get('<redacted>');
    if (!d) acc.lineTypes.set('<redacted>', lt);
    else {
      d.count += lt.count;
      mergeCensus(d.keys, lt.keys);
    }
  }
  for (const pf of acc.perFile) if (pf.lastType && isBlocked(pf.lastType)) pf.lastType = '<redacted>';
}

// Strings whose presence in the serialised report means something leaked.
function forbiddenStrings(opts, acc, projectDirs) {
  const list = [['@', '@'], ['home directory', os.homedir()]];
  if (opts.dir) list.push(['--dir path', opts.dir], ['--dir path', path.resolve(opts.dir)]);
  if (opts.globalConfig) {
    list.push(['--global-config path', opts.globalConfig], ['--global-config path', path.resolve(opts.globalConfig)]);
  }
  const user = os.userInfo().username;
  if (user.length >= 3) list.push(['username', user]);
  const host = os.hostname();
  if (host.length >= 3) list.push(['hostname', host]);
  const shortHost = host.split('.')[0];
  if (shortHost.length >= 3) list.push(['hostname', shortHost]);
  for (const c of acc.sensitive.cwds) if (c.length >= 3) list.push(['cwd', c]);
  for (const d of projectDirs) if (d.length >= 3) list.push(['project dir name', d]);
  for (const b of acc.sensitive.branches) if (b.length >= 4 && !COMMON_BRANCHES.has(b)) list.push(['git branch', b]);
  return list;
}

// ---------------------------------------------------------------- report building

const byCountDesc = (x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1);
const sortedCounts = (map) => Object.fromEntries([...map].sort(byCountDesc));

function capCounts(map) {
  const out = {};
  let other = 0;
  [...map].sort(byCountDesc).forEach(([v, c], i) => {
    if (i < ENUM_CAP && v !== '<other>') out[v] = c;
    else other += c;
  });
  if (other) out['<other>'] = other;
  return out;
}

function censusOut(map, denom) {
  const out = {};
  for (const p of [...map.keys()].sort()) {
    const e = map.get(p);
    out[p] = { types: [...e.types].sort(), presencePct: pct(e.count, denom) };
  }
  return out;
}

function idShape(id) {
  if (id.startsWith('msg_')) return 'msg_';
  return UUID_RE.test(id) ? 'uuid' : 'other';
}

function buildDedup(acc) {
  const d = {
    assistantLinesWithUsage: acc.assistantUsageLines,
    distinctMessageIds: acc.ids.size,
    messageIdShapes: { api: { msg_: 0, uuid: 0, other: 0 }, synthetic: { msg_: 0, uuid: 0, other: 0 } },
    requestIdMissing: acc.requestIdMissing,
    splitMessageIds: 0,
    maxLinesPerId: 0,
    splitIdenticalUsage: 0,
    differingFields: {},
    nonDecreasingWhenDiffering: 0,
    lastLineMaxWhenDiffering: 0,
    splitStopReasonOnlyOnLast: 0,
    splitStopReasonOnlyOnLastAll: 0,
    zeroTrailingLineIds: 0,
    idsAcrossMultipleFiles: 0,
    idsAcrossMultipleSessions: 0,
    idsWithMultipleRequestIds: 0,
    idsWithMultipleModels: 0,
    linesMissingMessageId: acc.missingMessageId,
  };
  const differing = new Map();
  for (const [id, e] of acc.ids) {
    const n = e.entries.length;
    d.messageIdShapes[e.models.has('<synthetic>') ? 'synthetic' : 'api'][idShape(id)]++;
    d.maxLinesPerId = Math.max(d.maxLinesPerId, n);
    if (e.files.size > 1) d.idsAcrossMultipleFiles++;
    if (e.sessions.size > 1) d.idsAcrossMultipleSessions++;
    if (e.reqs.size > 1) d.idsWithMultipleRequestIds++;
    if (e.models.size > 1) d.idsWithMultipleModels++;
    if (n < 2) continue;
    d.splitMessageIds++;
    // Stable order: by file index, then line order within the file.
    const rows = e.entries.map((x, i) => [x, i]).sort((x, y) => x[0].f - y[0].f || x[1] - y[1]).map(([x]) => x);
    const usages = rows.map((r) => r.u);
    const stops = rows.map((r) => r.stop);
    const stopOnlyOnLast = stops.slice(0, -1).every((s) => s === null) && stops[n - 1] !== null && stops[n - 1] !== undefined;
    if (stopOnlyOnLast) d.splitStopReasonOnlyOnLastAll++;

    // A later all-zero line after a line with real tokens.
    let seenNonZero = false;
    for (const u of usages) {
      if (seenNonZero && TOKEN_FIELDS.every((f) => u[f] === 0)) {
        d.zeroTrailingLineIds++;
        break;
      }
      if (TOKEN_FIELDS.some((f) => typeof u[f] === 'number' && u[f] !== 0)) seenNonZero = true;
    }

    const fields = new Set(usages.flatMap((u) => Object.keys(u)));
    let anyDiff = false;
    for (const f of fields) {
      const first = JSON.stringify(usages[0][f]);
      if (usages.some((u) => JSON.stringify(u[f]) !== first)) {
        anyDiff = true;
        inc(differing, f);
      }
    }
    if (!anyDiff) {
      d.splitIdenticalUsage++;
      continue;
    }
    if (stopOnlyOnLast) d.splitStopReasonOnlyOnLast++;
    let nonDecreasing = true;
    let lastIsMax = true;
    const last = usages[n - 1];
    for (const f of fields) {
      for (let i = 1; i < n; i++) {
        const a = usages[i - 1][f];
        const b = usages[i][f];
        if (typeof a === 'number' && typeof b === 'number' && b < a) nonDecreasing = false;
      }
      for (const u of usages) if (typeof u[f] === 'number' && typeof last[f] === 'number' && u[f] > last[f]) lastIsMax = false;
    }
    if (nonDecreasing) d.nonDecreasingWhenDiffering++;
    if (lastIsMax) d.lastLineMaxWhenDiffering++;
  }
  d.differingFields = sortedCounts(differing);
  return d;
}

function buildUserLines(acc) {
  const u = acc.userLines;
  const enumOut = (p) => sortedCounts(acc.enums.get(p) || new Map());
  return {
    total: u.total,
    isCompactSummary: u.isCompactSummary,
    isVisibleInTranscriptOnly: u.isVisibleInTranscriptOnly,
    isMeta: u.isMeta,
    isSidechain: u.isSidechain,
    promptSource: enumOut('user:promptSource'),
    originKind: enumOut('user:origin.kind'),
    stringContent: u.stringContent,
    leadingTag: sortedCounts(u.leadingTag),
    queueOperationStringContent: u.queueOperationStringContent,
    systemStringContent: u.systemStringContent,
  };
}

function buildSessions(acc) {
  const s = {
    distinctSessionIds: acc.sessions.size,
    withMultipleFiles: 0,
    mainFilesChecked: 0,
    mainFileNameMatchesSessionIdPct: null,
    linesWithSessionIdMismatch: 0,
    subagentLinesWithParentSessionIdMismatch: 0,
    sessionsWithMultipleCwds: 0,
    sessionsWithMultipleModels: 0,
    sessionsWithMultipleGitBranches: 0,
    sessionsWithMultipleVersions: 0,
    maxFilesPerSession: 0,
    isSidechain: {
      main: sortedCounts(acc.sidechain.main),
      subagent: sortedCounts(acc.sidechain.subagent),
      other: sortedCounts(acc.sidechain.other),
    },
    lastLineTypeOfMainFiles: {},
    endMarkerCandidates: { types: {}, subtypes: {} },
  };
  for (const e of acc.sessions.values()) {
    if (e.files.size > 1) s.withMultipleFiles++;
    s.maxFilesPerSession = Math.max(s.maxFilesPerSession, e.files.size);
    if (e.cwds.size > 1) s.sessionsWithMultipleCwds++;
    if (e.models.size > 1) s.sessionsWithMultipleModels++;
    if (e.branches.size > 1) s.sessionsWithMultipleGitBranches++;
    if (e.versions.size > 1) s.sessionsWithMultipleVersions++;
  }
  let matching = 0;
  const lastTypes = new Map();
  for (const pf of acc.perFile) {
    if (pf.kind === 'main') {
      s.linesWithSessionIdMismatch += pf.sidMismatch;
      if (pf.sidLines > 0) {
        s.mainFilesChecked++;
        if (pf.sidMismatch === 0) matching++;
      }
      inc(lastTypes, pf.lastType ?? '<no-parseable-line>');
    } else if (pf.kind === 'subagent') {
      s.subagentLinesWithParentSessionIdMismatch += pf.sidMismatch;
    }
  }
  s.mainFileNameMatchesSessionIdPct = pct(matching, s.mainFilesChecked);
  s.lastLineTypeOfMainFiles = sortedCounts(lastTypes);
  for (const [t, lt] of acc.lineTypes) if (END_MARKER_RE.test(t)) s.endMarkerCandidates.types[t] = lt.count;
  for (const [v, c] of acc.enums.get('subtype') || []) if (END_MARKER_RE.test(v)) s.endMarkerCandidates.subtypes[v] = c;
  return s;
}

function buildProjectDirEncoding(acc, projectDirs) {
  const cwdsByDir = new Map();
  for (const pf of acc.perFile) {
    if (!pf.cwds || pf.cwds.size === 0) continue;
    let set = cwdsByDir.get(pf.projectDir);
    if (!set) cwdsByDir.set(pf.projectDir, (set = new Set()));
    for (const c of pf.cwds) set.add(c);
  }
  const r = {
    projectDirs: projectDirs.length,
    dirsChecked: 0,
    matchesNonAlnumToDash: 0,
    mismatchesTruncated: 0,
    mismatchesOther: 0,
    dirsWithMultipleCwds: 0,
    maxDirNameLength: 0,
    maxEncodedCwdLength: 0,
    dirsWithNonAscii: 0,
    mismatchShapes: [], // numeric only: lengths and shared-prefix length
  };
  for (const name of projectDirs) {
    r.maxDirNameLength = Math.max(r.maxDirNameLength, name.length);
    if (/[^\x00-\x7f]/.test(name)) r.dirsWithNonAscii++;
    const cwds = cwdsByDir.get(name);
    if (!cwds) continue;
    r.dirsChecked++;
    if (cwds.size > 1) r.dirsWithMultipleCwds++;
    const encs = [...cwds].map((c) => c.replace(/[^A-Za-z0-9]/g, '-'));
    for (const e of encs) r.maxEncodedCwdLength = Math.max(r.maxEncodedCwdLength, e.length);
    if (encs.includes(name)) r.matchesNonAlnumToDash++;
    else if (encs.some((e) => name.length < e.length && e.startsWith(name))) r.mismatchesTruncated++;
    else {
      r.mismatchesOther++;
      if (r.mismatchShapes.length < 20) {
        const e = encs[0];
        let common = 0;
        while (common < e.length && common < name.length && e[common] === name[common]) common++;
        r.mismatchShapes.push({ dirNameLength: name.length, encodedLength: e.length, commonPrefixLength: common });
      }
    }
  }
  return r;
}

function buildGlobalConfig(opts) {
  const list = [];
  if (opts.globalConfig) list.push(['--global-config', path.resolve(opts.globalConfig)]);
  if (process.env.CLAUDE_CONFIG_DIR) {
    list.push(['$CLAUDE_CONFIG_DIR/.claude.json', path.join(path.resolve(process.env.CLAUDE_CONFIG_DIR), '.claude.json')]);
  }
  list.push(['$HOME/.claude.json', path.join(os.homedir(), '.claude.json')]);
  const candidates = list.map(([label, abs]) => ({ label, exists: !!tryStat(abs)?.isFile() }));
  const r = {
    selectedLabel: null,
    candidates,
    parseError: false,
    topLevelKeys: [],
    unlistedKeys: 0,
    oauthAccountPresent: false,
    oauthAccountKeys: [],
    oauthAccountUnlistedKeys: 0,
    oauthAccountValueTypes: {},
  };
  const idx = candidates.findIndex((c) => c.exists);
  if (idx === -1) return r;
  r.selectedLabel = candidates[idx].label;
  let cfg;
  try {
    cfg = JSON.parse(fs.readFileSync(list[idx][1], 'utf8'));
  } catch {
    r.parseError = true;
    return r;
  }
  if (!isObj(cfg)) return r;
  for (const k of Object.keys(cfg)) {
    if (CONFIG_KEY_RE.test(k)) r.topLevelKeys.push(k);
    else r.unlistedKeys++;
  }
  if (isObj(cfg.oauthAccount)) {
    r.oauthAccountPresent = true;
    for (const k of Object.keys(cfg.oauthAccount)) {
      if (!CONFIG_KEY_RE.test(k)) {
        r.oauthAccountUnlistedKeys++;
        continue;
      }
      r.oauthAccountKeys.push(k);
      r.oauthAccountValueTypes[k] = jsonType(cfg.oauthAccount[k]);
    }
  }
  return r;
}

// Depth-1 key census (names + types only) over a list of JSON objects.
function keyCensus(objects, extra = {}) {
  const keys = new Map();
  let n = 0;
  for (const o of objects) {
    if (!isObj(o)) continue;
    n++;
    for (const k of Object.keys(o)) record(keys, safeKey(k), jsonType(o[k]), n);
  }
  return { ...extra, objects: n, keys: censusOut(keys, n) };
}

function readJsonFiles(files) {
  const objs = [];
  let parseErrors = 0;
  for (const f of files) {
    try {
      objs.push(JSON.parse(fs.readFileSync(f, 'utf8')));
    } catch {
      parseErrors++;
    }
  }
  return { objs, parseErrors, files: files.length };
}

function buildAuxiliary(dataDir, metaFiles) {
  const meta = readJsonFiles(metaFiles);
  const sessDir = path.join(dataDir, 'sessions');
  let sessFiles = [];
  try {
    sessFiles = fs
      .readdirSync(sessDir)
      .filter((n) => n.endsWith('.json'))
      .map((n) => path.join(sessDir, n));
  } catch {
    sessFiles = [];
  }
  const sess = readJsonFiles(sessFiles);
  const aux = {
    subagentMeta: keyCensus(meta.objs, { files: meta.files, parseErrors: meta.parseErrors }),
    sessionsDir: keyCensus(sess.objs, { present: !!tryStat(sessDir), files: sess.files, parseErrors: sess.parseErrors }),
    history: { present: false },
  };
  // history.jsonl: only the first HISTORY_LINES complete lines, read from a bounded chunk.
  const hist = path.join(dataDir, 'history.jsonl');
  const hst = tryStat(hist);
  if (hst && hst.isFile()) {
    const fd = fs.openSync(hist, 'r');
    const chunk = Buffer.alloc(Math.min(hst.size, 8 * 1024 * 1024));
    const read = fs.readSync(fd, chunk, 0, chunk.length, 0);
    fs.closeSync(fd);
    let lines = chunk.toString('utf8', 0, read).split('\n');
    if (read < hst.size) lines.pop(); // drop a possibly partial last line
    lines = lines.filter((l) => l.trim() !== '').slice(0, HISTORY_LINES);
    const objs = [];
    let malformed = 0;
    for (const l of lines) {
      try {
        objs.push(JSON.parse(l));
      } catch {
        malformed++;
      }
    }
    aux.history = keyCensus(objs, { present: true, linesSampled: lines.length, malformed });
  }
  return aux;
}

function buildAppendCheck(prevSnap, perFile) {
  const r = {
    grewAppendOnly: 0,
    unchanged: 0,
    mtimeChangedSameContent: 0,
    shrank: 0,
    rewritten: 0,
    identityChanged: 0,
    newFiles: 0,
    deletedFiles: 0,
  };
  const seen = new Set();
  for (const pf of perFile) {
    seen.add(pf.key);
    const p = prevSnap[pf.key];
    if (!p) r.newFiles++;
    else if (p.ino !== pf.ino) r.identityChanged++;
    else if (pf.size === p.size && pf.full === p.full) {
      r.unchanged++;
      if (pf.mtimeMs !== p.mtimeMs) r.mtimeChangedSameContent++;
    } else if (pf.size > p.size && pf.prevPrefix === p.full) r.grewAppendOnly++;
    else if (pf.size < p.size) r.shrank++;
    else r.rewritten++;
  }
  for (const k of Object.keys(prevSnap)) if (!seen.has(k)) r.deletedFiles++;
  return r;
}

// ---------------------------------------------------------------- main

async function main() {
  const started = Date.now();
  const opts = parseArgs(process.argv.slice(2));

  let prevSnap = null;
  if (opts.compare) {
    try {
      prevSnap = JSON.parse(fs.readFileSync(opts.compare, 'utf8')).fileSnapshot || {};
    } catch {
      process.stderr.write('probe: could not read the --compare report\n');
      process.exit(1);
    }
  }

  const cands = candidateDirs(opts);
  const selected = opts.dir ? cands[0] : cands.find((c) => c.exists && c.hasProjectsDir) || null;

  const report = {
    meta: {
      probeVersion: PROBE_VERSION,
      generatedAt: new Date().toISOString(),
      durationMs: 0,
      os: { platform: process.platform, release: os.release(), arch: process.arch },
      node: process.version,
    },
    candidates: cands.map(({ abs, ...c }) => c),
    selected: selected ? selected.label : null,
  };

  const dataDir = selected ? selected.abs : null;
  let entries = [];
  try {
    if (dataDir) entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const kindOf = (e) => (e.isDirectory() ? 'dir' : e.isFile() ? 'file' : e.isSymbolicLink() ? 'symlink' : 'other');
  report.dataDirEntries = {
    listed: entries
      .filter((e) => KNOWN_DATA_ENTRIES.has(e.name))
      .map((e) => ({ name: e.name, kind: kindOf(e) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    unlistedEntries: entries.filter((e) => !KNOWN_DATA_ENTRIES.has(e.name)).length,
  };

  const found = dataDir
    ? discover(dataDir)
    : { projectDirs: [], transcripts: [], metaFiles: [], toolResultDirs: 0, symlinksSkipped: 0, otherByExt: new Map() };
  const acc = await scanAll(found.transcripts, prevSnap || {});
  redactAcc(acc, blockedEnumValues(acc));
  const perFile = acc.perFile;

  report.files = {
    projectDirs: found.projectDirs.length,
    transcripts: found.transcripts.length,
    mainTranscripts: found.transcripts.filter((f) => f.kind === 'main').length,
    subagentTranscripts: found.transcripts.filter((f) => f.kind === 'subagent').length,
    otherTranscripts: found.transcripts.filter((f) => f.kind === 'other').length,
    subagentMetaFiles: found.metaFiles.length,
    toolResultDirs: found.toolResultDirs,
    otherFilesByExtension: sortedCounts(found.otherByExt),
    symlinksSkipped: found.symlinksSkipped,
    unreadable: sortedCounts(acc.unreadable),
    totalBytes: perFile.reduce((s, f) => s + f.size, 0),
    maxFileBytes: perFile.reduce((m, f) => Math.max(m, f.size), 0),
    emptyFiles: perFile.filter((f) => f.size === 0).length,
    filesNotEndingWithNewline: perFile.filter((f) => !f.endsWithNewline).length,
  };
  report.lines = acc.lines;

  report.lineTypes = {};
  for (const t of [...acc.lineTypes.keys()].sort()) {
    const lt = acc.lineTypes.get(t);
    report.lineTypes[t] = { count: lt.count, keys: censusOut(lt.keys, lt.count) };
  }

  report.usageKeys = {};
  for (const p of [...acc.usage.keys.keys()].sort()) {
    const e = acc.usage.keys.get(p);
    report.usageKeys[p] = {
      types: [...e.types].sort(),
      presencePct: pct(e.count, acc.usage.lines),
      min: e.min ?? null,
      max: e.max ?? null,
      negative: e.negative || 0,
    };
  }
  report.usageSummary = {
    linesWithUsage: acc.usage.lines,
    usageLinesNotAssistant: acc.usage.nonAssistant,
    negativeValues: acc.usage.negativeValues,
  };

  report.enums = {};
  for (const p of [...acc.enums.keys()].sort()) report.enums[p] = capCounts(acc.enums.get(p));
  report.timestampShapes = sortedCounts(acc.tsShapes);
  report.dedup = buildDedup(acc);
  report.userLines = buildUserLines(acc);
  report.sessions = buildSessions(acc);
  report.projectDirEncoding = buildProjectDirEncoding(acc, found.projectDirs);
  report.globalConfig = buildGlobalConfig(opts);
  report.auxiliary = dataDir ? buildAuxiliary(dataDir, found.metaFiles) : null;

  report.fileSnapshot = {};
  for (const pf of perFile) {
    report.fileSnapshot[pf.key] = { size: pf.size, ino: pf.ino, mtimeMs: pf.mtimeMs, full: pf.full };
  }
  if (prevSnap) report.appendCheck = buildAppendCheck(prevSnap, perFile);
  report.meta.scanMode = acc.scanMode;
  report.meta.durationMs = Date.now() - started;

  // Backstop guard: refuse to emit a report containing any identifying string.
  const text = JSON.stringify(report, null, 2) + '\n';
  for (const [category, s] of forbiddenStrings(opts, acc, found.projectDirs)) {
    if (!s) continue;
    if (text.includes(s) || text.includes(JSON.stringify(s).slice(1, -1))) {
      process.stderr.write(`probe: refusing to write report: it contains a forbidden string (category: ${category})\n`);
      process.exit(2);
    }
  }

  if (opts.out) fs.writeFileSync(opts.out, text);
  else process.stdout.write(text);
}

if (isMainThread) {
  main().catch((err) => {
    // Only the error class/code is printed; messages can contain paths.
    process.stderr.write(`probe: failed (${(err && (err.code || err.name)) || 'error'})\n`);
    process.exit(1);
  });
}
