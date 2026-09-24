# H33 — Agent HTTP Client and Service Node Flags (Finish FU-5)
Status: done (6dbc647) · Follow-up (H31 leftovers, Wave 6 finding FU-5) · solo · Branch `handover/H33-agent-http-memory`

## Objective
Initial-sync peak RSS < 120 MB with H31's harness (`npm run build && npx tsx test/perf/initialSyncRss.ts`). H31 reached 138–142 MB and measured the rest: global `fetch` (undici + its WASM parser) ≈ 30 MB, V8 16 MB semispaces ≈ 10–15 MB.

## Read first
H31 report (below) · `docs/handovers/H31-agent-initial-sync-memory.md` · contract §1 (headers, gzip), §9.3 (transport failures, timeouts) · `6am-agent/src/core/sync/apiClient.ts` · H18/H19–H21 service definitions.

## Depends on
H30, H31 (merged).

## Owned files
6am-agent: `src/core/sync/apiClient.ts` (+ a new `src/core/sync/httpTransport.ts`) · `src/app/container.ts` · `src/app/pairing/page.ts` (only if it calls the API through `fetch`) · `test/unit/sync/**` · `test/unit/app/**` · `test/perf/**` · the node launch arguments in `src/platform/{darwin,linux,win32}/**`, `packaging/{macos,linux,windows}/**` (launcher scripts/units/task definitions only) and their `test/unit/platform/<os>/**` tests.

## Steps (TDD)
1. Replace global `fetch` in the API client with a small `node:http`/`node:https` transport: same request bytes (gzip body, headers, User-Agent), same timeout/abort behaviour, same error classification (§9.3: DNS/TLS/connection/timeout ⇒ retryable transport failure; non-envelope bodies ⇒ `invalid_response`), response size cap. Keep the `fetchImpl` test seam or an equivalent injectable transport; existing apiClient tests stay green.
2. Every place that starts the long-running agent (LaunchAgent plist, systemd unit / Linux wrapper, Windows scheduled task, and `run` launched from packaging) passes `--max-semi-space-size=8` to the bundled node.
3. Re-run H31's harness with the flag (`--node-flags=--max-semi-space-size=8`): record before/after; payload digest unchanged.

## Validation
`cd 6am-agent && npm test && npm run typecheck && npm run lint && npm run build` · perf output PEAK RSS < 120 MB, digest `a78e9091…` (Prompt OFF) unchanged.

## Commit
`perf(H33): node http transport and service heap flags to meet the RSS target`
