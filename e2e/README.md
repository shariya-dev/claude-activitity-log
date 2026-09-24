# End-to-end sync harness (H22)

This suite runs the **real built agent** against the **real Laravel backend**, through a fault-injecting proxy. It checks the sync guarantees of `docs/contracts/sync-api-v1.md` and PRD §27–39 end to end. App code is never mocked:

- Agent: `6am-agent/dist/<host-target>/runtime/node app/agent.cjs`, built by `npm run build`.
- Backend: `php artisan serve`, using the real `App\Actions\*` classes.

The database is MySQL.

```sh
cd e2e && npm ci && npm test        # about 1.5 min; the Sync Now scenario waits for one 60 s heartbeat
```

## Requirements

- macOS or Linux, with Node ≥ 24 and PHP 8.x plus `pdo_mysql` on `PATH`.
- MySQL reachable on `127.0.0.1:8889` as `root`/`root` (the MAMP defaults). Override with `E2E_DB_HOST`, `E2E_DB_PORT`, `E2E_DB_USERNAME` and `E2E_DB_PASSWORD`.
- Ports **8765** (backend) and **8766** (proxy) must be free.
- The first run downloads the Node 24 runtime into `6am-agent/.cache/node/` (SHA-256 verified by the agent build). If `agent-dashboard/vendor` or `6am-agent/node_modules` is missing, the first run also runs `composer install` or `npm ci`.

## What it sets up

`globalSetup.ts` runs once per run:

1. Creates the database **`claude_monitor_e2e`** and confirms that the app resolves to it. Only then does it run `migrate:fresh`, which never touches `claude_monitor` or the test DBs.
2. Creates an admin user and applies the baseline tracking settings through `UpdateTrackingSettings`:
   - `initial_sync_range: all`, so the fixtures' fixed dates are always in range.
   - `sync_interval_seconds: 3600`, so a sync happens only at start, on Sync Now, or on the local signal.
   - `heartbeat_interval_seconds: 60`.
   - `min_agent_version: 1.0.0` (the contract default), which the 1.0.0 agent meets.
3. Starts `php artisan serve --port 8765 --no-reload` with 4 workers. The environment is passed in: DB, a random `APP_KEY`, `QUEUE_CONNECTION=sync`, and `CACHE_STORE=database`, `LOG_CHANNEL=stderr` and `MAIL_MAILER=array`. Laravel still loads `agent-dashboard/.env` if one exists, but every key that could send the run to a shared store is pinned here. The harness never writes `.env`.
4. Builds the agent for the host target. The dev build-config points at the proxy (`http://127.0.0.1:8766`). The build writes to `6am-agent/dist/<host-target>/`, replacing any build there; `scripts/build.ts` has no output-dir option. Don't point an installed service at that directory on a machine that runs this suite.

`setup.ts` runs `createScenario(name)` once per scenario file. Each scenario gets:

- Its own developer, with a pairing code issued through `IssuePairingCode`, and so its own device row.
- Baseline settings re-applied, and the rate limiters cleared: every agent comes from 127.0.0.1, and `/register` allows 10 per minute per IP.
- Temp directories under the OS temp dir: `HOME`, `CLAUDE_CONFIG_DIR` and `AGENT_DATA_DIR`. `CLAUDE_CONFIG_DIR` is built from the H02 fixtures in `6am-agent/test/fixtures/claude/`:
  - `basic-session`, `subagent`, `multi-model`, `malformed` and `split-usage-growing`, under `projects/-home-dev-projects-demo-app/`
  - `claude.json` as `.claude.json`
- The proxy on :8766, which captures every request and answer.

The agent runs with a minimal environment:

- `HOME` = temp home
- `CLAUDE_CONFIG_DIR` = temp Claude dir
- `AGENT_DATA_DIR`
- `AGENT_CREDENTIAL_BACKEND=file` (a 0600 file store)
- `AGENT_API_BASE_URL` = proxy
- `AGENT_ALLOW_INSECURE_LOCALHOST=1`

It uses the real platform adapter; there is no fake adapter.

Helpers: `appendLines(file, lines)`, `scn.dbCount(table)`, `scn.sql(query)`, `scn.agent(cmd)`, `scn.startAgentDaemon()` → `stop()` / `kill()`, `scn.checkpoints()` / `scn.kv()` (read-only `state.db`), and `scn.captures(path)`. `lib/lines.ts` builds new transcript lines in the fixtures' shape.

### Safety: the real Claude data is never touched

- `assertTempClaudeDir` fails a scenario unless `CLAUDE_CONFIG_DIR` resolves under the OS temp dir and is not `~/.claude` or `~/.config/claude`.
- The agent's `HOME` is a temp dir, so its `~/.claude` and `~/.claude.json` fallbacks point into the temp dir as well.
- `startAgentDaemon()` refuses to start an unpaired agent, because pairing mode would open a browser. A daemon that loses its pairing while running would also open one (through `/usr/bin/open`). No scenario lets that happen today: the disable scenario uses one-shot commands only. Keep it that way when F2 is fixed.
- Every temp dir is removed after its scenario and after the run. Set `E2E_KEEP=1` to keep them for debugging.

### Proxy (`lib/proxy.ts`)

| Mode | Effect |
|---|---|
| `pass` | Forward the request and return the backend's answer |
| `down` | Drop the connection. Nothing reaches the backend. |
| `500` | Answer a retryable `persistence_failed` envelope. Nothing reaches the backend. |
| `slow` | Forward at once, so the backend commits; deliver its answer after `delayMs` |
| `drop-response` | Forward, so the backend commits; then drop the connection. The agent never sees the answer. |

A fault can be limited to one path (`only`) and to a number of requests (`times`). `setHeaders()` injects request headers, for example `X-Forwarded-For`. `lib/proxy.test.ts` checks every mode against a throwaway upstream. `npm run proxy` runs it standalone (8766 → 8765).

## Scenarios → acceptance criteria

| # | File | What it proves | PRD §61 AC / sections |
|---|---|---|---|
| 1 | `01-pair-and-initial-sync` | `pair <code>`, then `run` discovers the temp Claude dir and syncs on its own. Sessions, usage (deduped by `message.id`), per-session and total tokens, projects, models, account link and device fields match the fixture contract (`expected/*.json`). `actual`/`total` are computed by the backend only; the agent sends raw counts. Prompt OFF: no prompt text is sent or stored. A truncated last line stays uncommitted. | AC8, AC9, AC11, AC12, AC18–AC25 (AC28, AC29 by default) |
| 2 | `02-incremental` | New lines in an existing session, a completed partial line and a new session file. Only those records are sent, only new rows are stored, the touched sessions' totals grow, untouched sessions are unchanged, and a sync with nothing new sends nothing. | AC11, AC12 · PRD §16, §29 |
| 3 | `03-duplicate-sync` | `drop-response` on the first sync: the backend commits, and the agent retries. **Account OFF:** same `batch_id`, a byte-identical body, the stored response replayed verbatim, one `sync_batches` row and no duplicate rows. **Account ON:** still no duplicate rows (see F1). | AC16 · contract §8 |
| 4 | `04-failed-sync` | Proxy `500`: `state.db` checkpoints, cursor and sequence are unchanged (both on the initial sync and later), and nothing is stored. Switching back to `pass` catches up exactly. | AC17 · PRD §30, §39, §55 |
| 5 | `05-offline-recovery` | Proxy `down` while lines are appended to two sessions, with the service running. No checkpoint moves. After `pass`, every offline record arrives, with no loss. | AC14 · PRD §27, §55 |
| 6 | `06-agent-restart` | `kill -9` while a sync is in flight (`slow`). The backend has committed but the agent never recorded the ack. The restart succeeds over the stale lock, re-sends with a new `batch_id`, and the upserts absorb the overlap: no loss and no duplicates. | AC16 · PRD §27, §55 · contract §8.2 |
| 7 | `07-device-disable` | `DisableDevice` (the dashboard action): the backend refuses the agent (401), stores nothing, and keeps the device row and all its history. A repair code (`IssuePairingCode`, purpose `repair`) reactivates the **same** device row, which then syncs the pending lines without duplicates. | AC39 (disable; uninstall/deregister is not exercised) · PRD §11, §35 (see F2) |
| 8 | `08-settings-change` | Prompt tracking OFF by default. Turning it ON (admin action) → the next heartbeat carries the new settings version → the next sync carries the new prompt, and the backend stores it encrypted. Text scanned while OFF is not backfilled. Turning it OFF → no prompt text in any captured request, and none stored. | AC27, AC28, AC29 · contract §5 |
| 9 | `09-network-identity` | Network ON. Register and sync with `X-Forwarded-For` 203.0.113.10, then reinstall (agent data wiped) and re-register with 198.51.100.77. The same fingerprint gives one device row (same id, `device_uid` and `first_seen_at`) and one developer, and the full re-send creates no duplicates. | AC13 · PRD §26 (see F4) |
| 10 | `10-sync-now` | `RequestManualSync` (the dashboard action): nothing happens until the next heartbeat. That heartbeat answers `sync_requested: true`, the running agent syncs at once, and the flag is cleared (one-shot and audited). | PRD §51 · contract §3.3 |

AC15 (no queue infrastructure) is covered only implicitly: the whole suite runs with `QUEUE_CONNECTION=sync` and no worker, and every scenario's data is stored within its HTTP request.

## Findings (product bugs; follow-ups, not fixed here)

Each known bug has an `it.fails('KNOWN BUG Fn: …')` test that asserts the **contract** behaviour. The test shows as an expected failure today and turns red once the bug is fixed; then change it to `it`.

- **F1: a retried batch is never the same batch while Account is ON (agent, H09/H10).** `core/claude/accountReader.ts` sets `AccountRecord.observed_at` to the scan time, so every re-scan builds a different `accounts[]`. The retry therefore gets a new `batch_id`, which violates contract §8.2 ("a retry of the same chunk MUST reuse the same `batch_id` and byte-for-byte identical records"). The backend then reprocesses the batch instead of replaying it, and the stored-response replay path is unreachable with default settings. No data is duplicated, because the upserts absorb it. Suggested fix: derive `observed_at` from the scanned lines, not the clock (for example, the newest line timestamp in the chunk). Test: `03-duplicate-sync` › Account ON.
- **F2: an agent 401 is not the contract error envelope (backend, H05/H06).** Every authenticated agent endpoint (`/sync`, `/heartbeat`, `/settings`, `/sync/status`, `/deregister`) answers a missing, bad or revoked token with Laravel's default `401 {"message":"Unauthenticated."}` instead of the §9.1 envelope with `code: unauthenticated`. The default `AuthenticationException` rendering answers first (apparently `auth:sanctum` runs before `device.active` after middleware-priority sorting), so `device.active`'s envelope is never reached. The agent therefore classifies the response as `invalid_response` (retryable), stays `ok` and keeps retrying with backoff; it never enters `needs_repair` as §9.2 requires. After a dashboard **Disable**, the agent keeps calling `/sync`, capped at 15 min. Test: `07-device-disable`.
- **F3: 429 is not the contract error envelope (backend, H05).** `/register`'s throttle (10/min/IP) answers `429 {"message":"Too Many Attempts."}`, with `Retry-After`, instead of the `rate_limited` envelope, so the agent reports `Pairing failed (invalid_response)`. The authenticated throttles use the same Laravel default. This harness clears the rate limiters between scenarios.
- **F4: the backend sees every agent request as coming from the proxy (deployment config, H05).** `bootstrap/app.php` configures no trusted proxies, so `X-Forwarded-For` is ignored. `devices.last_public_ip` and the `ip_address` in audit logs hold the proxy's address. Scenario 09 therefore changes the source IP only as the proxy sees it; the backend records `127.0.0.1` for both registrations, which the test asserts. Device identity still never depends on IP, which is AC13's point. Behind a production reverse proxy, the Network category would record the proxy's IP unless `trustProxies` is configured.
- **Spec note (H22 text vs H05):** H22 expects "the agent gets 403" after Disable. `DisableDevice` (H05) revokes the device's tokens by design, so the backend answers 401. `403 device_disabled` is only reachable while a disabled device still holds a valid token, which the dashboard action never leaves behind.
- **Housekeeping:** the agent build's runtime cache, `6am-agent/.cache/`, is not git-ignored.
