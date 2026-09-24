# H18 — Agent App: Composition Root, CLI, Pairing UX, Build Pipeline
Status: done (9a13a8e) · Wave 5 · parallel with H19–H21 (and may overlap Wave 4) · Branch `handover/H18-agent-app`

## Objective
Wire core (H09 reader + H10 engine) with the selected platform adapter into a runnable agent: CLI commands, first-run pairing (a loopback page plus `pair <code>`), startup discovery flow, diagnostics, and a build that produces the per-target payload layout the installers package.

## Read first
`docs/architecture/agent.md` (all), `6am-agent/CLAUDE.md`, H09/H10 interfaces, `src/platform/types.ts`, PRD §5, §8–9, §13, §32, §51.

## Depends on
H09, H10 (and H01 adapter stubs). Adapters may still be stubs. Tests use a fake `PlatformAdapter`.

## Owned files
`6am-agent/src/app/**`, `src/cli/**`, `scripts/build.ts`, `build-config.example.json`, `test/unit/app/**`, `test/unit/cli/**`, `test/helpers/fakeAdapter.ts`.

## Allowed dependencies
None new. (Downloading Node runtimes in `scripts/build.ts` uses `fetch` + `node:crypto` SHA-256 verification against nodejs.org `SHASUMS256.txt`.)

## Interfaces produced
```ts
// src/app/container.ts
export interface AgentContainer { adapter: PlatformAdapter; state: StateStore; api: ApiClient; runtime: ReturnType<typeof createAgentRuntime>; source: ClaudeDataSource | null; logger: Logger; buildConfig: BuildConfig }
export async function createContainer(o?: { adapter?: PlatformAdapter; buildConfigPath?: string; fetchImpl?: typeof fetch }): Promise<AgentContainer>
export interface BuildConfig { apiBaseUrl: string; channel: 'stable' | 'dev' }   // read from <install_dir>/app/build-config.json next to agent.cjs
```
Dev-only overrides (ignored when `channel='stable'`), required by H22: `AGENT_API_BASE_URL`, `AGENT_DATA_DIR` (app data + logs), `AGENT_CREDENTIAL_BACKEND=file` (forces a 0600 file store in `AGENT_DATA_DIR`), `AGENT_ADAPTER=fake` (uses `test/helpers/fakeAdapter.ts`, bundled only in dev builds).

## CLI (`node agent.cjs <command>`; `src/cli/main.ts`, `parseArgs`)
- `run` (default; what the service launches): single-instance lock (`<app_data_dir>/agent.lock` with pid + stale detection). If unpaired, start pairing mode. Otherwise discover Claude data (retry every 10 min while unavailable, heartbeat still reports `claude_data_unavailable`), then `runtime.start()`. Handles SIGTERM/SIGINT gracefully (finishes the current HTTP request ≤ 10 s, closes SQLite).
- `pair [code]`: with a code, register non-interactively (used by installers when they collect the code). Without one, start the loopback pairing server and open the browser.
- `status`: paired?, device id, backend host, agent state, Claude data dir, last sync/success/failure, settings version, service status (adapter). Human-readable; `--json`.
- `sync-now`: when the service is running, signal it (touch `<app_data_dir>/sync-request` file watched by the runtime → `requestSync()`); otherwise run one `runOnce()` in-process.
- `diagnostics`: status + discovery candidates with readable flags (`adapter.checkPermissions`), credential backend, log tail (redacted), versions. **No** tokens/prompts.
- `repair`: clears credentials + device_uid and checkpoints (history on the server is untouched; re-sync is idempotent), then pairing mode.
- `install-service` / `uninstall-service`: delegate to `adapter.service` with `process.execPath` + the bundle path. `uninstall-service` also calls `api.deregister()` best-effort.
- `--version`.

## Pairing flow
Loopback server on `127.0.0.1:<random port>` with a one-time URL token. A single page (inline HTML/CSS, no external assets) has a code input, then shows "Paired as <developer name>… detecting Claude Code… initial sync: N sessions, N usage records" progress, polling a local JSON status endpoint. It shuts down after success. `register()` sends `adapter.deviceInfo()` + versions. On success: `credentials.set('device_token')`, `state.set('device_uid', settings, ...)`, run the initial scan with `since` from settings, then continue into `run`. Errors show the backend's generic message. PRD §5: this is the only interactive step.

## Build (`npm run build -- --target <os-arch>|--all`)
Targets: `darwin-arm64`, `darwin-x64`, `win-x64`, `win-arm64`, `linux-x64`, `linux-arm64`. Output per target: `dist/<target>/runtime/node[.exe]` (Node 24 LTS, SHA-256 verified, cached in `.cache/node/`), `dist/<target>/app/agent.cjs`, `dist/<target>/app/build-config.json` (from `--config <file>`, required for release builds; defaults to `build-config.example.json` for dev), `dist/<target>/VERSION`. This layout is the contract consumed by H19–H21.

## Tests
Container wiring with a fake adapter + fake fetch: unpaired ⇒ pairing mode, paired ⇒ runtime started. Pairing server: binds 127.0.0.1 only, rejects a wrong URL token, successful pair stores credentials via the adapter and not in SQLite. Single-instance lock. `sync-now` file signal triggers `requestSync`. `diagnostics --json` contains no `token` values (assert). Build: `--target linux-x64` with a mocked download produces the layout (unit test of the layout function; real download in validation).

## Validation
`cd 6am-agent && npm test && npm run lint && npm run typecheck && npm run build -- --target darwin-arm64 && dist/darwin-arm64/runtime/node dist/darwin-arm64/app/agent.cjs --version`. Local smoke against the backend: `php artisan serve` + `AGENT_ALLOW_INSECURE_LOCALHOST=1`, a dev build-config pointing to `http://127.0.0.1:8000`, issue a code in the dashboard, `pair <code>` using a temporary `CLAUDE_CONFIG_DIR` copied from the H02 fixtures, then `status`. Paste the output. (The macOS adapter may still be a stub here; the smoke uses `--adapter fake` only if H19 isn't merged; document which.)

## Acceptance criteria
AC7 (only pairing is interactive), AC8/9 via discovery at startup, AC12 via runtime · Sync Now/status/diagnostics/re-pair exist but are optional (PRD §5).

## Review checklist
No OS branching outside `selectAdapter` · secrets only in CredentialStore · pairing page loopback-only · runtime checksums verified.

## Commit
`feat(H18): agent composition root, cli, pairing flow and per-target build`
