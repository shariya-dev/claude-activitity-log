import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEVICE_TOKEN_KEY, type AgentContainer } from '../app/container.js';
import { isPaired } from '../app/localState.js';
import { readLockHolder } from '../app/lock.js';
import { AGENT_VERSION } from './version.js';

export interface StatusReport {
  paired: boolean;
  device_id: string | null;
  backend_host: string;
  channel: string;
  agent_state: string | null;
  claude_data_dir: string | null;
  last_sync_at: string | null;
  last_success_sync_at: string | null;
  last_failure_at: string | null;
  last_error_code: string | null;
  settings_version: number | null;
  service: string;
  running_pid: number | null;
  agent_version: string;
}

export async function collectStatus(c: AgentContainer): Promise<StatusReport> {
  const success = c.state.get('last_success_sync_at');
  const failure = c.state.get('last_failure_at');
  const lastSync =
    [success, failure]
      .filter((v): v is string => v !== null)
      .sort()
      .at(-1) ?? null;
  const source = c.source ?? (await c.discover());
  const service = await c.adapter.service.status().catch(() => 'unknown' as const);
  const uid = c.state.get('device_uid');
  return {
    paired: await isPaired(c),
    device_id: uid === '' ? null : uid,
    backend_host: new URL(c.apiBaseUrl).host,
    channel: c.buildConfig.channel,
    agent_state: c.state.get('agent_state'),
    claude_data_dir: source?.dataDir ?? null,
    last_sync_at: lastSync,
    last_success_sync_at: success,
    last_failure_at: failure,
    last_error_code: c.state.get('last_error_code'),
    settings_version: c.state.get('settings_version'),
    service,
    running_pid: readLockHolder(c.paths.lockFile),
    agent_version: AGENT_VERSION,
  };
}

export function formatStatus(s: StatusReport): string {
  const v = (x: string | number | null): string => (x === null ? '-' : String(x));
  const rows: [string, string][] = [
    ['Paired', s.paired ? 'yes' : 'no'],
    ['Device ID', v(s.device_id)],
    ['Backend', s.backend_host],
    ['Agent state', v(s.agent_state)],
    ['Claude data', s.claude_data_dir ?? 'not found'],
    ['Last sync', v(s.last_sync_at)],
    ['Last success', v(s.last_success_sync_at)],
    [
      'Last failure',
      s.last_failure_at === null ? '-' : `${s.last_failure_at} (${v(s.last_error_code)})`,
    ],
    ['Settings version', v(s.settings_version)],
    ['Service', s.service],
    ['Running agent', s.running_pid === null ? 'none' : `pid ${s.running_pid}`],
    ['Agent version', s.agent_version],
  ];
  const width = Math.max(...rows.map(([k]) => k.length)) + 2;
  return rows.map(([k, val]) => `${`${k}:`.padEnd(width)}${val}\n`).join('');
}

const LOG_TAIL_LINES = 50;
const MAX_LOG_READ_BYTES = 256 * 1024;
const REDACTED = '[redacted]';
const SECRET_KEY = /token|authorization|content|prompt|email|secret|password/i;
const BEARER = /\b(bearer)\s+[^\s"'<>,;]+/gi;

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(BEARER, `$1 ${REDACTED}`);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? REDACTED : redactValue(v)]),
    );
  }
  return value;
}

/** Last log lines, re-redacted (secret-looking keys, Bearer values); non-JSON lines become a placeholder. */
function logTail(logDir: string): unknown[] {
  let text: string;
  try {
    const buf = readFileSync(path.join(logDir, 'agent.log'));
    text = buf.subarray(Math.max(0, buf.length - MAX_LOG_READ_BYTES)).toString('utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-LOG_TAIL_LINES)
    .map((line) => {
      try {
        return redactValue(JSON.parse(line));
      } catch {
        return '[unparseable log line]';
      }
    });
}

/** Replaces every occurrence of `secret` in string values, at any depth. */
function scrubSecret(value: unknown, secret: string): unknown {
  if (typeof value === 'string') return value.split(secret).join(REDACTED);
  if (Array.isArray(value)) return value.map((v) => scrubSecret(v, secret));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubSecret(v, secret)]));
  }
  return value;
}

/** `diagnostics`: status, discovery with readable flags, versions, redacted log tail. No secrets. */
export async function collectDiagnostics(c: AgentContainer): Promise<Record<string, unknown>> {
  const status = await collectStatus(c);
  const candidates = c.adapter.claudeDataCandidates();
  const globalConfigs = c.adapter.claudeGlobalConfigCandidates();
  const [dataChecks, configChecks] = await Promise.all([
    c.adapter.checkPermissions(candidates).catch(() => []),
    c.adapter.checkPermissions(globalConfigs).catch(() => []),
  ]);
  const info = await c.agentInfo().catch(() => null);
  const settings = c.state.get('settings');
  const report: Record<string, unknown> = {
    status,
    versions: {
      agent: AGENT_VERSION,
      node: process.versions.node,
      sqlite: process.versions.sqlite ?? null,
      claude_code: info?.claude_code_version ?? null,
    },
    platform: {
      id: c.adapter.id,
      version: info?.platform_version ?? null,
      architecture: info?.architecture ?? process.arch,
    },
    credential_backend: c.adapter.credentials.backend,
    paths: { app_data_dir: c.paths.appDataDir, log_dir: c.paths.logDir },
    discovery: {
      selected: c.source?.dataDir ?? null,
      candidates: dataChecks,
      global_config: configChecks,
      global_config_selected: c.source?.globalConfigPath ?? null,
    },
    settings:
      settings === null ? null : { version: settings.version, categories: settings.categories },
    log_tail: logTail(c.paths.logDir),
  };
  const token = await c.adapter.credentials.get(DEVICE_TOKEN_KEY).catch(() => null);
  return token === null || token === '' ? report : (scrubSecret(report, token) as typeof report);
}
