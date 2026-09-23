# H25 — V1 Acceptance Audit & Operations Runbook
Status: todo · Wave 7 (solo) · Branch `handover/H25-acceptance`

## Objective
Independently verify all 41 PRD acceptance criteria with evidence, and write the runbook needed to deploy the backend and roll out the agent.

## Read first
PRD (all, especially §61–62), `docs/architecture/*`, `docs/validation/*`, `e2e/README.md`, all handover reports.

## Depends on
Every earlier handover plus any follow-ups (`H26+`) created from Wave 6 findings.

## Owned files
`docs/validation/v1-acceptance.md`, `docs/operations/deploy-backend.md`, `docs/operations/agent-rollout.md`, `docs/operations/troubleshooting.md`.

## Allowed dependencies
None. **No product code changes**: failures become follow-up handovers.

## Deliverables
1. `v1-acceptance.md`: a table of AC1…AC41, each with verdict PASS/FAIL, evidence (test name + command output, e2e scenario, matrix cell, screenshot), and the handover(s) that implemented it. Also re-check the PRD §59 out-of-scope items weren't built (e.g. no queue infra: `grep -ri "redis\|horizon\|rabbit\|kafka\|sqs" agent-dashboard/config agent-dashboard/composer.json 6am-agent/package.json`).
2. Privacy audit: with prompt OFF, run a sync with fixtures that contain prompts and capture the HTTP bodies (H22 proxy capture) ⇒ no prompt text. Grep logs for fixture prompt strings ⇒ none. Confirm the `session_messages` encrypted cast at rest (inspect the raw DB value).
3. Security review: run `/security-review` (or `superpowers:requesting-code-review` with a security focus) on the whole repo. Record findings.
4. `deploy-backend.md`: server requirements (PHP 8.4, MySQL 8, HTTPS/TLS, cron for the scheduler, no queue worker), env vars, `APP_KEY` backup warning (encrypted prompts), first admin (`monitor:create-admin`), backups, upgrade steps, retention setup.
5. `agent-rollout.md`: producing a company build (`build-config.json` with the production URL), signing/notarization, distributing installers, the pairing procedure for admins and developers, re-pair/disable procedures, uninstall.
6. `troubleshooting.md`: `status`/`diagnostics` usage per OS, log locations, common failures (needs_repair, update_required, claude_data_unavailable, permission hints), and how to read the Sync Monitor.

## Validation
Full suites on `main`: backend tests, agent tests, e2e. Paste summaries. Every AC is PASS, or a FAIL linked to an open follow-up.

## Acceptance criteria
V1 is declared complete only when all 41 are PASS.

## Review checklist
Evidence is reproducible · no code edits · runbooks tested by following them on a clean machine where feasible.

## Commit
`docs(H25): v1 acceptance audit and operations runbooks`
