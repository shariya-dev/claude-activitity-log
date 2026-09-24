# Cross-Platform Validation Matrix (PRD §58 Phase 7, H24)

Status: **macOS run 2026-09-24 (partial: no `.pkg` install, no reboot)** · **Windows 11, Ubuntu 24.04 and Fedora pending operators**.

This is the record of the PRD Phase 7 checks on real machines. A cell holds the result, the evidence, the tester and the date. Evidence contains counts, statuses and exit codes only. It never contains emails, names, hostnames, home or project paths, session ids or prompt text.

| Result | Meaning |
|---|---|
| PASS | observed working as specified |
| FAIL | observed not working; linked to a follow-up (§6) |
| PARTIAL | the parts that could run passed; the note says what did not run |
| NOT RUN | not executed; the note says why and who runs it |

## 1. Test machines

| | macOS | Windows | Ubuntu | Fedora |
|---|---|---|---|---|
| OS | macOS 26.3.1 (25D771280a) | Windows 11 x64 — pending | Ubuntu 24.04 — pending | Fedora (RPM) — pending |
| Hardware | Apple M4, 10 cores, 16 GB RAM | — | — | — |
| Claude Code | 2.1.274 on PATH; transcripts written by up to 2.1.280 (VS Code extension) | — | — | — |
| Agent build | 0.1.0, dev channel, bundled Node v24.21.0, SQLite 3.53.4 | — | — | — |
| Backend | local Laravel (`php artisan serve`) on a scratch MySQL DB, dropped afterwards | — | — | — |
| Tester | Claude Code agent (H24 implementer) | operator to fill in | operator to fill in | operator to fill in |

**How the macOS run differed from a real install.** The payload in `6am-agent/dist/darwin-arm64` was paired and registered as a LaunchAgent with `agent.cjs install-service`. The `.pkg` was built and inspected, but not installed, because installing needs `sudo`. The dev build talks `http://127.0.0.1`, which the agent allows only with `AGENT_ALLOW_INSECURE_LOCALHOST=1`, so that variable was set with `launchctl setenv` for the run (FU-4). The machine was not rebooted and its network was not changed.

## 2. Matrix

All macOS cells: tester Claude Code agent (H24 implementer), 2026-09-24, local time +06. Windows, Ubuntu and Fedora cells: **NOT RUN — pending operator**; tester not yet assigned, run not yet scheduled (status as of 2026-09-24). The operator runs §5 and replaces the cell with the result, their name and the date.

| # | Check | macOS | Windows | Ubuntu | Fedora |
|---|---|---|---|---|---|
| 1 | Installation | **PARTIAL.** Built `6amAgent-0.1.0-arm64.pkg` (39.5 MB, unsigned; `pkgutil --check-signature`: no signature). Payload: `current → 0.1.0`, `runtime/node` 0755, `app/agent.cjs`, `app/build-config.json`, `VERSION`, `uninstall.sh`; install location `/Library/Application Support/6amAgent`; `hostArchitectures=arm64`, macOS 13+. Not installed (needs sudo). `install-service` from the payload: exit 0, launchd `state = running`. 13:04–13:06 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 2 | Pairing | **PASS.** `agent.cjs pair <code>` exit 0 → 1 device row (active, macos, arm64, 0.1.0), 1 token, code marked used. Keychain item `com.6amtech.agent` exists (secret never read). 13:06 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 3 | Claude detection | **PASS.** `diagnostics`: Claude Code 2.1.280 detected (version of the newest transcript line), platform macos 26.3.1 arm64, credential backend keychain. 13:05 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 4 | Data detection | **PASS.** `diagnostics`/`status`: data dir `~/.claude` readable, global config `~/.claude.json` found. 13:07 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 5 | Initial sync | **FAIL out of the box → FU-1.** Range: the default initial-sync range is 7 days; the 304 synced sessions (of 624 on disk) are consistent with that window. First `sync-now`: HTTP 426 `agent_outdated`, state `update_required`, because `min_agent_version` defaults to 1.0.0 and the agent is 0.1.0. After an admin set it to 0.1.0: 54 batches, 27,145 accepted, 0 rejected, ~13 s; 304 sessions, 26,519 usage rows, 77 projects, 5 models, 1 account, 0 messages (prompt tracking OFF), 54 batches `succeeded`. 13:06:46–13:06:59 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 6 | New sessions | **PASS.** `claude -p "Reply with the single word ok."` in a scratch dir, `sync-now`: sessions 304 → 305, projects 77 → 78, 1 usage row (in 2, out 4, cache_creation 17,308, cache_read 19,670) equal to the transcript after per-`message.id` max merge. 13:10 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 7 | Updated sessions | **PASS.** `claude -p "Reply ok." --continue` appended to the same file; same session row, 2 usage rows (second 2 / 4 / 36 / 36,978, equal to the transcript), still 1 row for that session id. 13:11 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 8 | Projects | **PASS.** One project per distinct `cwd` (78 after the new session); the scratch dir appeared as its own project. 13:10 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 9 | Models | **PASS.** 5 models stored dynamically; `<synthetic>` not stored. 13:10 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 10 | Token usage | **PASS.** Input, output, cache creation and cache read stored in separate columns; actual/total consistent on every row; three spot checks equal the transcripts exactly. 13:10–13:14 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 11 | Cache handling | **PASS.** 26,411 of 26,519 usage rows have cache_read > 0, kept separate from actual consumed tokens (e.g. session totals actual 17,356, total 74,004). 13:11 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 12 | Offline periods | **PASS.** Server stopped (`/up` → 000), new `claude -p` session, `sync-now` → `sync_failed code=network`, backoff retry at +30 s also failed. Checkpoints unchanged (995 files, no checkpoint for the new file), cursor sequence 59. 13:12–13:13 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 13 | Internet recovery | **PASS.** Server restarted: sync ok, 53 accepted, checkpoints 997, cursor 60; the offline session arrived once (1 session, 1 usage row equal to the transcript), 0 duplicates. 13:14 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 14 | Duplicate sync | **PASS.** Two `sync-now` runs without new test activity: 0 duplicate usage keys, 0 duplicate sessions, 1 device. Global counts rose slightly only because other live Claude sessions on the Mac kept writing. 13:11 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 15 | Failed sync | **PASS.** Server run with a wrong DB password → HTTP 500; agent logged a retryable `invalid_response`; checkpoints, cursor (59) and last-success time unchanged; recovered as in row 13. (The 500 body is Laravel's default, not `persistence_failed`; see FU-2.) 13:13 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 16 | Agent restart | **PASS.** `launchctl kickstart -k gui/<uid>/com.6amtech.agent`: clean stop (exit 0), new pid; first sync after restart incremental (15 accepted, not initial); heartbeat updated `last_seen_at`; 0 duplicates, 1 device. 13:15 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 17 | OS restart | **NOT RUN** (the tester cannot reboot this machine). The plist has `RunAtLoad` true, `KeepAlive {SuccessfulExit false}`, `ThrottleInterval` 30. Operator: reboot and log in, then run §5.1 step 4. | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 18 | Device disable | **FAIL → FU-2.** History kept (all counts identical), but the agent never learns it is disabled: `DisableDevice` revokes the tokens, so the backend answers 401 with Laravel's `{"message":"Unauthenticated."}` instead of the contract's `403 device_disabled`. The agent treats it as a retryable `invalid_response`, retries every 30–60 s and `status` still shows "Agent state: ok". Re-enable + re-pair kept the same device row and resumed incrementally (33 accepted, 0 duplicates). 13:17–13:19 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 19 | Settings changes | **PASS.** Admin changed `sync_interval_seconds` 120 → 90 (settings version 3; prompt, git and network stayed OFF). Next sync logged `settings_updated version 3`; the following sync ran 90.2 s later. 13:15–13:16 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 20 | No Node/npm preinstalled | **PARTIAL.** With `env -i HOME=… PATH=/usr/bin:/bin`, `command -v node` and `command -v npm` found nothing and the payload's `runtime/node` + `agent.cjs --version` ran (exit 0). The LaunchAgent runs the bundled `runtime/node`. A Mac with no Node at all was not available. 13:05 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 21 | No console window (Windows only) | n/a | NOT RUN — pending operator | n/a | n/a |
| 22 | Network switch does not create a device | **PARTIAL.** The network was not changed. The device count stayed 1 across restart, re-pair, disable/enable and offline/online. Agent calls authenticate by device token; re-register matches on developer + machine fingerprint (`RegisterDevice`); the IP is stored only with Network tracking ON (`RecordHeartbeat`). Operator: switch Wi-Fi ↔ hotspot/VPN and check the device count. | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |
| 23 | Uninstall keeps history | **PASS.** `agent.cjs uninstall-service`: "Service removed. Device deregistered." exit 0; `launchctl print` exit 113; device `uninstalled` with `uninstalled_at`; every count unchanged (306 sessions, 26,704 usage rows, 78 projects, 5 models, 64 batches). The Keychain item and `state.db` stay until `uninstall.sh` runs, as the macOS README documents. The `.pkg` uninstaller (`uninstall.sh`, needs sudo) was not run. 13:20 | NOT RUN — pending operator | NOT RUN — pending operator | NOT RUN — pending operator |

### Acceptance criteria per OS (PRD §61)

| AC | macOS | Windows | Ubuntu | Fedora |
|---|---|---|---|---|
| AC1–AC3: agent works on the OS | PARTIAL (rows 1–23; FU-1, FU-2 open) | pending | pending | pending |
| AC4/AC5: same backend, same data model | PASS (the macOS agent synced into the platform-neutral schema) | pending | pending | pending |
| AC6: no manual runtime install | PARTIAL (row 20) | pending | pending | pending |
| AC10: starts in the background | PARTIAL (LaunchAgent PASS; reboot not run, row 17) | pending | pending | pending |
| AC13: network changes create no duplicates | PARTIAL (row 22) | pending | pending | pending |
| AC14: offline activity syncs after reconnect | PASS (rows 12–13) | pending | pending | pending |

## 3. Resource usage (PRD §57; target < 1 % CPU idle, < 120 MB RSS)

Measured on the bundled Node agent with `ps -o %cpu=,rss= -p <pid>` every second. macOS `%cpu` is a decaying average.

| Phase | Samples | CPU % min / avg / max | Max RSS | Verdict |
|---|---|---|---|---|
| macOS initial sync (27,145 records, 13:06:46–59) | 14 | 4.7 / 38.2 / 67.8 | 190.5 MB | **Over the RSS target → FU-5** |
| macOS idle, first 170 s after the initial sync | 169 | 0.0 / 0.09 / 8.6 | 148.7 MB (first ~30 s, before memory was released) | CPU PASS; RSS over target only while settling |
| macOS idle, after 30 s settle | 140 | avg 0.11, max 8.6 | 50.8 MB (steady ~20–25 MB) | **PASS** |
| Windows / Ubuntu / Fedora idle and sync | — | pending operator | pending operator | — |

The idle CPU peaks are the scheduled incremental syncs picking up live Claude activity on the test Mac.

## 4. Builds and CI

The repo has a GitHub remote, but H24 does not push, so the workflows have not run on GitHub yet. The local equivalents below ran on the macOS test machine on 2026-09-24.

| Workflow job | Local equivalent | Result |
|---|---|---|
| `ci.yml` backend | `npm run build`, `DB_DATABASE=claude_monitor_test_h24 php artisan test`, `vendor/bin/pint --test`, `vendor/bin/phpstan analyse`, `npm run lint`, `npm run types` | **FAIL**: 771 tests, 748 passed, 23 failed, all in `tests/Feature/Shell/PlaceholderRoutesTest.php` (it still expects the H08 placeholder pages Wave 4 replaced) → FU-3. Pint, PHPStan (0 errors), lint and types pass. |
| `ci.yml` agent (ubuntu) | `npm test`, `npm run lint`, `npm run typecheck`, `node --test tools/claude-data-probe/probe.test.mjs` | PASS on macOS, Node v25.2.0 (no Node 24 installed locally): 54 files / 772 tests, lint clean, typecheck clean, probe 21/21 |
| `ci.yml` agent-os (macOS, Windows) | `npm test` on the real OS | macOS: PASS (above). Windows: needs the GitHub runner or a Windows machine. |
| `agent-build.yml` macOS | `npm run build -- --target darwin-arm64 --config <cfg>` + `packaging/macos/build-pkg.sh dist/darwin-arm64 0.1.0` | PASS: `6amAgent-0.1.0-arm64.pkg`, unsigned |
| `agent-build.yml` Linux | `npm run build -- --target linux-{x64,arm64}` + `packaging/linux/build-packages.sh dist/linux-<arch> 0.1.0 <arch>` with nfpm 2.41.1 (checksum verified) | PASS: `6am-agent_0.1.0_amd64.deb` (46.1 MB), `6am-agent-0.1.0-1.x86_64.rpm` (47.7 MB), `6am-agent-0.1.0-linux-x64.tar.gz` (44.7 MB), and the arm64 equivalents |
| `agent-build.yml` Windows | `npm run build -- --target win-{x64,arm64}` + `packaging\windows\build-installer.ps1` | Payloads built. Installer compile NOT RUN: no Windows host, and the Docker engine (for an Inno Setup container) would not start. The ps1 validates the payload and stops at "ISCC.exe not found". |
| Workflow syntax | `actionlint 1.7.7 .github/workflows/*.yml` | PASS (exit 0; shellcheck not installed, so embedded scripts were not linted) |

### Local build commands per OS

Run from `6am-agent/` after `npm ci`. `<cfg>` is a build config: `build-config.example.json` for a dev build, or `{"apiBaseUrl":"https://…","channel":"stable"}`.

| OS | Commands | Output |
|---|---|---|
| macOS | `npm run build -- --target darwin-arm64 --config <cfg>` then `packaging/macos/build-pkg.sh dist/darwin-arm64 <version> [--sign "Developer ID Installer: …" [--notarize-profile 6am-notary]]` (repeat with `darwin-x64`) | `dist/macos/6amAgent-<version>-<arch>.pkg` |
| Windows | `npm run build -- --target win-x64 --config <cfg>` then `powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-installer.ps1 -PayloadDir dist\win-x64 -Version <version> [-SignToolPath … -CertificateThumbprint …]` (needs Inno Setup 6.3+) | `packaging\windows\Output\6amAgent-<version>-x64.exe` |
| Linux | `npm run build -- --target linux-x64 --config <cfg>` then `packaging/linux/build-packages.sh dist/linux-x64 <version> x64` (needs nfpm) | `dist/packages/*.deb`, `*.rpm`, `*.tar.gz` |

`<version>` must equal `6am-agent/package.json` `version`, because the payload's `VERSION` file comes from there.

### Workflow notes

- `ci.yml` runs on pull requests, pushes to `main` and manually. The backend job uses a MySQL 8.0 service. Windows jobs set `core.autocrlf false` before checkout, because fixture tests depend on exact byte offsets.
- `agent-build.yml` runs on `agent-v*` tags and manually. The tag must match the package.json version. Installers go to a **draft** GitHub release (`agent-v<version>`) with `gh release upload`, so no extra upload action is needed and no tag is created until someone publishes the release.
- Signing runs only when its secrets exist: macOS `MACOS_INSTALLER_CERT_P12`, `MACOS_INSTALLER_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`, plus `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` for notarization; Windows `WINDOWS_CERT_PFX`, `WINDOWS_CERT_PASSWORD`. deb/rpm are unsigned (nfpm signing is not configured in `nfpm.yaml`).
- The repository variable `AGENT_API_BASE_URL` makes a stable build. Without it the installers are dev-channel builds, and the job prints a warning.

## 5. Operator runbook (Windows 11, Ubuntu 24.04, Fedora)

Prerequisites: Claude Code installed and logged in; a dashboard reachable over https (or a local dev backend); an admin account to issue pairing codes. Use a standard (non-admin) user. Record the date and your name in every cell you fill in.

### 5.1 Every OS

1. **Probe (contract closure).** Run the commands in `docs/contracts/claude-data-contract.md` §12 and check the reports contain no personal data. Then update that contract's Windows/Linux columns in §4, §12, §13 and §14.
2. **Install** the CI installer for the OS (§5.2–5.3). Record that no Node or npm was installed beforehand (`node -v` fails).
3. **Pair**, then check the device on the dashboard Devices page (row 2) and `agent status` / `agent diagnostics` (rows 3–4).
4. **Rows 5–19:** repeat the macOS procedure in §2. Use a scratch dir for the `claude -p` runs. For offline, disconnect the network (or stop the local backend). For a failed sync, have the backend return 5xx. Reboot for row 17.
5. **Row 22:** switch networks (Wi-Fi ↔ hotspot or VPN) and confirm the device count stays the same.
6. **Row 23:** uninstall and confirm that the device shows `uninstalled` and that session/usage counts are unchanged.
7. **Resources:** sample CPU/RSS every second during the initial sync and for 3 minutes idle. Windows: `while(1){Get-Process node | ? Path -like "*6amAgent*" | select CPU,WorkingSet64; sleep 1}`. Linux: `pidstat -r -u -p <pid> 1`, or `ps -o %cpu=,rss= -p <pid>` in a loop.

### 5.2 Windows 11 x64

Follow the checklist in `6am-agent/packaging/windows/README.md` (install, task, **no console window**: `MainWindowHandle` 0, pair, heartbeat, sign-out/reboot, upgrade, uninstall, paths with spaces or non-ASCII characters). Also record `$ExecutionContext.SessionState.LanguageMode` (DPAPI needs `FullLanguage`) and, for contract §11, whether `fs.stat` returns a non-zero `ino` on the profile drive: `& "$env:LOCALAPPDATA\Programs\6amAgent\runtime\node.exe" -e "console.log(require('fs').statSync(process.env.USERPROFILE+'/.claude/projects').ino)"`. If Claude is also used inside WSL, record whether those sessions appear (contract §2 expects they do not).

### 5.3 Ubuntu 24.04 and Fedora

Install the `.deb` (`sudo apt install ./6am-agent_<v>_amd64.deb`) or the `.rpm` (`sudo dnf install ./6am-agent-<v>-1.x86_64.rpm`), then run `6am-agent pair` as the developer (it prompts for the code; `6am-agent pair <code>` also works). Check `systemctl --user status 6am-agent`, log out and back in, then reboot (row 17). Also try the tarball path without root on one machine. Record `$XDG_CONFIG_HOME` and whether `~/.config/claude` exists (contract §2). Uninstall with `sudo apt remove 6am-agent` / `sudo dnf remove 6am-agent`.

## 6. Follow-ups

Each follow-up became a Wave 6.5 handover and is merged on `main`: FU-1 → [H27](../handovers/H27-agent-version-v1.md) (agent ships as 1.0.0; `update_required` clears only once `/settings` accepts the version), FU-2 → [H26](../handovers/H26-agent-api-error-envelopes.md) + [H32](../handovers/H32-disable-copy-and-throttle-headers.md), FU-3 → [H28](../handovers/H28-placeholder-routes-test.md), FU-4 and FU-6 → [H30](../handovers/H30-agent-dev-and-hygiene.md), FU-5 → [H31](../handovers/H31-agent-initial-sync-memory.md). The matrix rows above are the original 2026-09-24 observations; the macOS rows affected by FU-1/FU-2 should be re-run in the next operator pass. The original scopes are kept below.

| ID | Severity | Summary | Owned files (proposed) | Validation |
|---|---|---|---|---|
| FU-1 | **Critical** | Every sync from a fresh install is refused with 426, because the `tracking_settings.min_agent_version` default `1.0.0` (migration `2026_09_24_000016_create_tracking_settings_table.php`) is above the shipped agent `0.1.0`. Also, each successful heartbeat clears `update_required` (`6am-agent/src/core/runtime/agentRuntime.ts` ~L223), so the agent loops 426 → heartbeat → 426. The `1.0.0` default is frozen in `docs/contracts/sync-api-v1.md` (tracking settings), so the preferred fix is to ship the V1 agent as `1.0.0` (bump `6am-agent/package.json`). The alternative, lowering the default in a new migration, is a contract change. Also decide whether a heartbeat may clear `update_required`. | `6am-agent/package.json` (or new migration + `docs/contracts/sync-api-v1.md`), `6am-agent/src/core/runtime/agentRuntime.ts` + tests | fresh `migrate:fresh --seed`, pair, `sync-now` → 200 |
| FU-2 | **High** | Disabled or revoked devices get Laravel's `401 {"message":"Unauthenticated."}` instead of the contract envelope, and disabling never yields `403 device_disabled`, because `DisableDevice` deletes the tokens before `EnsureDeviceIsActive` can run. The agent then retries forever as `invalid_response` and shows state "ok". Fix: render `AuthenticationException` on `api/agent/*` as the `unauthenticated` envelope (`bootstrap/app.php`), and either keep tokens on disable so `device.active` answers 403, or map 401 to `needs_repair` in the agent as the contract requires. Also render DB failures as `500 persistence_failed`. Tests: `SyncHttpGuardsTest` must assert the body, not only the status. | `agent-dashboard/bootstrap/app.php`, `app/Actions/Agent/DisableDevice.php`, `tests/Feature/Ingestion/SyncHttpGuardsTest.php`, agent `src/core/sync/apiClient.ts` tests | disable a paired device → agent state `device_disabled` within one cycle |
| FU-3 | High (blocks CI green) | `tests/Feature/Shell/PlaceholderRoutesTest.php` (H08) still expects the `Placeholder` component and 200 on `*.show` routes without records: 23 failures on `main`. Fix: drop the component/show assertions and keep the route-name, guest and RBAC cases. | `agent-dashboard/tests/Feature/Shell/PlaceholderRoutesTest.php` | `php artisan test` fully green |
| FU-4 | Low (dev only) | A dev build pointing at `http://127.0.0.1` needs `AGENT_ALLOW_INSECURE_LOCALHOST=1`, which a LaunchAgent / Scheduled Task / systemd unit never receives; `diagnostics` (no network) also exits 1 without it. Fix: allow loopback http automatically for `channel: dev`, or let `build-config.json` carry the flag for dev builds. | `6am-agent/src/core/sync/apiClient.ts`, `src/app/buildConfig.ts` + tests | dev build as a service syncs to a local backend with no env var |
| FU-5 | Medium | RSS reaches 190.5 MB during a 27k-record initial sync (target < 120 MB); idle is ~20–25 MB. Investigate chunk size and batch buffering in the scanner/sync manager. | `6am-agent/src/core/claude/scanner.ts`, `src/core/sync/*` | initial sync of the same data set stays < 120 MB RSS |
| FU-6 | Low | `6am-agent/.cache/` (Node download cache from `npm run build`) is not git-ignored; `state.db` is created 0644 (inside a 0700 dir). | `6am-agent/.gitignore` or root `.gitignore`, `src/core/state/stateStore.ts` | `git status` clean after a build; `state.db` mode 0600 |
