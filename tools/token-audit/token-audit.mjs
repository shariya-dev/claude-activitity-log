#!/usr/bin/env node
/**
 * token-audit — the H23 token oracle.
 *
 * An INDEPENDENT reference implementation of Claude Code token usage
 * extraction. It does not import any code from the
 * agent (`6am-agent/src/`) or the backend (`agent-dashboard/app/`); its rules
 * come only from `docs/contracts/claude-data-contract.md` §3–6, §11 and §15,
 * the fixture README (`6am-agent/test/fixtures/claude/README.md`) and PRD
 * §19–22. It is used to check that the agent, the database and the dashboard
 * all report the same numbers for the same raw data.
 * Rules it shares with the agent (the known line types, the dedup key order,
 * non-numeric or negative token values becoming 0) are copied from contract
 * §4–6, not from the agent code.
 *
 * Rules (contract §5–6):
 *   - Files: exactly `projects/*\/*.jsonl` and `projects/*\/*\/subagents/*.jsonl`
 *     under --dir, processed in sorted path order. Nothing else is opened and
 *     nothing is ever written.
 *   - Only complete lines (ending in `\n`) are consumed; a partial trailing
 *     line is ignored (contract §11).
 *   - Usage records: `assistant` lines with an object `message.usage`, except
 *     `message.model === '<synthetic>'`. Key = `message.id`, else `requestId`,
 *     else line `uuid`. Duplicate lines of a key merge by per-field MAX.
 *   - recorded_at = timestamp of the first line of a key (sorted file order,
 *     then line order). The day of a record is recorded_at's calendar date
 *     in --tz (default Asia/Dhaka, the backend's org timezone).
 *
 * Derived metrics (PRD §20):
 *   actual_consumed_tokens = input + output + cache_creation
 *   total_token_activity   = actual_consumed_tokens + cache_read
 * "Actual Consumed Tokens" is a monitoring calculation. It is not a billing
 * or subscription figure, and the local data does not establish one.
 *
 * Privacy: only these fields are ever accessed on a line: type, sessionId,
 * timestamp, isSidechain, requestId, uuid, message.id, message.model,
 * message.usage.{input_tokens,output_tokens,cache_creation_input_tokens,
 * cache_read_input_tokens}. Prompt text, content, cwd and file paths are
 * never printed; the report shows only the basename of --dir.
 *
 * Zero dependencies. Node >= 24.
 */

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_TZ = 'Asia/Dhaka';

/** Contract §4: the 18 known line types. Anything else is counted as skipped. */
export const KNOWN_TYPES = new Set([
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

const TOKEN_FIELDS = [
    ['input_tokens', 'input_tokens'],
    ['output_tokens', 'output_tokens'],
    ['cache_creation_tokens', 'cache_creation_input_tokens'],
    ['cache_read_tokens', 'cache_read_input_tokens'],
];

export const METRIC_KEYS = [
    'input_tokens',
    'output_tokens',
    'cache_creation_tokens',
    'cache_read_tokens',
    'actual_consumed_tokens',
    'total_token_activity',
    'message_count',
];

const LABELS = {
    input_tokens: 'Input Tokens',
    output_tokens: 'Output Tokens',
    cache_creation_tokens: 'Cache Creation Tokens',
    cache_read_tokens: 'Cache Read Tokens',
    actual_consumed_tokens: 'Actual Consumed Tokens',
    total_token_activity: 'Total Token Activity',
    message_count: 'Messages',
};

const NEWLINE = 0x0a;

// ---------------------------------------------------------------------------
// File enumeration (contract §3)
// ---------------------------------------------------------------------------

async function listDir(dir) {
    try {
        return await readdir(dir, { withFileTypes: true });
    } catch {
        return [];
    }
}

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Returns the transcript paths relative to `projectsDir` ('/'-joined), sorted.
 * Only `*\/*.jsonl` and `*\/*\/subagents/*.jsonl` are returned.
 */
export async function enumerateTranscripts(projectsDir) {
    const out = [];
    for (const project of await listDir(projectsDir)) {
        if (!project.isDirectory()) continue;
        const projectPath = join(projectsDir, project.name);
        for (const entry of await listDir(projectPath)) {
            if (entry.isFile() && entry.name.endsWith('.jsonl')) {
                out.push(`${project.name}/${entry.name}`);
            } else if (entry.isDirectory()) {
                const subDir = join(projectPath, entry.name, 'subagents');
                for (const sub of await listDir(subDir)) {
                    if (sub.isFile() && sub.name.endsWith('.jsonl')) {
                        out.push(`${project.name}/${entry.name}/subagents/${sub.name}`);
                    }
                }
            }
        }
    }
    return out.sort(byCodeUnit);
}

// ---------------------------------------------------------------------------
// Line reading (contract §11): complete lines only, any line length
// ---------------------------------------------------------------------------

/**
 * Streams a file and calls onLine(buffer) for every complete line (without
 * the `\n`). Returns the number of bytes after the last `\n`.
 */
export async function readCompleteLines(filePath, onLine) {
    let pending = [];
    let pendingBytes = 0;
    const stream = createReadStream(filePath, { highWaterMark: 1 << 20 });
    for await (const chunk of stream) {
        let start = 0;
        let nl;
        while ((nl = chunk.indexOf(NEWLINE, start)) !== -1) {
            const piece = chunk.subarray(start, nl);
            if (pendingBytes > 0) {
                pending.push(piece);
                onLine(Buffer.concat(pending, pendingBytes + piece.length));
                pending = [];
                pendingBytes = 0;
            } else {
                onLine(piece);
            }
            start = nl + 1;
        }
        if (start < chunk.length) {
            const rest = chunk.subarray(start);
            pending.push(rest);
            pendingBytes += rest.length;
        }
    }
    return pendingBytes;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Non-negative safe integer, else 0 (missing / non-numeric / invalid). */
function tokenValue(v) {
    return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : 0;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nonEmptyString(v) {
    return typeof v === 'string' && v !== '' ? v : null;
}

function emptyMetrics() {
    return {
        input_tokens: 0n,
        output_tokens: 0n,
        cache_creation_tokens: 0n,
        cache_read_tokens: 0n,
        message_count: 0n,
    };
}

function addRecord(m, rec) {
    m.input_tokens += BigInt(rec.input_tokens);
    m.output_tokens += BigInt(rec.output_tokens);
    m.cache_creation_tokens += BigInt(rec.cache_creation_tokens);
    m.cache_read_tokens += BigInt(rec.cache_read_tokens);
    m.message_count += 1n;
}

/** BigInt → Number when safe; otherwise a decimal string (never silently rounded). */
function num(b) {
    return b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b.toString();
}

function finalizeMetrics(m) {
    const actual = m.input_tokens + m.output_tokens + m.cache_creation_tokens;
    const total = actual + m.cache_read_tokens;
    return {
        input_tokens: num(m.input_tokens),
        output_tokens: num(m.output_tokens),
        cache_creation_tokens: num(m.cache_creation_tokens),
        cache_read_tokens: num(m.cache_read_tokens),
        actual_consumed_tokens: num(actual),
        total_token_activity: num(total),
        message_count: num(m.message_count),
    };
}

export function makeDayFormatter(tz) {
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    return (ms) => fmt.format(new Date(ms));
}

export function isValidTimeZone(tz) {
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

/**
 * @param {{dir: string, sessions?: string[]|null, since?: string|null, tz?: string}} opts
 * @returns {Promise<object>} the report object printed by `--json`
 */
export async function audit({ dir, sessions = null, since = null, tz = DEFAULT_TZ }) {
    if (!isValidTimeZone(tz)) throw new AuditError(`unknown time zone: ${tz}`);
    let sinceMs = null;
    let sinceIso = null;
    if (since !== null && since !== undefined) {
        sinceMs = Date.parse(since);
        if (!Number.isFinite(sinceMs)) throw new AuditError(`--since is not a valid ISO-8601 timestamp: ${since}`);
        sinceIso = new Date(sinceMs).toISOString();
    }
    const sessionFilter = sessions && sessions.length > 0 ? new Set(sessions) : null;

    const projectsDir = join(dir, 'projects');
    let st;
    try {
        st = await stat(projectsDir);
    } catch {
        throw new AuditError(`no projects/ directory under --dir`);
    }
    if (!st.isDirectory()) throw new AuditError(`projects is not a directory under --dir`);

    const diagnostics = {
        files: 0,
        linesTotal: 0,
        linesSkipped: 0,
        usageNoKey: 0,
        partialTrailingBytes: 0,
        usageLines: 0,
        syntheticSkipped: 0,
        distinctMessages: 0,
        splitMessages: 0,
    };

    /** key → {session_id, model, is_sidechain, recorded_at, recorded_ms, lines, 4 token fields} */
    const records = new Map();
    /** session_id → {first_ms, first, last_ms, last} */
    const sessionTimes = new Map();

    const onLine = (buf) => {
        diagnostics.linesTotal++;
        let line;
        try {
            line = JSON.parse(buf.toString('utf8'));
        } catch {
            diagnostics.linesSkipped++;
            return;
        }
        if (!isPlainObject(line) || typeof line.type !== 'string' || !KNOWN_TYPES.has(line.type)) {
            diagnostics.linesSkipped++;
            return;
        }

        const sessionId = nonEmptyString(line.sessionId);
        if (sessionFilter !== null && (sessionId === null || !sessionFilter.has(sessionId))) return;

        const ts = typeof line.timestamp === 'string' ? line.timestamp : null;
        const tsMs = ts !== null ? Date.parse(ts) : NaN;
        const hasTs = Number.isFinite(tsMs);
        if (sinceMs !== null && (!hasTs || tsMs < sinceMs)) return;

        // Session activity window: every timestamped known-type line.
        if (hasTs && sessionId !== null) {
            const s = sessionTimes.get(sessionId);
            if (s === undefined) {
                sessionTimes.set(sessionId, { first_ms: tsMs, first: ts, last_ms: tsMs, last: ts });
            } else {
                if (tsMs < s.first_ms) {
                    s.first_ms = tsMs;
                    s.first = ts;
                }
                if (tsMs > s.last_ms) {
                    s.last_ms = tsMs;
                    s.last = ts;
                }
            }
        }

        if (line.type !== 'assistant') return;
        const message = line.message;
        if (!isPlainObject(message) || !isPlainObject(message.usage)) return;
        const model = typeof message.model === 'string' ? message.model : null;
        if (model === '<synthetic>') {
            diagnostics.syntheticSkipped++;
            return;
        }
        const key = nonEmptyString(message.id) ?? nonEmptyString(line.requestId) ?? nonEmptyString(line.uuid);
        if (key === null) {
            // No identity at all: cannot be deduplicated, so it cannot be counted safely.
            diagnostics.usageNoKey++;
            return;
        }
        diagnostics.usageLines++;

        const usage = message.usage;
        const rec = records.get(key);
        if (rec === undefined) {
            const fresh = {
                session_id: sessionId,
                model,
                is_sidechain: line.isSidechain === true,
                recorded_at: hasTs ? ts : null,
                recorded_ms: hasTs ? tsMs : null,
                lines: 1,
            };
            for (const [out, src] of TOKEN_FIELDS) fresh[out] = tokenValue(usage[src]);
            records.set(key, fresh);
        } else {
            rec.lines++;
            for (const [out, src] of TOKEN_FIELDS) {
                const v = tokenValue(usage[src]);
                if (v > rec[out]) rec[out] = v;
            }
        }
    };

    const files = await enumerateTranscripts(projectsDir);
    for (const rel of files) {
        diagnostics.files++;
        diagnostics.partialTrailingBytes += await readCompleteLines(join(projectsDir, ...rel.split('/')), onLine);
    }

    // ---- aggregate -------------------------------------------------------
    const dayOf = makeDayFormatter(tz);
    const totals = emptyMetrics();
    const bySession = new Map();
    const byDay = new Map();
    const byModel = new Map();
    const bySessionDay = new Map();
    const bump = (map, key, rec) => {
        let m = map.get(key);
        if (m === undefined) map.set(key, (m = emptyMetrics()));
        addRecord(m, rec);
    };

    for (const rec of records.values()) {
        diagnostics.distinctMessages++;
        if (rec.lines >= 2) diagnostics.splitMessages++;
        addRecord(totals, rec);
        bump(bySession, rec.session_id, rec);
        bump(byModel, rec.model, rec);
        const date = rec.recorded_ms !== null ? dayOf(rec.recorded_ms) : null;
        bump(byDay, date, rec);
        bump(bySessionDay, JSON.stringify([rec.session_id, date]), rec);
    }

    const nullsLast = (a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : byCodeUnit(a, b));

    const sessionIds = new Set([...sessionTimes.keys(), ...bySession.keys()]);
    const sessionRows = [...sessionIds].sort(nullsLast).map((id) => {
        const t = sessionTimes.get(id);
        return {
            session_id: id,
            first_seen_at: t ? t.first : null,
            last_seen_at: t ? t.last : null,
            ...finalizeMetrics(bySession.get(id) ?? emptyMetrics()),
        };
    });
    const dayRows = [...byDay.keys()].sort(nullsLast).map((date) => ({ date, ...finalizeMetrics(byDay.get(date)) }));
    const modelRows = [...byModel.keys()]
        .sort(nullsLast)
        .map((model) => ({ model, ...finalizeMetrics(byModel.get(model)) }));
    const sessionDayRows = [...bySessionDay.entries()]
        .map(([k, m]) => {
            const [session_id, date] = JSON.parse(k);
            return { session_id, date, ...finalizeMetrics(m) };
        })
        .sort((a, b) => nullsLast(a.session_id, b.session_id) || nullsLast(a.date, b.date));

    return {
        tool: 'token-audit',
        version: 1,
        dir: basename(dir),
        tz,
        since: sinceIso,
        sessionsFilter: sessionFilter ? [...sessionFilter] : null,
        diagnostics,
        totals: finalizeMetrics(totals),
        sessions: sessionRows,
        days: dayRows,
        models: modelRows,
        sessionDays: sessionDayRows,
    };
}

export class AuditError extends Error {}

// ---------------------------------------------------------------------------
// Plain-text report
// ---------------------------------------------------------------------------

const fmtInt = (v) => (typeof v === 'number' ? v.toLocaleString('en-US') : String(v));

function table(headers, rows, rightAlignFrom) {
    const cells = rows.map((r) => r.map((c) => (c === null || c === undefined ? '-' : String(c))));
    const widths = headers.map((h, i) => Math.max(h.length, ...cells.map((r) => r[i].length)));
    const fmtRow = (r) =>
        r.map((c, i) => (i >= rightAlignFrom ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
    return [fmtRow(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...cells.map(fmtRow)].join('\n');
}

const METRIC_HEADERS = METRIC_KEYS.map((k) => LABELS[k]);
const metricCells = (row) => METRIC_KEYS.map((k) => fmtInt(row[k]));

export function renderText(report) {
    const out = [];
    out.push('token-audit (H23 oracle) — Claude Code token usage from local transcripts');
    out.push(`dir: ${report.dir}`);
    out.push(`timezone: ${report.tz}`);
    out.push(`since: ${report.since ?? '-'}`);
    out.push(`sessions filter: ${report.sessionsFilter ? report.sessionsFilter.join(', ') : '-'}`);
    out.push('Actual Consumed Tokens = Input + Output + Cache Creation (a monitoring calculation).');
    out.push('Total Token Activity = Actual Consumed Tokens + Cache Read.');
    out.push('');
    out.push('Diagnostics');
    out.push(
        table(
            ['Measure', 'Value'],
            Object.entries(report.diagnostics).map(([k, v]) => [k, fmtInt(v)]),
            1,
        ),
    );
    out.push('');
    out.push('Totals');
    out.push(table(['Metric', 'Value'], METRIC_KEYS.map((k) => [LABELS[k], fmtInt(report.totals[k])]), 1));
    out.push('');
    out.push('By session');
    out.push(
        table(
            ['Session', 'First Seen', 'Last Seen', ...METRIC_HEADERS],
            report.sessions.map((r) => [r.session_id, r.first_seen_at, r.last_seen_at, ...metricCells(r)]),
            3,
        ),
    );
    out.push('');
    out.push(`By day (${report.tz})`);
    out.push(table(['Day', ...METRIC_HEADERS], report.days.map((r) => [r.date, ...metricCells(r)]), 1));
    out.push('');
    out.push('By model');
    out.push(table(['Model', ...METRIC_HEADERS], report.models.map((r) => [r.model, ...metricCells(r)]), 1));
    out.push('');
    out.push(`By session and day (${report.tz})`);
    out.push(
        table(
            ['Session', 'Day', ...METRIC_HEADERS],
            report.sessionDays.map((r) => [r.session_id, r.date, ...metricCells(r)]),
            2,
        ),
    );
    return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const USAGE = `Usage: node tools/token-audit/token-audit.mjs --dir <claudeDataDir> [options]

H23 token oracle: reads Claude Code transcripts (projects/*/*.jsonl and
projects/*/*/subagents/*.jsonl) read-only, deduplicates usage by message.id
with a per-field maximum, and prints Input, Output, Cache Creation and Cache
Read Tokens plus Actual Consumed Tokens and Total Token Activity per session,
day, model and session-day.

Options:
  --dir <path>        Claude data dir (the one containing projects/). Required.
  --session <id>      Only lines with this sessionId. Repeatable.
  --since <ISO-8601>  Ignore lines whose timestamp is earlier than this.
  --tz <IANA tz>      Time zone for days (default ${DEFAULT_TZ}).
  --json              Print one JSON object instead of text tables.
  -h, --help          Show this help.

Exit codes: 0 ok, 1 unexpected error, 2 bad arguments or no projects/ dir.
`;

export async function main(argv = process.argv.slice(2)) {
    let values;
    try {
        ({ values } = parseArgs({
            args: argv,
            options: {
                dir: { type: 'string' },
                session: { type: 'string', multiple: true },
                since: { type: 'string' },
                tz: { type: 'string' },
                json: { type: 'boolean', default: false },
                help: { type: 'boolean', short: 'h', default: false },
            },
            strict: true,
            allowPositionals: false,
        }));
    } catch (err) {
        process.stderr.write(`token-audit: ${err.message}\n\n${USAGE}`);
        return 2;
    }
    if (values.help) {
        process.stdout.write(USAGE);
        return 0;
    }
    if (!values.dir) {
        process.stderr.write(`token-audit: --dir is required\n\n${USAGE}`);
        return 2;
    }
    let report;
    try {
        report = await audit({
            dir: values.dir,
            sessions: values.session ?? null,
            since: values.since ?? null,
            tz: values.tz ?? DEFAULT_TZ,
        });
    } catch (err) {
        if (err instanceof AuditError) {
            process.stderr.write(`token-audit: ${err.message}\n`);
            return 2;
        }
        process.stderr.write(`token-audit: unexpected error (${err?.code ?? err?.name ?? 'unknown'})\n`);
        return 1;
    }
    process.stdout.write(values.json ? JSON.stringify(report, null, 2) + '\n' : renderText(report));
    return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = await main();
}
