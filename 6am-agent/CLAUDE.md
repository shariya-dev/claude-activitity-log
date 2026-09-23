# 6am-agent — desktop agent

Architecture: `../docs/architecture/agent.md`. Contracts: `../docs/contracts/claude-data-contract.md`, `../docs/contracts/sync-api-v1.md`.

## Boundaries

- `src/core/**` is OS-agnostic: never import `src/platform/<os>/**`, never read `process.platform`. Enforced by eslint.
- `src/platform/types.ts` is frozen. Changing it needs its own handover.
- `src/core/contract/**` is generated from the sync contract (H03). Payload shapes come only from there.
- Only `src/app/**` and `src/cli/**` wire core + adapters together.

## Conventions

- TypeScript strict, ESM source, esbuild bundle to `dist/agent.cjs`. Runtime deps: `zod` only.
- Dependency injection via constructor params/factory functions. Filesystem, clock, and HTTP are injected so tests use fakes.
- No token arithmetic beyond carrying raw integers. No aggregation for reporting.
- Logs are JSON lines. Never log tokens, credentials, prompt text, or full file contents.
- Tests: vitest. Parser tests use the sanitized fixtures in `test/fixtures/claude/`. Never commit real prompts or emails.

## SQLite (`state.db`) holds only

`kv` (device_uid, server_cursor, settings json/version, last sync times, agent state) and `file_checkpoints` (path, file_identity, size, mtime_ms, offset). No activity records.

Driver: built-in `node:sqlite` (`DatabaseSync`), no `better-sqlite3`. Verified in H01 (2026-09-23) on Node v24.21.0, macOS arm64 (bundled SQLite 3.53.4): loads without flags and emits no ExperimentalWarning; `test/unit/sqlite-smoke.test.ts` passes. Windows and Linux are confirmed by H24.

## Commands

`npm test` · `npm run lint` · `npm run typecheck` · `npm run build` · `npm run dev -- run` (tsx)
