# H02 — Claude Data Contract (PRD Phase 0, §13–14)
Status: done (8bbf072) · Wave 2 · parallel with H03, H04 · Branch `handover/H02-claude-data-contract`

## Objective
Produce a **verified** description of Claude Code's local data on macOS, Windows, and Linux, plus sanitized fixtures, so the reader (H09) and adapters (H19–H21) rely on evidence, not assumptions.

## Read first
PRD §13, §14, §16–19, §24, §58 Phase 0; `docs/architecture/agent.md`; `docs/architecture/sync-protocol.md` (the fields we want).

## Depends on
H01.

## Owned files
`tools/claude-data-probe/**`, `docs/contracts/claude-data-contract.md`, `6am-agent/test/fixtures/claude/**`.

## Allowed dependencies
None. The probe is a single zero-dependency `probe.mjs` runnable with any Node ≥ 18 (`node probe.mjs [--dir <path>] [--out report.json]`).

## Known facts to verify, not assume (observed on macOS, Claude Code 2.1.274)
- Transcripts: `<CLAUDE_CONFIG_DIR or ~/.claude>/projects/<cwd with non-alphanumerics replaced by '-'>/<sessionId>.jsonl`; subagents: `<sessionId>/subagents/agent-<id>.jsonl` (`isSidechain: true`, same `sessionId`).
- Line types seen: `user`, `assistant`, `attachment`, `queue-operation`, `last-prompt`, `ai-title`, `mode`, `atis-latch`.
- `assistant` lines: `message.id`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}`, `requestId`, `timestamp`, `cwd`, `gitBranch`, `version`, `entrypoint`, `sessionId`, `uuid`.
- **One API message is split across several lines with identical `usage` (2296 of 3008 messages).** Dedup key = `message.id`.
- Account: only in `~/.claude.json` → `oauthAccount.{accountUuid, emailAddress, displayName, organizationUuid, organizationName}`. Undocumented, so it's nullable. Not per-session.
- Prompt text appears in `user` lines (`message.content` string or array of parts; `tool_result` parts are not prompts) and in `last-prompt.lastPrompt` and `ai-title`.

## Steps
1. Write `probe.mjs`. It outputs **structure only, never content values**: OS, Node version, candidate dirs checked (+exists/readable), file counts, a per-`type` key census (key names + JSON types + presence %), usage key census, message.id duplication stats (split count, identical-usage %, any case where usage differs between splits and in which fields), sessions with multiple files, timestamp format samples (shape only), `version` values seen, `entrypoint` values, whether a session ever gets an explicit end marker, file append behavior (re-run after a new prompt: grew vs rewritten; inode stable?), `~/.claude.json` top-level keys and `oauthAccount` key names (no values), and Windows path encoding of the project dir name. Redact everything else.
2. Run it on this macOS machine. Run it twice around a short new Claude session to confirm append-only growth and inode stability.
3. Windows & Linux: give the human operator the one-line command in the doc. Paste results if provided. Otherwise mark those sections `UNVERIFIED — to be closed by H24`, with the exact expected-path hypotheses (`%USERPROFILE%\.claude`, `$HOME/.claude`, `$XDG_CONFIG_HOME/claude` check, WSL note).
4. Write `docs/contracts/claude-data-contract.md` with sections: Discovery (per-OS candidates, `CLAUDE_CONFIG_DIR`), File layout, Line types (table: type → fields we use → reliability per OS), Field mapping to the sync payload (every payload field ← source path, or "not available → null"), Dedup rules, Session lifecycle (active/ended representation; `ended_at` is null unless an explicit marker is proven), Project derivation (cwd; project dir-name encoding is lossy, so use `cwd` from lines), Account attribution rule (the current `oauthAccount` at scan time applies to sessions whose lines were read in that scan; caveats), Prompt sources & exclusions, Claude Code version source, Append/rewrite behavior & checkpoint implications, Permissions per OS, Unknowns & risks.
5. Fixtures in `6am-agent/test/fixtures/claude/`: synthetic but structurally faithful files. Use fake UUIDs, `/home/dev/projects/demo-app`, `dev@example.com`, and lorem-ipsum text only:
   - `basic-session.jsonl` (2 prompts, 3 API messages, one split across 3 lines)
   - `subagent/` tree with `<sid>.jsonl` + `<sid>/subagents/agent-x.jsonl`
   - `multi-model.jsonl` (model switch mid-session)
   - `malformed.jsonl` (a truncated last line, a non-JSON line, and an unknown `type`)
   - `split-usage-growing.jsonl` (same message.id with non-decreasing usage, if the probe shows usage can differ; otherwise identical)
   - `claude.json` (oauthAccount with fake values) and `claude-no-account.json`
   - `expected/*.json`: the expected normalized output per fixture (session, usage rows after dedup, token sums), which H09 asserts against.

## Validation
- `node tools/claude-data-probe/probe.mjs --out /tmp/probe.json` runs on macOS in < 10 s. `grep -E "@|/Users/" /tmp/probe.json` finds nothing personal.
- `grep -rE "6amtech|gmail|/Users/" 6am-agent/test/fixtures` returns nothing.
- Every `expected/*.json` is hand-checked against its fixture. Show the arithmetic for token sums in the doc.

## Acceptance criteria
Contract covers every PRD §14 bullet per OS, with a verified / unverified status. Every sync payload field has a source or an explicit null. Dedup rule is documented with evidence.

## Review checklist
No personal data anywhere · no assumptions presented as verified · fixtures match the documented structure · probe output is structure-only.

## Commit
`docs(H02): verified claude data contract, probe tool and sanitized fixtures`
