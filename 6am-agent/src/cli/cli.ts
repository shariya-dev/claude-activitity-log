import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runAgent, type RunTimings } from '../app/agent.js';
import { createContainer, DEVICE_TOKEN_KEY, type AgentContainer } from '../app/container.js';
import { clearPairing, isPaired } from '../app/localState.js';
import { acquireLock, readLockHolder, type InstanceLock } from '../app/lock.js';
import { PairingError, registerDevice, runPairingSession } from '../app/pairing/pairingFlow.js';
import { collectDiagnostics, collectStatus, formatStatus } from './report.js';
import { AGENT_VERSION } from './version.js';

export interface CliDeps {
  createContainer: () => Promise<AgentContainer>;
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  /** The bundle the service launches (`agent.cjs`). */
  entryPath: string;
  /** The bundled Node runtime. */
  execPath: string;
  /** Aborted on SIGTERM/SIGINT by main.ts. */
  signal: AbortSignal;
  runTimings: Partial<RunTimings>;
}

const USAGE = `Usage: agent <command> [options]

Commands:
  run                  Run the agent (default; what the service launches)
  pair [code]          Pair this device (without a code: open the pairing page)
  status               Show pairing, sync and service status
  sync-now             Ask the agent to sync now
  diagnostics          Show diagnostics (no tokens or prompts)
  repair               Forget the pairing and pair again
  install-service      Install and start the background service
  uninstall-service    Remove the service and deregister the device

Options:
  --json               Machine-readable output (status, diagnostics)
  --version            Print the agent version
`;

const COMMANDS = new Set([
  'run',
  'pair',
  'status',
  'sync-now',
  'diagnostics',
  'repair',
  'install-service',
  'uninstall-service',
]);

type Io = Pick<CliDeps, 'stdout' | 'stderr'>;

function lockBusy(io: Io, pid: number | null): number {
  io.stderr(`The agent is already running (pid ${pid ?? 'unknown'}).\n`);
  return 1;
}

/** Holds the single-instance lock around `fn`; refuses when a live agent holds it. */
async function withLock(c: AgentContainer, io: Io, fn: () => Promise<number>): Promise<number> {
  const lock: InstanceLock | null = acquireLock(c.paths.lockFile);
  if (lock === null) return lockBusy(io, readLockHolder(c.paths.lockFile));
  try {
    return await fn();
  } finally {
    lock.release();
  }
}

/** Interactive pairing in this process: the loopback page, then the initial sync. */
async function pairInteractively(c: AgentContainer, d: CliDeps): Promise<number> {
  return withLock(c, d, async () => {
    const result = await runPairingSession(c, {
      signal: d.signal,
      pollMs: d.runTimings.pollMs,
      graceMs: d.runTimings.pairingGraceMs,
      onUrl: (url) => d.stdout(`Opening the pairing page: ${url}\n`),
    });
    if (result === 'aborted') {
      d.stderr('Pairing cancelled.\n');
      return 1;
    }
    d.stdout(
      `Paired. Initial sync sent ${c.counters.sessions} sessions and ${c.counters.usage} usage records.\n`,
    );
    return 0;
  });
}

async function cmdPair(c: AgentContainer, d: CliDeps, code: string | undefined): Promise<number> {
  if (code !== undefined) {
    try {
      const { developer } = await registerDevice(c, code);
      d.stdout(`Paired as ${developer}. Device ${c.state.get('device_uid') ?? ''}.\n`);
      return 0;
    } catch (err) {
      d.stderr(`${err instanceof PairingError ? err.message : 'Pairing failed.'}\n`);
      return 1;
    }
  }
  const holder = readLockHolder(c.paths.lockFile);
  if (holder !== null) {
    if (existsSync(c.paths.pairingUrlFile)) {
      const url = readFileSync(c.paths.pairingUrlFile, 'utf8').trim();
      await c.adapter.openUrl(url);
      d.stdout(`Opened the pairing page of the running agent: ${url}\n`);
      return 0;
    }
    d.stdout(`The running agent (pid ${holder}) is already paired. Use "repair" to pair again.\n`);
    return 0;
  }
  if (await isPaired(c)) {
    d.stdout(
      `Already paired as device ${c.state.get('device_uid') ?? ''}. Use "repair" to pair again.\n`,
    );
    return 0;
  }
  return pairInteractively(c, d);
}

async function cmdSyncNow(c: AgentContainer, d: CliDeps): Promise<number> {
  const holder = readLockHolder(c.paths.lockFile);
  if (holder !== null) {
    writeFileSync(c.paths.syncRequestFile, '');
    d.stdout(`Sync requested from the running agent (pid ${holder}).\n`);
    return 0;
  }
  return withLock(c, d, async () => {
    if (!(await isPaired(c))) {
      d.stderr('This device is not paired. Run "pair" first.\n');
      return 1;
    }
    if ((await c.discover()) === null) {
      d.stderr('Claude Code data was not found. Run "diagnostics" for details.\n');
      return 1;
    }
    const outcome = await c.sync.runOnce();
    const line = `Sync ${outcome.status}: ${outcome.batches} batches, ${outcome.accepted} accepted, ${outcome.rejected} rejected`;
    if (outcome.status === 'ok' || outcome.status === 'nothing') {
      d.stdout(`${line}.\n`);
      return 0;
    }
    d.stderr(`${line}${outcome.error === undefined ? '' : ` (${outcome.error.code})`}.\n`);
    return 1;
  });
}

async function cmdRepair(c: AgentContainer, d: CliDeps): Promise<number> {
  await clearPairing(c);
  const holder = readLockHolder(c.paths.lockFile);
  if (holder !== null) {
    d.stdout(
      `Pairing cleared. The running agent (pid ${holder}) will open the pairing page; run "pair" to reopen it.\n`,
    );
    return 0;
  }
  d.stdout('Pairing cleared.\n');
  return pairInteractively(c, d);
}

async function cmdUninstallService(c: AgentContainer, d: CliDeps): Promise<number> {
  await c.adapter.service.uninstall();
  d.stdout('Service removed.\n');
  if ((await c.adapter.credentials.get(DEVICE_TOKEN_KEY)) !== null) {
    try {
      await c.api.deregister();
      d.stdout('Device deregistered.\n');
    } catch (err) {
      c.logger.warn('deregister_failed', { error: err instanceof Error ? err.name : 'error' });
      d.stderr('Could not reach the server to deregister this device (ignored).\n');
    }
  }
  return 0;
}

async function dispatch(
  command: string,
  args: { json: boolean; code: string | undefined },
  d: CliDeps,
): Promise<number> {
  const c = await d.createContainer();
  try {
    switch (command) {
      case 'run':
        return await withLock(c, d, async () => {
          await runAgent(c, { signal: d.signal, timings: d.runTimings });
          return 0;
        });
      case 'pair':
        return await cmdPair(c, d, args.code);
      case 'status': {
        const status = await collectStatus(c);
        d.stdout(args.json ? `${JSON.stringify(status, null, 2)}\n` : formatStatus(status));
        return 0;
      }
      case 'sync-now':
        return await cmdSyncNow(c, d);
      case 'diagnostics':
        d.stdout(`${JSON.stringify(await collectDiagnostics(c), null, 2)}\n`);
        return 0;
      case 'repair':
        return await cmdRepair(c, d);
      case 'install-service':
        await c.adapter.service.install({ nodePath: d.execPath, entryPath: d.entryPath });
        d.stdout('Service installed.\n');
        return 0;
      case 'uninstall-service':
        return await cmdUninstallService(c, d);
      default:
        return 2;
    }
  } finally {
    c.close();
  }
}

function defaults(): CliDeps {
  return {
    createContainer: () => createContainer(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
    entryPath: path.resolve(process.argv[1] ?? 'agent.cjs'),
    execPath: process.execPath,
    signal: new AbortController().signal,
    runTimings: {},
  };
}

/** Parses argv (without `node agent.cjs`) and runs one command. Resolves the exit code. */
export async function runCli(argv: string[], deps: Partial<CliDeps> = {}): Promise<number> {
  const d: CliDeps = { ...defaults(), ...deps };
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        adapter: { type: 'string' },
      },
    });
  } catch (err) {
    d.stderr(`${err instanceof Error ? err.message : 'invalid arguments'}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    d.stdout(`6am-agent ${AGENT_VERSION}\n`);
    return 0;
  }
  if (values.help) {
    d.stdout(USAGE);
    return 0;
  }
  const command = positionals[0] ?? 'run';
  const expected = command === 'pair' ? 2 : 1;
  if (!COMMANDS.has(command) || positionals.length > expected) {
    d.stderr(USAGE);
    return 2;
  }
  // Dev builds only: the container ignores AGENT_ADAPTER on the stable channel.
  if (values.adapter !== undefined) process.env.AGENT_ADAPTER = values.adapter;

  try {
    return await dispatch(command, { json: values.json, code: positionals[1] }, d);
  } catch (err) {
    d.stderr(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
}
