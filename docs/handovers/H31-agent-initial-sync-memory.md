# H31 — Initial Sync Memory Under 120 MB RSS
Status: done (d77cf77) · Follow-up (Wave 6 finding FU-5) · parallel with H26–H30 · Branch `handover/H31-agent-memory`

## Objective
Peak RSS during a ~27k-record initial sync stays under 120 MB (PRD target; H24 measured 190.5 MB). Idle stays ~20–25 MB.

## Read first
`docs/validation/platform-matrix.md` performance table + FU-5; contract §6 limits; `6am-agent/src/core/claude/scanner.ts`, `src/core/sync/*`, `src/core/runtime/*`.

## Owned files
`6am-agent/src/core/claude/{scanner,jsonlTailReader,transcriptFiles}.ts` · `6am-agent/src/core/sync/syncManager.ts` · `6am-agent/test/unit/{claude,sync}/**` (new perf tests) · a synthetic-dataset generator under `6am-agent/test/perf/**`.

## Steps
1. Build a reproducible synthetic dataset (~600 sessions, ~27k usage records, temp `CLAUDE_CONFIG_DIR`, no real data) and measure peak RSS of the built agent's initial sync (against a fake or local backend). Record the baseline.
2. Profile (heap snapshots / `--trace-gc`), find what is retained (whole-file reads, all-session buffering, pending batch list, parsed JSON kept past the chunk) and stream it per chunk. Behaviour and payload bytes must not change (existing tests stay green; checkpoint/commit rules untouched).
3. Record before/after numbers in the report.

## Validation
`cd 6am-agent && npm test && npm run typecheck && npm run lint && npm run build` · perf script output: peak RSS < 120 MB.

## Commit
`perf(H31): stream initial sync to stay under the RSS target`
