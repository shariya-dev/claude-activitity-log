# H29 — Deterministic Account `observed_at` (Retry Reuses the Batch)
Status: done (5406da1) · Follow-up (Wave 6 finding F1) · parallel with H26–H28, H30, H31 · Branch `handover/H29-account-observed-at`

## Objective
With Account tracking ON, a retried chunk reuses the same `batch_id` with byte-identical records (contract §8.2). Today `accountReader` stamps `observed_at` with the scan time.

## Read first
`e2e/README.md` F1; contract §4 (AccountRecord), §8; `6am-agent/src/core/claude/accountReader.ts`, scanner chunk building.

## Owned files
`6am-agent/src/core/claude/{accountReader,scanner}.ts` (observed_at derivation only) · `6am-agent/test/unit/claude/{accountReader,scanner}*.test.ts` · `e2e/scenarios/03-duplicate-sync.test.ts` (flip `it.fails('KNOWN BUG F1 …')` to `it`).

## Allowed dependencies
None.

## Steps (TDD)
Derive `observed_at` from the scanned data, not the clock (for example the newest line timestamp in the chunk, or the `~/.claude.json` mtime), so two scans of the same unchanged data produce identical bytes. Test: scan twice with the clock moved ⇒ identical `accounts[]` and identical `batch_id`. Don't run e2e; don't edit `e2e/README.md`.

## Validation
`cd 6am-agent && npm test && npm run typecheck && npm run lint`.

## Commit
`fix(H29): derive account observed_at from data so retries reuse the batch`
