import { createHash } from 'node:crypto';
import { accessSync, constants } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type {
  CredentialStore,
  DeviceInfo,
  PlatformAdapter,
  PlatformId,
  ServiceManager,
} from '../../src/platform/types.js';

/**
 * A PlatformAdapter with no OS integration. Used by unit tests and, in dev builds only, by
 * `AGENT_ADAPTER=fake` (H22 e2e). No vitest imports: this file is bundled into dev builds.
 */

export class MemoryCredentialStore implements CredentialStore {
  readonly backend = 'memory';
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }
}

export type ServiceStatus = Awaited<ReturnType<ServiceManager['status']>>;

export class FakeServiceManager implements ServiceManager {
  installs: { nodePath: string; entryPath: string }[] = [];
  uninstalls = 0;
  current: ServiceStatus = 'not-installed';

  install(opts: { nodePath: string; entryPath: string }): Promise<void> {
    this.installs.push(opts);
    this.current = 'installed';
    return Promise.resolve();
  }

  uninstall(): Promise<void> {
    this.uninstalls += 1;
    this.current = 'not-installed';
    return Promise.resolve();
  }

  status(): Promise<ServiceStatus> {
    return Promise.resolve(this.current);
  }
}

export interface FakeAdapterOptions {
  id?: PlatformId;
  /** Defaults to `$AGENT_DATA_DIR`, else `<tmp>/6am-agent-fake`. */
  appDataDir?: string;
  logDir?: string;
  /** Tried after `$CLAUDE_CONFIG_DIR` (as the real adapters do). Defaults to `~/.claude`. */
  claudeDataCandidates?: string[];
  claudeGlobalConfigCandidates?: string[];
  deviceInfo?: Partial<DeviceInfo>;
  credentials?: CredentialStore;
}

export class FakeAdapter implements PlatformAdapter {
  readonly id: PlatformId;
  readonly credentials: CredentialStore;
  readonly service = new FakeServiceManager();
  readonly openedUrls: string[] = [];
  private readonly dataDir: string;
  private readonly logsDir: string;
  private readonly dataCandidates: string[];
  private readonly configCandidates: string[] | null;
  private readonly info: DeviceInfo;

  constructor(o: FakeAdapterOptions = {}) {
    this.id = o.id ?? 'macos';
    this.credentials = o.credentials ?? new MemoryCredentialStore();
    this.dataDir =
      o.appDataDir ?? process.env.AGENT_DATA_DIR ?? path.join(tmpdir(), '6am-agent-fake');
    this.logsDir = o.logDir ?? path.join(this.dataDir, 'logs');
    this.dataCandidates = o.claudeDataCandidates ?? [path.join(homedir(), '.claude')];
    this.configCandidates = o.claudeGlobalConfigCandidates ?? null;
    this.info = {
      hostname: 'fake-host',
      platform: this.id,
      platformVersion: '1.0.0',
      architecture: 'arm64',
      machineFingerprint: createHash('sha256').update('6am-agent-fake-adapter').digest('hex'),
      ...o.deviceInfo,
    };
  }

  private envConfigDir(): string | null {
    const dir = process.env.CLAUDE_CONFIG_DIR;
    return dir === undefined || dir === '' ? null : dir;
  }

  claudeDataCandidates(): string[] {
    const env = this.envConfigDir();
    return env === null ? [...this.dataCandidates] : [env, ...this.dataCandidates];
  }

  claudeGlobalConfigCandidates(): string[] {
    const fallback = this.configCandidates ?? [path.join(homedir(), '.claude.json')];
    const env = this.envConfigDir();
    return env === null ? [...fallback] : [path.join(env, '.claude.json'), ...fallback];
  }

  appDataDir(): string {
    return this.dataDir;
  }

  logDir(): string {
    return this.logsDir;
  }

  deviceInfo(): Promise<DeviceInfo> {
    return Promise.resolve({ ...this.info });
  }

  openUrl(url: string): Promise<void> {
    this.openedUrls.push(url);
    return Promise.resolve();
  }

  checkPermissions(paths: string[]): Promise<{ path: string; readable: boolean; hint?: string }[]> {
    return Promise.resolve(
      paths.map((p) => {
        try {
          accessSync(p, constants.R_OK);
          return { path: p, readable: true };
        } catch {
          return { path: p, readable: false, hint: 'not found or not readable' };
        }
      }),
    );
  }
}

export function createFakeAdapter(o: FakeAdapterOptions = {}): FakeAdapter {
  return new FakeAdapter(o);
}
