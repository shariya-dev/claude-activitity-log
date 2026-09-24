# H30 — Dev Loopback Builds, Build Cache Ignore, state.db Mode
Status: done (b2e8cd5) · Follow-up (Wave 6 findings FU-4, FU-6) · parallel with H26–H29, H31 · Branch `handover/H30-agent-hygiene`

## Objective
A `channel: dev` build pointing at `http://127.0.0.1`/`localhost` works as a service without `AGENT_ALLOW_INSECURE_LOCALHOST` (production builds still require HTTPS). `6am-agent/.cache/` is git-ignored. `state.db` (and its WAL/SHM files) are created `0600`.

## Owned files
`6am-agent/src/core/sync/apiClient.ts` (insecure-URL rule only) · `6am-agent/src/app/buildConfig.ts` · `6am-agent/src/app/container.ts` (passing the channel only) · `6am-agent/src/core/state/stateStore.ts` · `6am-agent/.gitignore` · `6am-agent/test/unit/{sync/apiClient,app,state}/**` (+ `test/unit/sync/apiClient.test.ts`).

## Steps (TDD)
1. Loopback `http` allowed automatically when the build channel is `dev`; never for `prod`; the env override keeps working. `diagnostics` must not exit 1 for a dev loopback build.
2. `.cache/` ignored.
3. Create `state.db` with mode 0600 (and chmod existing files on open, POSIX only; no-op on Windows).

## Validation
`cd 6am-agent && npm test && npm run typecheck && npm run lint && npm run build && git status --porcelain` (clean after build).

## Commit
`fix(H30): dev loopback builds, ignore build cache, private state.db`
