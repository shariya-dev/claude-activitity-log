export type PlatformId = 'macos' | 'windows' | 'linux';

export interface DeviceInfo {
  hostname: string;
  platform: PlatformId;
  platformVersion: string;      // e.g. "26.0.1", "10.0.26100", "Ubuntu 24.04"
  architecture: string;         // os.arch(): arm64 | x64 | ...
  machineFingerprint: string;   // sha256 hex of OS machine id (IOPlatformUUID / MachineGuid / /etc/machine-id)
}

export interface CredentialStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  readonly backend: string;     // "keychain" | "dpapi" | "libsecret" | "file-0600" (diagnostics only)
}

export interface ServiceManager {
  install(opts: { nodePath: string; entryPath: string }): Promise<void>;
  uninstall(): Promise<void>;
  status(): Promise<'running' | 'installed' | 'not-installed' | 'unknown'>;
}

export interface PlatformAdapter {
  readonly id: PlatformId;
  claudeDataCandidates(): string[];     // ordered; honours CLAUDE_CONFIG_DIR first
  claudeGlobalConfigCandidates(): string[]; // e.g. ~/.claude.json
  appDataDir(): string;
  logDir(): string;
  deviceInfo(): Promise<DeviceInfo>;
  credentials: CredentialStore;
  service: ServiceManager;
  openUrl(url: string): Promise<void>;
  checkPermissions(paths: string[]): Promise<{ path: string; readable: boolean; hint?: string }[]>;
}
