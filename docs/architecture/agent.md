# Desktop Agent Architecture (`6am-agent/`)

Responsibility (PRD §62): **Collect → Detect → Normalize → Sync.** The agent never calculates authoritative tokens, never aggregates for reporting, never stores history. It is not a second backend.

## 1. Runtime & packaging

| Concern | Choice |
|---|---|
| Language | TypeScript 5.x, `strict: true`, ESM source |
| Runtime | Node.js 24 LTS, **bundled** with each installer (official Node binary per OS/arch) |
| Bundle | `esbuild` → single `dist/agent.cjs` (no `node_modules` shipped) |
| Local state | SQLite through built-in `node:sqlite` (`DatabaseSync`). H01 verifies it loads without flags on Node 24 on all three OSes; if not, fall back to `better-sqlite3` with prebuilt binaries per target and record the decision in `6am-agent/CLAUDE.md` |
| HTTP | built-in `fetch` (undici); HTTPS enforced (reject `http:` unless `AGENT_ALLOW_INSECURE_LOCALHOST=1` for dev against `127.0.0.1`) |
| Validation | `zod` (the only runtime dependency) |
| CLI parsing | `node:util` `parseArgs` |
| Logging | small internal rotating file logger (`logs/agent.log`, 5 × 1 MB), JSON lines, **never logs tokens/prompts/credentials** |
| Tests | `vitest`; fixtures are sanitized real JSONL from H02 |
| Lint/format | `eslint` (typescript-eslint) + `prettier` |

Install layout (per user, no admin required where the OS allows):

```
<install_dir>/runtime/node(.exe)     bundled Node 24
<install_dir>/app/agent.cjs          esbuild bundle
<install_dir>/app/build-config.json  { "apiBaseUrl": "https://monitor.6amtech.com", "channel": "stable" }
<app_data_dir>/state.db              SQLite (checkpoints + config)
<app_data_dir>/logs/agent.log
```

| OS | install_dir | app_data_dir | Service | Installer |
|---|---|---|---|---|
| macOS | `~/Library/Application Support/6amAgent/` (pkg installs to `/Library/Application Support/6amAgent` + per-user data) | `~/Library/Application Support/6amAgent/` | `~/Library/LaunchAgents/com.6amtech.agent.plist` (`RunAtLoad`, `KeepAlive`) | `.pkg` (pkgbuild/productbuild; postinstall bootstraps LaunchAgent for console user) |
| Windows | `%LOCALAPPDATA%\Programs\6amAgent\` | `%LOCALAPPDATA%\6amAgent\` | Per-user Scheduled Task "6amAgent" (trigger: At logon; restart on failure every 1 min, 999×; hidden) | Inno Setup per-user `.exe` (no admin) |
| Linux | `~/.local/share/6am-agent/` (package: `/opt/6am-agent/`) | `~/.local/state/6am-agent/` | `~/.config/systemd/user/6am-agent.service` (`Restart=always`), `systemctl --user enable --now` | `.deb` + `.rpm` via `nfpm`, and `.tar.gz` + `install.sh` |

Signing/notarization (Apple Developer ID, Windows Authenticode) is an ops prerequisite tracked in H24; builds must work unsigned for internal testing.

## 2. Module structure

```
6am-agent/
├── src/
│   ├── cli/main.ts                  entry: run | pair | status | sync-now | diagnostics | install-service | uninstall-service
│   ├── app/                         composition root (wires core + adapter) — H11
│   │   ├── container.ts
│   │   └── pairing/localPairingServer.ts   127.0.0.1-only one-page pairing UI
│   ├── core/                        OS-agnostic. MUST NOT import from src/platform/<os>/
│   │   ├── contract/                zod schemas + TS types of sync-api-v1 (H03) — single source for payload shapes
│   │   ├── claude/                  H09: Claude data reader
│   │   │   ├── discovery.ts         validate candidate dirs from adapter → ClaudeDataSource
│   │   │   ├── transcriptFiles.ts   enumerate projects/*/*.jsonl + */subagents/*.jsonl
│   │   │   ├── jsonlTailReader.ts   incremental read from byte offset, complete lines only
│   │   │   ├── lineParser.ts        line → typed event (tolerant, unknown types ignored)
│   │   │   ├── accountReader.ts     ~/.claude.json oauthAccount → AccountRecord | null
│   │   │   └── scanner.ts           implements ScanSource: checkpoints + settings → ScanChunk stream
│   │   ├── detect/                  H09: session/project/model/usage normalization, dedup by message.id
│   │   ├── settings/settingsManager.ts   H10: fetch/cache tracking settings, version check
│   │   ├── state/stateStore.ts      H10: SQLite (kv + file_checkpoints)
│   │   ├── sync/                    H10: apiClient.ts, syncManager.ts, backoff.ts, heartbeat.ts, batcher.ts
│   │   └── runtime/                 H10: scheduler loop, logger, buildConfig loader, errors
│   └── platform/
│       ├── types.ts                 PlatformAdapter, CredentialStore, ServiceManager (H01, frozen)
│       ├── index.ts                 selectAdapter(process.platform) (H01)
│       ├── darwin/                  H12
│       ├── win32/                   H13
│       └── linux/                   H14
├── packaging/{macos,windows,linux}/ H12/H13/H14
├── scripts/build.ts                 esbuild + runtime download/verify per target (H11)
└── test/{unit,fixtures}/
```

### Platform adapter interface (frozen in H01; changing it requires a new handover)

```ts
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
```

Claude Code version is read from the newest transcript line's `version` field (cross-platform, no process spawn).

## 3. Runtime loop (PRD §32)

```
start → load build-config + state.db → credentials? ─no─► pairing mode (loopback page + open browser; CLI `pair <code>`)
                                          │yes
                                          ▼
  every tick (60 s):  heartbeat due? (5 min) → POST heartbeat (response may carry settings_version, sync_requested)
                      settings stale/version changed? → GET settings
                      sync due? (settings.sync_interval_seconds, default 120) or sync_requested
                          → scanner.scan(checkpoints, settings)  (stat-based: only files whose size/mtime changed)
                          → batcher: ≤ 500 usage records / ≤ 1 MB per batch, file-ordered
                          → POST sync (batch_id uuid, reused on retry)
                          → 2xx success ⇒ commit checkpoints for that batch in one SQLite tx, store server cursor
                          → error ⇒ keep checkpoints, backoff 30s·2^n (cap 15 min, ±20% jitter)
```

Error handling map (PRD §55): no internet / 5xx / timeout → backoff; 401 → stop syncing, state `needs_repair`, heartbeat stops, pairing page available; 403 `device_disabled` → stop syncing, re-check heartbeat hourly; 422 → log `contract_violation`, backoff (never skip data silently); 426 → state `update_required`; Claude data missing → state `claude_data_unavailable`, re-discover every 10 min; unreadable file → skip that file this cycle with diagnostic, do not advance its checkpoint; unparseable line → skip line (counted in diagnostics), continue.

## 4. Agent guardrails

- `src/core/**` must not import `src/platform/<os>/**` or call `process.platform` (eslint `no-restricted-imports` + `no-restricted-properties`).
- Read-only on Claude data. Never write, lock, or move files under Claude's directories.
- Read only: `<claudeDataDir>/projects/**/*.jsonl`, `~/.claude.json` (only `oauthAccount` + nothing else retained), and `<cwd>/.git/config` + `<cwd>/.git/HEAD` **only when Git tracking is ON**.
- Tracking settings are applied **before** building payloads; a disabled category's fields are never populated in memory objects destined for the payload.
- Prompt extraction code path executes only when `settings.prompt === true`.
- No token math in the agent beyond passing raw integers.
- SQLite holds only: `kv` (device_uid, server_cursor, settings json, settings_version, last_settings_sync_at, last_success_sync_at, last_failure_at, agent_version, state) and `file_checkpoints` (path, file_identity, size, mtime_ms, offset, updated_at). No records, no prompts.
- Secrets (device token) only in `CredentialStore`; never in SQLite, logs, argv, or env of child processes.
- CPU: stat-only scan when nothing changed; never re-read a file from 0 unless its identity changed or it shrank.
- Runtime dependency budget: `zod` only. New runtime deps require a note in the handover and reviewer approval.
