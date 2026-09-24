# Claude Code Local Data Contract (PRD Phase 0, §13–14)

Status: **macOS verified** (Claude Code 2.1.274, Darwin 25.3.0 arm64, 2026-09-24) · **Windows UNVERIFIED — to be closed by H24** · **Linux UNVERIFIED — to be closed by H24**.

This is the normative description of the Claude Code data the agent reads. The reader (H09), the platform adapters (H19–H21) and token validation (H23) build on it. Every statement is tagged:

- **[V]** verified on real data with the probe (`tools/claude-data-probe/probe.mjs`), with the evidence given.
- **[D]** documented by Anthropic (Claude Code docs at code.claude.com/docs), not yet observed on that OS.
- **[H]** a hypothesis that H24 must confirm on real machines.

Anthropic states that the transcript format *"is internal to Claude Code and changes between versions"* (docs: Sessions). The agent must therefore parse tolerantly: unknown line types and unknown keys are ignored, and missing keys become `null`/0. Section 13 lists what to re-verify when Claude Code updates.

## 1. Evidence base (macOS)

The probe was run on a developer Mac with 1.19 GB of real data. Structure only; no values were recorded.

| Measure | Value |
|---|---|
| Probe runtime | 1.28–1.41 s (limit 10 s) |
| Project dirs / transcripts | 53 / 917 (599 main, 318 subagent) + 318 `agent-*.meta.json` |
| Lines | 265,920; malformed 0, blank 0; largest line 4.98 MB; largest file 25.1 MB |
| Files not ending in `\n` | 0 |
| Claude Code `version` values seen | 17 distinct (up to 2.1.274) |
| Timestamp shape | `dddd-dd-ddTdd:dd:dd.dddZ` on 100% of timestamped lines (225,206) |

To reproduce: `node tools/claude-data-probe/probe.mjs --out probe.json`. Add `--compare <previous.json>` for the append check. Tests: `node --test tools/claude-data-probe/`.

## 2. Discovery

The agent's `claudeDataCandidates()` must return candidates in this order:

| # | Candidate | macOS | Windows | Linux |
|---|---|---|---|---|
| 1 | `$CLAUDE_CONFIG_DIR` if set and non-empty | [D] | [D] | [D] |
| 2 | `<home>/.claude` | **[V]** `$HOME/.claude`, mode `700`, owned by the user | [D]/[H] `%USERPROFILE%\.claude` (docs: "On Windows, `~/.claude` resolves to `%USERPROFILE%\.claude`") | [D]/[H] `$HOME/.claude` |
| 3 | `$XDG_CONFIG_HOME/claude`, `~/.config/claude` | [V] absent | n/a | [H] checked defensively only. The docs never use XDG, and open community issues report that XDG is ignored. |

- A candidate is valid when `<dir>/projects` exists and is readable. An empty `projects/` is valid (Claude installed but not used yet).
- **`CLAUDE_CONFIG_DIR`** [D] moves "all settings, session history, and plugins", so transcripts live under `$CLAUDE_CONFIG_DIR/projects`. `CLAUDE_CODE_PROJECT_DIR_NAME` [D] can override the project dir name when `CLAUDE_CONFIG_DIR` is set. This is one more reason never to derive the project from the dir name (§7).
- **The service environment may lack `CLAUDE_CONFIG_DIR`.** A developer who sets it in their shell profile will not have it in a LaunchAgent, Scheduled Task or systemd `--user` unit. The adapters check it first, then fall back to the default home location. [H] H24 must test a relocated dir; a manual folder fallback (PRD §13) covers it.
- **Global config (`.claude.json`)** candidates, in order:
  1. `$CLAUDE_CONFIG_DIR/.claude.json` if the env var is set. This is [H]: community reports say the file moves with the env var, but the docs don't say so.
  2. `<home>/.claude.json`. **[V]** on macOS; it sits in the home dir, *outside* `.claude/`. [D]/[H] `%USERPROFILE%\.claude.json` on Windows.
- **WSL** [H]: Claude Code inside WSL is a Linux install that stores data in the distro's `~/.claude`. A Windows-side agent does not see WSL sessions, and reading `\\wsl$\…` is out of scope for V1. A developer who uses Claude only inside WSL needs the Linux agent inside WSL. H24 must confirm this.

## 3. File layout

```
<dataDir>/
  projects/
    <encoded-cwd>/                                  one dir per launch cwd (§7)
      <sessionId>.jsonl                             main transcript, file name == sessionId  [V 100%]
      <sessionId>/subagents/agent-<agentId>.jsonl   subagent transcript, lines carry the PARENT sessionId  [V]
      <sessionId>/subagents/agent-<agentId>.meta.json  {agentType, description, toolUseId, spawnDepth, model?, …}  [V] not read
      <sessionId>/tool-results/*.txt                large tool outputs  [V] never read
      memory/                                       auto-memory markdown  [V] never read
  sessions/<pid>.json                               live-process registry (§8)  [V] not read in V1
  history.jsonl                                     prompt history (prompt text)  [V] never read
  settings.json, plugins/, cache/, …                never read
<home>/.claude.json                                 global app state incl. oauthAccount  [V]
```

- The agent enumerates exactly `projects/*/*.jsonl` and `projects/*/*/subagents/*.jsonl`. Nothing else under the data dir is opened.
- **Retention** [D]: Claude Code deletes transcripts (and their `subagents/` and `tool-results/`) older than `cleanupPeriodDays`, which defaults to **30 days**. The sweep runs after a session starts. Consequences:
  - Files can disappear. The agent drops checkpoints for missing files; the server keeps history (invariant 7).
  - An `initial_sync.range = all` normally reaches back only about 30 days.
  - An agent that is offline longer than the retention period loses that data. This is inherent to the data source.

## 4. Line types

One JSON object per line, UTF-8, terminated by `\n` [V]. Counts come from the macOS probe (265,920 lines).

| `type` | Count | Timestamp | Fields the agent uses | Use | macOS | Win | Linux |
|---|---|---|---|---|---|---|---|
| `assistant` | 98,794 | 100% | `sessionId`, `timestamp`, `cwd`, `version`, `gitBranch`, `entrypoint`, `isSidechain`, `requestId`, `uuid`, `message.id`, `message.model`, `message.usage.*` | usage, session, project, model | **V** | H | H |
| `user` | 59,801 | 100% | `sessionId`, `timestamp`, `cwd`, `version`, `gitBranch`, `entrypoint`, `isSidechain`, `uuid`, `isMeta`, `message.content` | session; prompt (Prompt ON only, §10) | **V** | H | H |
| `attachment` | 59,653 | 100% | `sessionId`, `timestamp`, `cwd`, `version` | session activity times only | **V** | H | H |
| `system` | 231 | 100% | `sessionId`, `timestamp` | session activity times only | **V** | H | H |
| `queue-operation`, `file-history-delta`, `pr-link`, `frame-link` | 4,505 / 2,134 / 62 / 26 | 100% | `sessionId`, `timestamp` | session activity times only | V | H | H |
| `last-prompt` | 14,226 | none | — (contains `lastPrompt` = prompt text) | **never read** | V | H | H |
| `ai-title` | 9,668 | none | — (contains `aiTitle`, derived from prompts) | **never read** | V | H | H |
| `cost-state` | 99 | none | — (contains `totalCostUSD`, `modelUsage`) | **never read**; cost is out of scope (PRD invariant 1) | V | H | H |
| `bridge-session` | 1,294 | none | — (contains `ownerAccountUuid`, see §9) | not used in V1 | V | H | H |
| `atis-latch`, `mode`, `permission-mode`, `file-history-snapshot`, `artifact-*` | 12,968 / 1,117 / 141 / 1,195 / 6 | none | — | ignored | V | H | H |
| anything else | — | — | — | ignored, counted as skipped | — | — | — |

Presence figures on `assistant` lines [V]: `sessionId`, `timestamp`, `cwd`, `version`, `gitBranch`, `entrypoint`, `isSidechain`, `uuid`, `message.id`, `message.model` and `message.usage` are 100%. `requestId` is on about 100%; it is absent only on `<synthetic>` lines.

`user` lines [V]: `message.content` is a string on 1,472 lines and an array on 58,329. Array part types are `tool_result` 56,947, `text` 1,912 and `image` 166. `isMeta` is present on 1.1% of lines.

Observed enums [V]:

| Field | Values (count) |
|---|---|
| `entrypoint` | `claude-vscode` 186,861 · `sdk-cli` 16,111 · `sdk-ts` 13,461 · `cli` 2,046 |
| `message.model` | `claude-opus-5`, `claude-sonnet-5`, `claude-opus-5-5`, `claude-haiku-4-5-20251001`, `claude-opus-4-8`, `claude-fable-5-1`, `<synthetic>` (10) |
| `stop_reason` | `tool_use`, `end_turn`, `stop_sequence`, `null` (non-final split lines) |

Models are stored dynamically (PRD §18). `entrypoint` is free text.

## 5. Field mapping to the sync payload

Source paths refer to transcript lines unless noted. "null" means the value is not available and is always sent as null. Category gating (sync-protocol draft §1) is applied *before* any value is read into a payload object.

**`agent`**

| Field | Source |
|---|---|
| `device_id` | pairing response (not Claude data) |
| `platform`, `platform_version`, `architecture` | platform adapter `deviceInfo()` |
| `agent_version` | build |
| `claude_code_version` | `version` of the newest-timestamped line seen [V 100% on assistant/user]. null if no transcript exists yet. |

**`accounts[]`** (Account ON; read from global config `oauthAccount`, §9)

| Field | Source |
|---|---|
| `account_uuid` | `oauthAccount.accountUuid` [V string] |
| `email` | `oauthAccount.emailAddress` [V string] |
| `display_name` | `oauthAccount.displayName` [V string] |
| `organization_uuid` | `oauthAccount.organizationUuid` [V string] |
| `organization_name` | `oauthAccount.organizationName` [V string] |
| `account_key` | sha256(`accountUuid`), else sha256(lowercased email). If neither exists, no account. |
| `observed_at` | scan time |

All account fields are nullable, because `oauthAccount` is undocumented and absent when the user is logged out or uses an API key. Every other `oauthAccount` key (billing type, tiers, roles, …) is never kept in memory.

**`projects[]`** (Project ON)

| Field | Source |
|---|---|
| `path` | `cwd` [V 100%] |
| `name` | basename of the git remote (Git ON) or of `cwd` |
| `git_remote` | `<cwd>/.git/config` `[remote "origin"] url`, only when Git is ON; otherwise null |
| `first_seen_at`, `last_seen_at` | min/max `timestamp` of lines with that `cwd` |
| `project_key` | derivation in H09 (remote hash, or `deviceUid + cwd` hash) |

**`sessions[]`**

| Field | Source |
|---|---|
| `source_session_id` | `sessionId` [V 100%; equals the main file name] |
| `project_key` | project of the session's **launch cwd**: the first line with `cwd` in the main file (§7) |
| `account_key` | account at scan time (§9) |
| `first_seen_at` / `last_seen_at` | **min / max** `timestamp` over all timestamped lines of the session, main + subagent files. Use min/max, not first/last: 2,546 lines are out of order within their file [V]. |
| `ended_at` | **null always** (§8) |
| `claude_code_version` | `version` of the latest-timestamped line (5 sessions span more than one version [V]) |
| `entrypoint` | `entrypoint` of the latest-timestamped line |
| `git_branch` | `gitBranch` of the latest-timestamped line (Git ON; 31 sessions change branch [V]) |
| `model` | `message.model` of the latest non-`<synthetic>` usage line (27 sessions switch model [V]) |

**`usage[]`** (Usage ON; `assistant` lines with `message.usage` whose model is not `<synthetic>`)

| Field | Source |
|---|---|
| `source_message_id` | `message.id` [V 100%] |
| `source_session_id` | `sessionId` |
| `request_id` | `requestId`, else null |
| `model` | `message.model` (Model ON, else null) |
| `is_sidechain` | `isSidechain === true` (subagent lines [V 100% true]) |
| `recorded_at` | `timestamp` of the **first** line of that `message.id` |
| `input_tokens` | `message.usage.input_tokens` [V 100%, number] |
| `output_tokens` | `message.usage.output_tokens` [V 100%] |
| `cache_creation_tokens` | `message.usage.cache_creation_input_tokens` [V 100%] |
| `cache_read_tokens` | `message.usage.cache_read_input_tokens` [V 100%] |

Missing numeric fields become 0; no negative values were observed [V]. These `message.usage` keys are also present but are **not** sent: `cache_creation.{ephemeral_5m,ephemeral_1h}_input_tokens` (a breakdown of `cache_creation_input_tokens`), `output_tokens_details.thinking_tokens` (included in `output_tokens`), `server_tool_use.*`, `service_tier`, `inference_geo`, `iterations`, `speed`.

**`messages[]`** (Prompt ON only, §10)

| Field | Source |
|---|---|
| `source_message_id` | `uuid` |
| `source_session_id` | `sessionId` |
| `role` | `'user'` |
| `content` | `message.content` string, or its `text` parts joined with `\n` |
| `recorded_at` | `timestamp` |

**Heartbeat**

| Field | Source |
|---|---|
| `last_local_activity_at` | max `timestamp` seen |
| `claude_code_version` | as for `agent.claude_code_version` |

## 6. Dedup rules

**Key: `message.id`.** Fallback order is `requestId`, then line `uuid`; the fallback never fired on macOS, where 0 usage lines lack `message.id` [V].

**Evidence [V].** Claude Code writes one API response as one line per content part (thinking / text / tool_use), and every line repeats the same `message.id`, `requestId`, `model` and `usage`.

| Measure | Value |
|---|---|
| Assistant lines with usage | 98,794 |
| Distinct `message.id` | 47,449 |
| Ids split over ≥ 2 lines | 33,807 (max 57 lines per id) |
| Split ids with identical usage on every line | 27,046 (80.0%) |
| Split ids where usage differs | 6,761. `output_tokens` (+ `thinking_tokens`, `iterations`, `speed`, `server_tool_use.*`) grows across the lines, and `stop_reason` is set only on the last line in 6,743 of them. |
| …non-decreasing, max on the last line | 6,760 of 6,761 |
| …exception | 1 id whose second line has **all token fields 0** after a first line with real usage |
| Ids across several files / sessions / requestIds / models | 0 / 0 / 0 / 0 |

**Rule.** Within a scan, merge duplicates by taking the **per-field maximum** of the four token fields. This gives the correct value in every observed case, including the all-zero trailing line, where "last line wins" would lose the usage.

Split lines of one id can straddle a scan or chunk boundary. The backend then receives the id twice and merges with `GREATEST` per column (sync-protocol §3), which reaches the same result. Summing the lines instead of deduplicating would overcount by about 2.1× (98,794 lines / 47,449 ids).

`<synthetic>` lines [V: 10 lines] are local placeholders, not API calls: the `message.id` is a UUID rather than `msg_…`, there is no `requestId`, and all tokens are 0. **They are skipped, not sent.** Follow-up: H09's spec says "`model` is null … `<synthetic>`"; under this contract the whole record is skipped.

Subagent usage is distinct API calls with its own `message.id`s, so it is counted, with `is_sidechain = true`.

## 7. Project derivation

- Project dir name = launch cwd with every non-alphanumeric character replaced by `-`. This held for [V 52/52] dirs on macOS; for Windows it is [D/H]: `C:\Users\x\proj` → `C--Users-x-proj`.
- The encoding is **lossy**: `-`, `/`, `.`, `_`, spaces and non-ASCII all become `-`.
- Names longer than 200 characters are truncated and a hash is appended [D]. The longest name observed on macOS was 133 characters [V].
- **Never parse the dir name.** The project comes from `cwd` in the lines [V 100% on assistant/user].
- A session's `cwd` can change: 135 of 599 sessions have more than one `cwd` [V], for example through `cd` in the shell, worktrees, or subagents in other dirs, and 8 project dirs contain several cwds. Rules:
  - The **session's project is its launch cwd**: the first line with `cwd` in the session's main file.
  - Every distinct `cwd` seen still produces a `projects[]` record with its own first/last seen, so paths are complete.
  - Usage is attributed through its session.

## 8. Session lifecycle

- **New session** = new `<sessionId>.jsonl` file. **Updated session** = appended lines, including after resume. [V] `claude --continue` appended to the existing file under the same `sessionId`: 40 → 48 lines, same inode.
- **No end marker exists** [V]:
  - The last line types of main files are `last-prompt` 397, `cost-state` 76, `atis-latch` 75, `mode` 30, and a few others.
  - No line type contains end/exit/close/stop.
  - `system.subtype = away_summary` (11 lines) is an idle summary, not an end.
  - A session can be resumed at any time.
  - **`ended_at` is therefore always null in V1.** Active versus idle is derived server-side from `last_activity_at`.
- `sessions/<pid>.json` [V: 5 files, keys `pid`, `sessionId`, `status`, `startedAt`, `updatedAt`, `cwd`, `entrypoint`, …] is a live-process registry, and its absence might signal that a session has ended. It is undocumented and describes processes, not sessions, so V1 does not read it. It is listed under §13.
- Timestamps: ISO-8601 UTC with milliseconds and `Z` [V 100%]. Metadata lines carry no timestamp (40,714 lines, the types marked "none" in §4) and never move session times.

## 9. Account attribution

- **Source:** `oauthAccount` in the global config (§2). It is the only account source [V]; transcript lines carry no account id.
- **Keys:**
  - [V] 20 keys: `accountUuid`, `emailAddress`, `organizationUuid`, `displayName`, `fullName`, `organizationName`, plus billing, tier and role fields that are never read.
  - Types [V]: all five used fields are strings.
- **Rule:** the `oauthAccount` present at scan time is attributed to every session whose lines were read in that scan.
- **Caveats:**
  - If the user switches accounts between writing lines and the scan, those lines go to the new account. Scans run every 2 minutes, so the window is small.
  - Rescans after a checkpoint reset attribute old sessions to the current account. The server merges `account_key` as latest non-null, so a re-sent session can move to the current account.
  - API-key users (no OAuth) and logged-out users have no `oauthAccount`, so there is no account.
- `bridge-session` lines carry `ownerAccountUuid` [V 95.8% of 1,294 lines]. It is written only for remote-control-bridged sessions, so it is not a general per-session source. V1 does not read it; it is noted as a future refinement.

## 10. Prompt sources and exclusions

Read only when the `prompt` category is ON; the code path is not entered otherwise.

| Source | Collected? |
|---|---|
| `user` lines with `message.content` string (typed prompt) | **yes** |
| `user` lines with array content containing `text` parts | **yes**, text parts joined |
| `user` lines whose parts are `tool_result` (56,947 parts [V]) | no (tool output) |
| `user` lines with `isMeta: true` | no (injected/system) |
| `user` lines with `isSidechain: true` (prompts written by the parent agent to a subagent) | no |
| `image` parts | no |
| `last-prompt.lastPrompt`, `ai-title.aiTitle`, `history.jsonl`, `attachment.*`, assistant text/thinking, tool inputs | **never** |

`last-prompt`, `ai-title` and `history.jsonl` contain prompt text, and `cost-state` contains cost figures. Because they are never parsed into payload objects, category OFF means that data is not even held in memory past the line parse.

## 11. Append/rewrite behavior and checkpoint implications

- **[V] Append-only with a stable inode.** The probe ran before and after a new session plus two resumes (`--compare`):
  - Run 1: 2 grew append-only, 914 unchanged, 0 rewritten, 0 identity changed, 1 new file.
  - Run 2: 4 grew append-only, 913 unchanged, 0 rewritten, 0 identity changed, 0 new.
- **Checkpoint implications:**
  - A byte-offset checkpoint `{file_identity (dev:ino), size, mtime_ms, offset}` is sound.
  - Shrink or identity change ⇒ restart at 0 (not observed; kept as a safety net). Deletion by the retention sweep ⇒ drop the checkpoint.
- **Every file ended with `\n`** [V]. A partial last line is still possible while Claude is mid-write, so the reader consumes only up to the last `\n`.
- **Lines can be up to 4.98 MB** [V]. The tail reader must buffer across its 256 KB blocks until a newline arrives and must not treat a long line as corrupt.
- **Cost:** about 1.2 GB and 918 files on a heavy user's machine. The probe parses all of it in about 1.4 s on 8 threads. The agent's steady state is stat-only, tail reads touch only appended bytes, and the initial scan honours `since`.

## 12. Permissions per OS

| OS | Status | Detail |
|---|---|---|
| macOS | **[V]** | `~/.claude` has mode `700` and is owned by the user; the agent runs as that user (LaunchAgent), so it is readable. `~/.claude.json` is in the home dir. Dotdirs in home are not TCC-protected. **[H] Risk for H19:** reading `<cwd>/.git/config` (Git ON) when `cwd` is under `~/Documents`, `~/Desktop` or `~/Downloads` may trigger a TCC prompt or denial for a background process. Treat a denial as "no git remote", never retry-loop. |
| Windows | [H] | `%USERPROFILE%\.claude` inherits the user-profile ACL; the agent runs as the same user (per-user Scheduled Task), so it is readable. Paths can contain spaces and non-ASCII characters. |
| Linux | [H] | `$HOME/.claude` is owned by the user; `systemd --user` runs as that user. |

**Operator command for H24** (Windows/Linux). Run it from a checkout, or copy the single file `probe.mjs`; it needs Node ≥ 18 and no install:

```
node tools/claude-data-probe/probe.mjs --out probe-<os>-1.json
#   run: claude -p "Reply with the single word ok."   then   claude -p "Reply ok." --continue
node tools/claude-data-probe/probe.mjs --compare probe-<os>-1.json --out probe-<os>-2.json
```

The reports contain structure only. Check them with `grep -E "@|/Users/|/home/|C:\\\\" probe-*.json` (it must print nothing), then attach them to H24. H24 fills in the Windows and Linux columns of §4 and §12 and resolves every [H] in §2 and §7.

## 13. Unknowns and risks

| # | Item | Status | Mitigation |
|---|---|---|---|
| 1 | Format is internal and changes between versions [D] | risk | Tolerant parser; the probe is re-run on major Claude Code updates; skipped-line counts appear in diagnostics |
| 2 | Windows paths and project-dir encoding | UNVERIFIED — H24 | Project from `cwd`, never the dir name |
| 3 | Linux path, XDG | UNVERIFIED — H24 | XDG candidates checked defensively |
| 4 | `CLAUDE_CONFIG_DIR` in a service environment; `.claude.json` location when it is set | UNVERIFIED — H24 | Adapter candidate order (§2); manual folder fallback |
| 5 | WSL sessions invisible to the Windows agent | UNVERIFIED — H24 | Documented V1 limitation |
| 6 | No session end marker | verified absent | `ended_at` null; `sessions/<pid>.json` is a possible future signal |
| 7 | Account is global, not per session | verified | Scan-time attribution (§9) |
| 8 | Transcripts deleted after `cleanupPeriodDays` (30) [D] | risk | Frequent sync; missing-file handling |
| 9 | One split id with a trailing all-zero usage line | verified (1 of 47,449) | Per-field max |
| 10 | Split lines crossing a scan boundary | inherent | Backend `GREATEST` merge; `recorded_at` = first line |
| 11 | macOS TCC on `.git/config` under protected folders | [H] — H19 | Treat as no remote |

## 14. PRD §14 checklist per OS

| PRD §14 item | macOS | Windows | Linux | Where |
|---|---|---|---|---|
| Session structure | **verified** | UNVERIFIED — H24 | UNVERIFIED — H24 | §3–4 |
| Stable session identifiers | **verified** (`sessionId` == file name, 100%, stable across resume) | UNVERIFIED | UNVERIFIED | §3, §8 |
| Token fields | **verified** | UNVERIFIED | UNVERIFIED | §5–6 |
| Project information | **verified** (`cwd` 100%) | UNVERIFIED | UNVERIFIED | §7 |
| Model information | **verified** (`message.model` 100%) | UNVERIFIED | UNVERIFIED | §4–5 |
| Account information | **verified** (global `oauthAccount`, nullable) | UNVERIFIED | UNVERIFIED | §9 |
| Timestamps | **verified** (ISO-8601 ms `Z`) | UNVERIFIED | UNVERIFIED | §8 |
| Session updates | **verified** (append-only, stable inode) | UNVERIFIED | UNVERIFIED | §11 |
| Message/prompt availability | **verified** | UNVERIFIED | UNVERIFIED | §10 |
| Completed vs active sessions | **verified**: no end marker; `ended_at` null | UNVERIFIED | UNVERIFIED | §8 |

## 15. Fixtures

`6am-agent/test/fixtures/claude/` holds synthetic files that follow the structure above (fake UUIDs, `/home/dev/projects/demo-app`, `dev@example.com`, lorem ipsum text). `expected/*.json` holds the normalized output per fixture under the rules of §5–6, with all categories ON. H09 asserts against these files, and H23 uses them as oracle inputs. The file list and what each file exercises are in `6am-agent/test/fixtures/claude/README.md`.

Token-sum arithmetic (hand-checked):

Each message is written as (input, output, cache_creation, cache_read) after the per-field MAX merge (§6). `<synthetic>` lines are skipped. `actual`/`total` are reference values for tests only; token math lives in the backend.

- **basic-session:** `01` is 3 identical split lines → (3, 85, 1200, 15000); `02` (5, 120, 300, 16200); `03` (8, 42, 0, 17500).
  - input 3+5+8 = 16 · output 85+120+42 = 247 · cache_creation 1200+300+0 = 1500 · cache_read 15000+16200+17500 = 48700
  - actual 16+247+1500 = **1763** · total 1763+48700 = **50463**
  - Summing the split lines instead of deduplicating would give input 22 and output 417.
- **subagent** (main + subagent files, one session): main `01` (4, 60, 2000, 10000); sidechain `01` is 2 identical lines → (10, 30, 5000, 0); sidechain `02` (2, 150, 400, 5000).
  - input 16 · output 240 · cache_creation 7400 · cache_read 15000
  - actual **7656** · total **22656**
- **multi-model:** sonnet (10, 50, 1000, 0) and (12, 70, 200, 1000); opus (20, 90, 3000, 0) and (3, 200, 150, 3000).
  - input 45 · output 410 · cache_creation 4350 · cache_read 4000
  - actual **4805** · total **8805**
  - Session model = `claude-opus-5`.
- **malformed:** one complete message (7, 77, 700, 7000); the truncated 200-byte tail is not consumed (offset 1896 of 2096).
  - actual 7+77+700 = **784** · total **7784**
- **split-usage-growing:** `01` has output 10 → 10 → 250 → (6, 250, 500, 9000); `02` is (4, 64, 100, 9500) followed by the all-zero line → (4, 64, 100, 9500).
  - input 10 · output 314 · cache_creation 600 · cache_read 18500
  - actual **924** · total **19424**
  - "Last line wins" would give output 250 and cache_read 9000, because `02` collapses to zeros.

The expected files were cross-checked by two independent implementations of these rules (one written with the fixtures, one written separately during verification). Both matched every `expected/*.json` exactly.
