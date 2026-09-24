# H22 — End-to-End Sync Harness (PRD Phase 7, automated part)
Status: done (7137eb6) · Wave 6 · parallel with H23, H24 · Branch `handover/H22-e2e`

## Objective
An automated suite that runs the **real built agent** against the **real Laravel backend** (MySQL test DB) through a fault-injecting proxy, proving the sync guarantees end to end.

## Read first
PRD §27–39, §55, §61 (AC11–17, 29, 39), `docs/contracts/sync-api-v1.md`, H18 CLI, H06 behavior.

## Depends on
All of Wave 3, H18 (plus any merged adapter; the harness runs on macOS/Linux dev hosts).

## Owned files
`e2e/**` (own `package.json` with dev deps `vitest`, `tsx`, and nothing else), `e2e/README.md`.

## Allowed dependencies
`vitest`, `tsx` in `e2e/` only. The proxy is a ~100-line `node:http` pass-through with modes `pass | down | 500 | slow | drop-response` (the backend commits but the agent never sees the response, the key duplicate case).

## Harness
`e2e/setup.ts`: `migrate:fresh` on `claude_monitor_e2e`, seed an admin + developer, issue a pairing code via `php artisan tinker --execute` (calls `IssuePairingCode`), start `php artisan serve --port 8765` with `DB_DATABASE=claude_monitor_e2e`, start the proxy on 8766, build the agent for the host target, create a temp `CLAUDE_CONFIG_DIR` from H02 fixtures and temp app-data/credential dirs (env overrides `AGENT_DATA_DIR`, and a `file-0600` credential backend in tests, using the adapter's fallback), `AGENT_ALLOW_INSECURE_LOCALHOST=1`, dev build-config → proxy. Helpers: `appendLines(file, lines)`, `dbCount(table)`, `sql(query)`, `agent(cmd)`, `startAgentDaemon()/kill()`.

## Scenarios (one test file each)
1. `pair-and-initial-sync`: pair → rows match the fixture expected totals (sessions, usage deduped, tokens) (AC8, AC9, AC11, AC12, AC18–25).
2. `incremental`: append new lines to an existing session plus a new session file → only new rows, session totals grow (PRD §16 updated sessions, §29).
3. `duplicate-sync`: proxy `drop-response` on the first sync → the agent retries the same batch → no duplicate rows, the second response equals the stored one (AC16).
4. `failed-sync`: proxy `500` → checkpoints unchanged in `state.db`, then `pass` → catch-up (AC17).
5. `offline-recovery`: proxy `down` while lines are appended → no data loss after `pass` (AC14).
6. `agent-restart`: kill -9 mid-run, restart → no loss, no duplicates.
7. `device-disable`: disable via the action → the agent gets 403, stops syncing, and history stays in the DB (AC39). Re-pair code → the same device row.
8. `settings-change`: enable prompt tracking → the next sync carries messages. Disable → no messages sent (inspect proxy captures) and none stored (AC27–29).
9. `network-identity`: re-register with the same fingerprint via a different proxy source IP header → one device (AC13).
10. `sync-now`: dashboard action → the agent syncs on the next heartbeat.

## Validation
`cd e2e && npm ci && npm test` green twice in a row (flake check). Runtime < 5 min. Paste the summary.

## Acceptance criteria
Every scenario is green and mapped to AC numbers in `e2e/README.md`.

## Review checklist
Uses real binaries/endpoints (no mocks of app code) · temp dirs cleaned · no real Claude data or real `~/.claude` touched (assert `CLAUDE_CONFIG_DIR` is under tmp).

## Commit
`test(H22): end-to-end sync harness with fault injection`
