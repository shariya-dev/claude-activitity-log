# Claude Code transcript fixtures (synthetic)

All values here are made up: fake UUIDs (`0b7c1a2e-4f3d-4a8b-9c1d-00000000000N` for sessions), `msg_01FIXTURE…` and `req_01FIXTURE…` ids, cwd `/home/dev/projects/demo-app` (and `…/packages/api`), `dev@example.com`, `Dev Example`, `Example Org`, and lorem ipsum text. Timestamps fall between 2026-09-20 and 2026-09-22, formatted like `2026-09-22T06:50:32.929Z`. The line structure matches what the structure-only probe (`tools/claude-data-probe`) found in real Claude Code 2.1.274 data on macOS.

## Files

| File                                                                                                    | Session | What it exercises                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basic-session.jsonl`                                                                                   | `…0001` | 2 typed prompts (string content). 3 API messages. `msg_…basic…01` is split across 3 lines (thinking/text/tool_use) with identical usage, and `stop_reason` is set only on the last of those lines. Also has a `tool_result` user line with `sourceToolAssistantUUID`, an `isMeta` user line, an `attachment`, a `system/turn_duration`, and `mode`, `atis-latch`, `queue-operation` (which has a timestamp), `ai-title`, `cost-state` and `last-prompt` (last line). One `<synthetic>` assistant line (UUID id, no `requestId`, zero usage) is the latest timestamped line. `gitBranch` changes from `main` to `feature/demo` at the second prompt. |
| `subagent/<SID>.jsonl` + `subagent/<SID>/subagents/agent-a1fixture.jsonl` + `agent-a1fixture.meta.json` | `…0002` | The main file has 1 prompt, 1 API message (a `Task` tool_use), a tool_result and `last-prompt`. The subagent file carries the parent sessionId, `isSidechain: true` and `agentId: "a1fixture"`. It has 1 sidechain prompt (not a message) and 2 API messages, one split over 2 lines. The cwd changes to `…/packages/api` partway through the subagent file. Entrypoint is `claude-vscode`.                                                                                                                                                                                                                                                         |
| `multi-model.jsonl`                                                                                     | `…0003` | The model switches mid-session: 2 × `claude-sonnet-5`, then 2 × `claude-opus-5`. The third prompt is an array of 2 `text` parts (joined with `\n`). Entrypoint is `sdk-cli`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `malformed.jsonl`                                                                                       | `…0004` | Valid lines, a `{not json` line, an unknown `future-unknown-type` line, and a truncated assistant line with **no trailing newline** (200 bytes, which must not be consumed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `split-usage-growing.jsonl`                                                                             | `…0005` | `msg_…growing…01` spans 3 lines with output_tokens 10, 10, 250 (stop_reason only on the last). `msg_…growing…02` spans 2 lines: real values first, then a trailing line with every token field 0 (a real anomaly). Entrypoint is `sdk-ts`.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `claude.json`                                                                                           | –       | A fake `~/.claude.json` with `oauthAccount` (all 14 real keys) plus `numStartups`, `installMethod`, `userID`, `projects`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `claude-no-account.json`                                                                                | –       | The same file without `oauthAccount`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `expected/*.json`                                                                                       | –       | The normalized output each fixture must produce (the contract).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Normalization rules the expected files encode

All categories are ON, including prompt tracking, so `messages` is populated.

- **Usage.** Taken from `assistant` lines that have `message.usage`. Lines whose `message.model` is `<synthetic>` are skipped. Records are keyed by `message.id`; duplicate lines are merged by taking the MAX of each token field. `recorded_at` is the timestamp of the first line for that id. `request_id` is `requestId`, or null. `is_sidechain` is `isSidechain === true`. Records are sorted by `recorded_at`, then `source_message_id`.
- **Sessions.** `first_seen_at` and `last_seen_at` are the min and max `timestamp` over every line that has one, including `queue-operation`. `ended_at` is always null. `claude_code_version`, `entrypoint` and `git_branch` come from the latest-timestamped line that has them. `model` comes from the latest non-synthetic usage line. `cwd` comes from the first line with a cwd in the MAIN file.
- **Messages.** Only non-meta, non-sidechain `user` lines count: either string content, or the text parts joined with `\n`. `tool_result` lines are excluded.
- **Line accounting.** `linesTotal` counts complete lines (ending in `\n`). `linesSkipped` counts non-JSON lines plus unknown types. `partialTrailingBytes` is the bytes after the last `\n`. `consumedBytes` is the byte offset just after the last `\n`. For `subagent`, each of these is an object keyed by path relative to `subagent/`.
- **tokenSums.** These are **reference values for tests only**. The agent never computes `actual` or `total`; token math lives only in the backend (`App\Support\TokenMath`). `actual = input + output + cache_creation`, and `total = actual + cache_read`.

## Hand arithmetic

Values are given as (input, output, cache_creation, cache_read) per `message.id`, after the MAX merge.

### basic-session (18 lines, 0 skipped, 9238 bytes)

- `basic…01`: 3 identical lines → (3, 85, 1200, 15000)
- `basic…02`: (5, 120, 300, 16200)
- `basic…03`: (8, 42, 0, 17500)
- The `<synthetic>` line is skipped (all zeros anyway).
- input 3+5+8 = **16**; output 85+120+42 = **247**; cache_creation 1200+300+0 = **1500**; cache_read 15000+16200+17500 = **48700**
- actual 16+247+1500 = **1763**; total 1763+48700 = **50463**
- Session: first_seen is the queue-operation at 06:50:30.000Z; last_seen is the synthetic line at 06:51:20.000Z; git_branch is `feature/demo`; model is `claude-sonnet-5`. Messages are the 2 typed prompts (isMeta and tool_result excluded).

### subagent (main 4 lines / 2249 bytes, subagent 5 lines / 4026 bytes)

- `submain…01` (main, sidechain false): (4, 60, 2000, 10000)
- `subagent…01` (2 identical lines, sidechain true): (10, 30, 5000, 0)
- `subagent…02` (sidechain true): (2, 150, 400, 5000)
- input 4+10+2 = **16**; output 60+30+150 = **240**; cache_creation 2000+5000+400 = **7400**; cache_read 10000+0+5000 = **15000**
- actual 16+240+7400 = **7656**; total 7656+15000 = **22656**
- Session: first_seen is 10:00:00.000Z; last_seen is the main tool_result at 10:00:30.000Z. model is `claude-haiku-5`, because the latest usage line is the subagent's at 10:00:09.000Z. cwd is the main file's `/home/dev/projects/demo-app`, not the subagent's `packages/api`. There is 1 message; the sidechain prompt is excluded.

### multi-model (8 lines, 0 skipped, 5769 bytes)

- `multi…01` sonnet (10, 50, 1000, 0); `multi…02` sonnet (12, 70, 200, 1000)
- `multi…03` opus (20, 90, 3000, 0); `multi…04` opus (3, 200, 150, 3000)
- input 10+12+20+3 = **45**; output 50+70+90+200 = **410**; cache_creation 1000+200+3000+150 = **4350**; cache_read 0+1000+0+3000 = **4000**
- actual 45+410+4350 = **4805**; total 4805+4000 = **8805**
- Session model is `claude-opus-5`. There are 3 messages; the third is `"Lorem ipsum dolor.\nSit amet consectetur."`.

### malformed (5 complete lines, 2 skipped, consumed 1896 bytes, partial 200 bytes; file size 2096)

- `malformed…01`: (7, 77, 700, 7000). The truncated `malformed…02` line is not consumed.
- input **7**; output **77**; cache_creation **700**; cache_read **7000**
- actual 7+77+700 = **784**; total 784+7000 = **7784**
- last_seen is 12:01:00.000Z, because the partial line is ignored. There are 2 messages.

### split-usage-growing (7 lines, 0 skipped, 5695 bytes)

- `growing…01`: lines with output 10, 10, 250 → MAX gives (6, 250, 500, 9000); recorded_at is 08:00:03.000Z (the first line)
- `growing…02`: (4, 64, 100, 9500) then (0, 0, 0, 0) → MAX gives (4, 64, 100, 9500)
- input 6+4 = **10**; output 250+64 = **314**; cache_creation 500+100 = **600**; cache_read 9000+9500 = **18500**
- actual 10+314+600 = **924**; total 924+18500 = **19424**
- last_seen is 08:00:06.005Z (the zero-usage line still counts as a timestamped line).

### account / account-none

- `account.json` holds the 5 fields mapped from `claude.json`'s `oauthAccount` (accountUuid, emailAddress, displayName, organizationUuid, organizationName).
- `account-none.json` is `null`.
