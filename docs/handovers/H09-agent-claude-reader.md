# H09 — Agent: Claude Data Reader & Normalizer (`ScanSource`)
Status: todo · Wave 3 · parallel with H05–H08, H10 · Branch `handover/H09-agent-claude-reader`

## Objective
Implement the OS-agnostic reader that turns Claude Code's local files into contract-shaped, deduplicated, settings-filtered records, incrementally from file checkpoints. Implements `ScanSource` from `src/core/contract/scan.ts`.

## Read first
`docs/contracts/claude-data-contract.md` (normative for field sources), `docs/contracts/sync-api-v1.md` (record shapes + gating), `.claude/rules/privacy.md`, `6am-agent/CLAUDE.md`, `docs/architecture/agent.md` §2–4, PRD §13, §16–19, §24–26, §29, §54.

## Depends on
H02 (contract + fixtures), H03 (contract types, `ScanSource`).

## Owned files
`6am-agent/src/core/claude/**`, `6am-agent/src/core/detect/**`, `6am-agent/test/unit/claude/**`, `6am-agent/test/unit/detect/**`.

## Allowed dependencies
None.

## Interfaces produced
```ts
// src/core/claude/discovery.ts
export interface ClaudeDataSource { dataDir: string; projectsDir: string; globalConfigPath: string | null }
export function discoverClaudeData(candidates: string[], globalConfigCandidates: string[], fs?: FsLike): Promise<ClaudeDataSource | null>
// valid = <dir>/projects exists + readable and contains ≥ 0 *.jsonl (empty is valid: Claude installed, not used yet)

// src/core/claude/scanner.ts
export function createClaudeScanner(deps: { source: ClaudeDataSource; deviceUid: () => string; fs?: FsLike; clock?: () => Date; readGitRemote?: (cwd: string) => Promise<string | null> }): ScanSource
```
`FsLike` = the minimal injected subset of `node:fs/promises` (`readdir`, `stat`, `open`/read ranges, `readFile`), defined in `src/core/claude/fs.ts`.

## Behavior
- **Enumerate** `projects/*/*.jsonl` and `projects/*/*/subagents/*.jsonl`. `stat` each. Skip files whose `(fileIdentity=dev:ino, size, mtimeMs)` equal the checkpoint (stat-only fast path). `offset > size` or identity changed ⇒ restart from 0.
- **Initial range**: if `since` is set and file `mtime < since` with no checkpoint ⇒ emit a checkpoint at EOF with no records. Skip lines with `timestamp < since`.
- **Tail read** from `offset` in 256 KB blocks; consume only through the last `\n`; a partial trailing line waits for the next scan. New offset = byte after the last consumed newline.
- **Parse** tolerant: `JSON.parse` failures and unknown `type`s are counted as `linesSkipped`, never thrown.
- **Usage** from `assistant` lines with `message.usage`: key `message.id` (fallback `requestId`, then line `uuid`). Within a scan keep the per-field max for duplicates (split lines). Map `cache_creation_input_tokens→cache_creation_tokens`, `cache_read_input_tokens→cache_read_tokens`. Missing numbers ⇒ 0. `is_sidechain` from `isSidechain`. `model` is null when Model is OFF or the value is `<synthetic>`-like non-API (per the contract doc).
- **Sessions**: aggregate per `sessionId` across all files read in the scan: min/max timestamp → `first_seen_at`/`last_seen_at`, last `version`, `entrypoint`, `gitBranch` (Git ON only), latest model. `ended_at` only if the data contract documents a reliable end marker, else null.
- **Projects** (Project ON): from line `cwd`. `project_key` = sha256(normalized git remote) if Git ON and `readGitRemote(cwd)` returns a value (default impl reads only `<cwd>/.git/config` `[remote "origin"] url`, normalized: strip credentials, `.git` suffix, lowercase host, `git@host:` → `host/`). Otherwise sha256(`deviceUid + "\n" + cwd`). `name` = basename of the remote or cwd. `path` = cwd.
- **Account** (Account ON): read `oauthAccount` from `globalConfigPath` once per scan. Only those five fields are kept in memory. `account_key` = sha256(accountUuid) else sha256(lowercased email) else no account. Sessions read in this scan get `account_key`.
- **Messages** (Prompt ON **only**; the code path isn't entered otherwise): `user` lines whose content is a string or text parts, excluding `tool_result` parts and `isMeta` lines; `source_message_id` = line `uuid`; `role:'user'`. Never collect assistant text, tool inputs/outputs, attachments, `last-prompt`, or `ai-title`.
- **Chunking**: yield `ScanChunk`s within `maxUsagePerChunk`/`maxSessionsPerChunk`/`maxMessagesPerChunk`, splitting only at file boundaries or line boundaries, with checkpoints reflecting exactly the lines included. Each chunk includes the session/project/account records its usage references.
- `claudeCodeVersion()` = `version` of the newest line seen (cached from the last scan; falls back to scanning the newest file's tail). `lastLocalActivityAt()` = max line timestamp.

## Tests (fixtures from H02; assert against `test/fixtures/claude/expected/*.json`)
Split-line dedup (the 3-line message counts once) · per-field max on growing usage · subagent file merges into the parent session with `is_sidechain` · model switch · malformed file: bad lines skipped, the partial last line not consumed (offset stops before it), then the appended completion is consumed next scan · incremental: scan, append 2 lines, scan again ⇒ only new usage and the correct new offset · stat fast path reads zero bytes (spy on `open`) · shrink/identity change ⇒ restart · `since` filtering · category gating matrix: prompt OFF ⇒ `messages` empty **and the prompt-extraction function never called** (spy) · git OFF ⇒ `readGitRemote` never called, git fields null · account OFF ⇒ global config never read · project key determinism · chunk limits respected with correct checkpoints · no `process.platform` usage (lint).

## Validation
`cd 6am-agent && npm test && npm run lint && npm run typecheck`. Coverage ≥ 90 % lines for `src/core/claude` + `src/core/detect` (`npx vitest run --coverage`).

## Acceptance criteria
PRD §16 new **and** updated sessions detected (updated = appended lines in an existing file) · §29 incremental · §54 data minimization · output validates against the H03 zod schemas (assert with `SyncRequest` sub-schemas in tests).

## Review checklist
No writes to Claude dirs · no token arithmetic except max-merge of duplicates · no prompt text anywhere unless Prompt ON · memory bounded by the chunk size (no whole-file reads).

## Commit
`feat(H09): incremental claude data reader with dedup, gating and chunked scan source`
