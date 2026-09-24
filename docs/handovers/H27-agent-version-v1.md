# H27 — Ship the Agent as 1.0.0 & Fix the 426 Loop
Status: done (d48b644) · Follow-up (Wave 6 finding FU-1, Critical) · parallel with H26, H28–H31 · Branch `handover/H27-agent-version`

## Objective
A fresh backend (`migrate:fresh --seed`, `min_agent_version` default `1.0.0`, frozen in the contract) accepts syncs from a freshly built agent, and an outdated agent stays in `update_required` instead of looping 426 → heartbeat → 426.

## Read first
`docs/validation/platform-matrix.md` row 5 + FU-1; contract §2 (426 by endpoint), §3.3, §9.2; `6am-agent/src/core/runtime/agentRuntime.ts` heartbeat handling; `agent-dashboard/app/Actions/Agent/RecordHeartbeat.php`.

## Depends on
H05, H10, H18 (merged).

## Owned files
6am-agent: `package.json` + `package-lock.json` (version field only) · `src/cli/version.ts` · `scripts/build.ts` (version plumbing only) · `packaging/**` (version strings only) · `src/core/runtime/agentRuntime.ts` · `test/unit/runtime/**` · `test/unit/cli/**` (version assertions only)
agent-dashboard: `app/Actions/Agent/RecordHeartbeat.php` · `app/Http/Controllers/Api/Agent/V1/HeartbeatController.php` · `tests/Feature/Agent/HeartbeatTest.php` (only if the backend heartbeat 426 is not contract-compliant)
e2e: files that hard-code the agent version (version strings only)

## Allowed dependencies
None.

## Steps (TDD)
1. Bump the agent to `1.0.0` everywhere the version is declared or asserted (package, build define, installers). The contract default stays `1.0.0`.
2. Reproduce the loop in a unit test: a backend that answers `426` on `/sync` must leave the agent in `update_required` across heartbeats. Find why the heartbeat succeeded while sync was refused (compare the version each endpoint checks, contract §2 item 5) and fix the side that deviates from the contract. A heartbeat 200 may clear `update_required` only if it proves the version is now accepted.
3. Don't run e2e (orchestrator runs it).

## Validation
`cd 6am-agent && npm test && npm run typecheck && npm run lint && npm run build` · backend `DB_DATABASE=claude_monitor_test_h27 php artisan test --filter=Heartbeat` if touched · manual: a scratch backend DB on `migrate:fresh --seed`, pair the dev build, `sync-now` → 200.

## Acceptance criteria
Fresh backend + fresh agent ⇒ first sync 200 · outdated agent stays `update_required` (no loop) · checkpoints kept on 426.

## Commit
`fix(H27): ship agent 1.0.0 and keep update_required until the version is accepted`
