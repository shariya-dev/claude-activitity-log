# H23 — Token Validation (PRD Phase 8)
Status: todo · Wave 6 · parallel with H22, H24 · Branch `handover/H23-token-validation`

## Objective
Prove that token numbers are right from raw Claude data to dashboard: extraction, dedup, session/developer/project/date aggregation, and the Actual/Total formulas, using both controlled fixtures and a controlled real session.

## Read first
PRD §19–22, §58 Phase 8, `docs/contracts/claude-data-contract.md` (dedup evidence), H09, H06, H07, H16.

## Depends on
H06, H09, H16 (merged).

## Owned files
`6am-agent/test/validation/**`, `agent-dashboard/tests/Feature/TokenValidation/**`, `docs/validation/token-validation.md`, `tools/token-audit/token-audit.mjs` (zero-dep).

## Allowed dependencies
None.

## Steps
1. `tools/token-audit/token-audit.mjs --dir <claude dir> --session <id> [--since]`: an independent reference implementation (not importing agent code) that reads JSONL, dedups by `message.id` with a per-field max, and prints raw sums + Actual + Total per session, day (org tz), and model. It's the oracle.
2. Agent validation tests: for every H02 fixture, the reader's usage sums == oracle sums.
3. Backend validation tests: ingest the H03 example + a generated 3-developer × 2-project × cross-midnight dataset; assert that session, developer, project, model, day/week/month, and custom-range totals via H07 equal independently computed SQL sums over `session_usage` and the formulas (PRD §20 example included).
4. Controlled real session (on this Mac, a human runs `claude` for ~3 prompts in a scratch project): run the oracle on that session, sync with a dev agent to a local backend, compare the oracle vs `claude_sessions` row vs the dashboard session page vs the Token Analytics filtered to that session's day/project. Record screenshots/values.
5. Check whether the local data exposes anything allowing billing equivalence (it shouldn't). State that explicitly (PRD §20, §59).

## Validation
`cd 6am-agent && npx vitest run test/validation` · `cd agent-dashboard && php artisan test --filter=TokenValidation`. The report has a table: source oracle | agent payload | DB | dashboard, for each metric, all equal.

## Acceptance criteria
AC23–AC26 proven with evidence · any mismatch ⇒ a filed follow-up handover (don't fix other handovers' code here).

## Review checklist
The oracle is independent of the implementation · no real prompt text in the report · cross-midnight & split-line cases covered.

## Commit
`test(H23): token validation oracle, tests and report`
