# Token Validation Report (PRD Phase 8, H23)

Date: 2026-09-24 · Branch `handover/H23-token-validation` · Machine: macOS 26 (Darwin 25.3.0, arm64), Claude Code 2.1.274, Node 24/25.

**Result: every metric is equal at every layer.** Raw Claude data (oracle) = agent reader/payload = database = H07 queries = dashboard pages, for fixtures, generated datasets and a controlled real session. No mismatch was found, so no follow-up handover is needed for token correctness. PRD §61 AC23–AC26 are proven below.

## 1. Method

Four independent sources are compared for every metric (Input, Output, Cache Creation, Cache Read, Actual Consumed, Total Token Activity, message count):

| Source | What it is | Where |
|---|---|---|
| **Oracle** | `tools/token-audit/token-audit.mjs`: a zero-dependency reference implementation written only from `docs/contracts/claude-data-contract.md` §3–6, §11, §15. It imports nothing from `6am-agent/src` or `agent-dashboard/app` (its only imports are `node:fs`, `node:fs/promises`, `node:path`, `node:url`, `node:util`). It dedups by `message.id` (fallback `requestId`, then `uuid`) with a per-field max, skips `<synthetic>`, ignores partial trailing lines, and groups by session, org day (`--tz`, default `Asia/Dhaka`), model and session×day. | CLI |
| **Agent** | The H09 reader (`createClaudeScanner`) output, or the exact HTTP body the agent sent, depending on the test. The agent never computes Actual/Total (invariant 1); tests sum the four raw fields themselves. | `6am-agent/test/validation/**` |
| **DB** | Raw SQL `SUM()` over `session_usage` (not the rollups), the `claude_sessions` row columns, and `usage_daily_rollups`. | backend tests, real-session SQL |
| **Dashboard** | H07 `TokenAnalytics` / `SessionSearch` / `ActivityStats`, plus the Inertia props and rendered pages of `/sessions`, `/sessions/{id}` and `/analytics/tokens`. | backend tests, headless Chrome |

The backend tests compute the expected values a third way: PHP arithmetic over the dataset they send, with `actual = in + out + cc` and `total = actual + cr` written inline (`App\Support\TokenMath` is not called).

### Oracle usage

```
node tools/token-audit/token-audit.mjs --dir <claude data dir> [--session <id>]... [--since <ISO-8601>] [--tz <IANA>] [--json]
```

The oracle is read-only. It prints only ids, dates, models and numbers, never prompt text, cwd or cost data. On this Mac's full `~/.claude` (1.3 GB, 986 files, 281,358 lines, 50,215 distinct messages from 104,480 usage lines) it runs in about 3 s.

## 2. Controlled fixtures (H02) — oracle vs agent reader vs contract

`6am-agent/test/validation/`: 18 tests plus 1 opt-in real-data test.
- The real H09 scanner runs with every category ON except prompt and git.
- The oracle runs as a black-box child process on the same directory.
- The tests compare totals, every session, every org day (Asia/Dhaka), every model and every session×day.

Values are In / Out / CC / CR / Actual / Total / Msgs; all three columns are equal in every row.

| Fixture | Contract `expected/*.json` | Oracle | Agent reader |
|---|---|---|---|
| basic-session (1 message split over 3 identical lines, `<synthetic>` skipped) | 16 / 247 / 1,500 / 48,700 / **1,763** / **50,463** / 3 | same | same |
| subagent (main + `subagents/` file, one session) | 16 / 240 / 7,400 / 15,000 / **7,656** / **22,656** / 3 | same | same |
| multi-model | 45 / 410 / 4,350 / 4,000 / **4,805** / **8,805** / 4 | same | same |
| malformed (bad JSON, unknown type, partial last line not consumed) | 7 / 77 / 700 / 7,000 / **784** / **7,784** / 1 | same | same |
| split-usage-growing (output 10 → 10 → 250; trailing all-zero line) | 10 / 314 / 600 / 18,500 / **924** / **19,424** / 2 | same | same |
| basic-session incremental from byte 4419 | 13 / 162 / 300 / 33,700 / **475** / **34,175** / 2 | same (`--since` and tail-only dir) | same |
| malformed + completion appended, second scan from checkpoint | 9 / 99 / 900 / 9,000 / **1,008** / **10,008** / 1 | same | same |

The same folder also tests these cases:
- **Split lines.**
  - (a) Output grows across the split lines, and the last line has every token field 0.
  - (b) The split lines of one message straddle a **chunk** boundary (`maxUsagePerChunk: 1`).
  - (c) They straddle an **incremental scan** boundary, and org midnight at the same time.
  - In (b) and (c) the agent sends the same `message.id` twice. The backend's merge rule is modelled in the test: one row per (session, message), per-field max, earliest `recorded_at`. The merged result equals the oracle, and summing naively would overcount.
- **Cross-midnight.**
  - Usage at 17:59:59.999Z and 18:00:00.000Z lands on 2026-09-22 and 2026-09-23 in Asia/Dhaka, and the agent's day buckets equal the oracle's.
  - A 23:59:59.999Z / 00:00:00.000Z pair splits only under `--tz UTC`.
- **Generated datasets** (seeds 1, 7, 2026, and 42 in chunks of 7):
  - 3 projects × 4 sessions with subagent files.
  - Split lines, both identical and growing, and trailing all-zero lines.
  - A `<synthetic>` line, a malformed line and a partial trailing line.
  - 3 models over about 4 days.
- **Real data (opt-in, read-only).** `H23_REAL_CLAUDE_DIR=$HOME/.claude` compares the agent reader with the oracle over **all** of this Mac's Claude data:
  ```
  {"files":993,"chunks":102,"emittedUsage":50754,"sessions":615,"days":24,"models":6,"oracleMessages":50425,"agentMessages":50425,"oracleMs":2487,"agentMs":2604,"liveSessionsExcluded":1,"mismatches":0}
  ✓ … agent == oracle on totals, every session, day, model and session-day
  ```
  - 329 messages straddled one of the 102 chunk boundaries. They were emitted twice and come out right only after the server merge.
  - One session was still being written during the run (the live Claude Code session running this validation). It is excluded and counted, because the oracle and the agent read it at different moments.
  - `H23_REAL_SESSION=806aade6…` passes for the controlled session in §4.
- **Mutation checks** (each change was applied, the suite run, then the change reverted):
  - Summing duplicates instead of merging fails the split tests.
  - Bucketing days in UTC fails 6 tests.
  - Changing an expected sum by 1 fails all 7 fixture tests.

Scope note: the oracle treats a `message.id` as one message across all sessions, while the agent and backend key usage by (session, message). An id in two sessions would therefore count once in the oracle and twice in the product. The contract measured 0 ids across sessions [V], and the real-data run above confirms it for current data.

## 3. Backend validation (generated datasets through the real `/api/agent/v1/sync`)

`agent-dashboard/tests/Feature/TokenValidation/`: 19 tests, 1,152 assertions. All data enters through `POST /api/agent/v1/sync` as paired devices. In every row, dataset arithmetic = SQL over `session_usage` = H07 = dashboard props.

### 3.1 PRD §20 example

| Metric | Dataset | SQL `session_usage` | `claude_sessions` row | H07 totals / trend / every breakdown | Session page | Token analytics page |
|---|---|---|---|---|---|---|
| Input Tokens | 100,000 | 100,000 | 100,000 | 100,000 | 100,000 | 100,000 |
| Output Tokens | 20,000 | 20,000 | 20,000 | 20,000 | 20,000 | 20,000 |
| Cache Creation Tokens | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 | 30,000 |
| Cache Read Tokens (shown separately) | 500,000 | 500,000 | 500,000 | 500,000 | 500,000 | 500,000 |
| **Actual Consumed Tokens** | **150,000** | 150,000 | 150,000 | 150,000 | 150,000 | 150,000 |
| **Total Token Activity** | **650,000** | 650,000 | 650,000 | 650,000 | 650,000 | 650,000 |

The example is spread over 4 messages, and one message is re-delivered later with a lower output. The per-field max keeps the totals unchanged.

### 3.2 H03 contract example (`docs/contracts/examples/sync.request.full.json`)

| Session | In / Out / CC / CR | Actual | Total | Msgs |
|---|---|---|---|---|
| `3cd4…` | 1,206 / 1,178 / 48,433 / 28,779 | 50,817 | 79,596 | 2 |
| `7a1e…` | 6 / 1,450 / 2,210 / 60,312 | 3,666 | 63,978 | 1 |

All of it falls on org day 2026-09-23. Model totals (haiku, opus, sonnet) each equal their single message. JSON arithmetic = SQL = H07.

### 3.3 Generated dataset: 3 developers × 2 projects, cross-midnight, split delivery

Deterministic (`mt_srand(20260923)`):
- 3 developers, each with their own device (macOS, Windows, Linux).
- Projects `atlas` and `borealis`, plus one session with no project and no account.
- 2 models, 8 sessions, 20 unique messages, org tz `Asia/Dhaka`.

Every value below agrees across dataset arithmetic, SQL over `session_usage`, H07 and the dashboard props. For sessions, the `claude_sessions` row, `SessionSearch`, `recentSessions`, and the sessions index and show pages also agree.

| Session | In / Out / CC / CR | Actual | Total | Msgs |
|---|---|---|---|---|
| alice-atlas-midnight | 11,008 / 6,468 / 40,057 / 253,612 | 57,533 | 311,145 | 4 |
| alice-borealis-month | 7,776 / 7,131 / 20,349 / 103,412 | 35,256 | 138,668 | 3 |
| alice-atlas-late | 6,872 / 1,217 / 8,107 / 292,918 | 16,196 | 309,114 | 2 |
| bob-atlas-utc-midnight | 6,038 / 6,373 / 52,219 / 329,574 | 64,630 | 394,204 | 3 |
| bob-borealis-prev-week | 7,220 / 5,733 / 30,272 / 153,616 | 43,225 | 196,841 | 2 |
| carol-atlas-new-year | 6,790 / 2,793 / 18,236 / 382,335 | 27,819 | 410,154 | 2 |
| carol-unassigned | 2,498 / 5,410 / 21,564 / 286,852 | 29,472 | 316,324 | 2 |
| carol-borealis-split | 3,952 / 4,397 / 15,099 / 175,265 | 23,448 | 198,713 | 2 |
| **Grand total** | 52,154 / 39,522 / 205,903 / 1,977,584 | **297,579** | **2,275,163** | 20 |

| Axis | Values (Actual / Total / Msgs) |
|---|---|
| Developer (= device) | alice 108,985 / 758,927 / 9 · bob 107,855 / 591,045 / 5 · carol 80,739 / 925,191 / 6 |
| Project | atlas 166,178 / 1,424,617 / 11 · borealis 101,929 / 534,222 / 7 · Unknown 29,472 / 316,324 / 2 |
| Model | opus 140,507 / 1,352,426 / 10 · sonnet 157,072 / 922,737 / 10 |
| Claude account | alice-work 108,985 / 758,927 · bob-work 107,855 / 591,045 · carol-personal 51,267 / 608,867 · Unknown 29,472 / 316,324 |

Per org day (Asia/Dhaka), Actual / Total / Msgs:

| Day | Actual | Total | Msgs |
|---|---|---|---|
| 2025-12-31 | 7,252 | 174,736 | 1 |
| 2026-01-01 | 20,567 | 235,418 | 1 |
| 2026-08-27 | 43,225 | 196,841 | 2 |
| 2026-08-29 | 29,472 | 316,324 | 2 |
| 2026-08-30 | 42,412 | 285,151 | 2 |
| 2026-08-31 | 26,848 | 64,163 | 3 |
| 2026-09-01 | 23,529 | 100,499 | 2 |
| 2026-09-02 | 88,078 | 592,917 | 5 |
| 2026-09-03 | 16,196 | 309,114 | 2 |

What the dataset covers:
- **Cross-midnight.**
  - `alice-atlas-midnight` has usage at 17:59:59.999Z (org day 08-30) and 18:00:00.000Z (org day 08-31). The day buckets are 42,412 / 285,151 and 15,121 / 25,994, and they add up to the whole session (57,533 / 311,145).
  - `bob-atlas-utc-midnight` runs from 23:30Z to 00:00Z. UTC midnight is not an org-day boundary, so all of it lands on 09-02.
  - `carol-atlas-new-year` crosses the org year boundary.
- **Split-line / repeated delivery.** `msg_split` is delivered in three batches (output 100, then 866, then an all-zero line). It is stored once as 7 / 866 / 1,200 / 5,000 (Actual 2,073, Total 7,073). Replaying an identical batch changes nothing.
- **Periods.**
  - Day, week (Monday start), month and year trend buckets.
  - Custom ranges: 08-30..09-01 (crosses a week and a month boundary), 08-31 alone, 2025-12-31..2026-01-01, and the full range.
  - Developer and developer+project filters.
- **Identities checked on every returned row.**
  - `actual + cache_read = total`.
  - The sum over every breakdown dimension equals the totals.
  - The stored `actual_consumed_tokens` / `total_token_activity` columns equal the formula recomputed in SQL.
- **Recalculation.** `monitor:recalculate-tokens` reproduces identical session, project and rollup totals, and rebuilds deliberately tampered calculation columns back to the formula values.

Mutation check: each deliberate break was applied, the suite was run, and the change was reverted.

| Deliberate break | Result |
|---|---|
| Total leaves out cache read | 19 fail |
| Duplicates summed instead of max | 11 fail |
| Org day taken in UTC | 12 fail |
| Week starts on Sunday | week test fails |
| PRD literal changed by 1 | 1 fails |

## 4. Controlled real session (this Mac)

Setup:
- A scratch project `h23-scratch` (an empty directory) got one real Claude Code session of 3 prompts. The first ran with `claude -p`, the other two with `claude -p --continue`, all on `claude-haiku-4-5-20251001`. Each prompt was a one-word neutral instruction; prompt text is not recorded here, and Prompt tracking stayed OFF.
- The session transcript (48 lines, session `806aade6…`, 2026-09-24 07:02:00Z–07:02:16Z) was copied into an isolated Claude data dir.
- A dev build of the agent (`npm run build`, channel dev) was paired against a local backend (`php artisan serve`, database `claude_monitor_h23`, default tracking settings: prompt, git and network OFF).
- The agent ran through a local recording proxy that saved the exact `/sync` body it sent.
- The agent synced 1 batch: 6 records accepted, 0 rejected (1 account, 1 project, 1 session, 3 usage, 0 messages).

Each API response was written as 2 lines with identical usage: 6 usage lines, 3 distinct `message.id`s. The oracle and the agent both count 3, not 6.

| Metric | Oracle, isolated dir | Oracle, real `~/.claude --session` | Agent payload (`/sync` body) | DB `session_usage` SUM | DB `claude_sessions` row | DB `usage_daily_rollups` | Dashboard session page | Token Analytics (2026-09-24, project h23-scratch) |
|---|---|---|---|---|---|---|---|---|
| Input Tokens | 30 | 30 | 30 | 30 | 30 | 30 | 30 | 30 |
| Output Tokens | 381 | 381 | 381 | 381 | 381 | 381 | 381 | 381 |
| Cache Creation Tokens | 12,650 | 12,650 | 12,650 | 12,650 | 12,650 | 12,650 | 12,650 (12.7K) | 12,650 (12.7K) |
| Cache Read Tokens | 85,126 | 85,126 | 85,126 | 85,126 | 85,126 | 85,126 | 85,126 (85.1K) | 85,126 (85.1K) |
| Actual Consumed Tokens | 13,061 | 13,061 | — (not computed by the agent) | 13,061 | 13,061 | 13,061 | 13,061 (13.1K) | 13,061 (13.1K) |
| Total Token Activity | 98,187 | 98,187 | — (not computed by the agent) | 98,187 | 98,187 | 98,187 | 98,187 (98.2K) | 98,187 (98.2K) |
| Messages | 3 | 3 | 3 | 3 | — | 3 | 3 | 3 |

Notes on the real-session table:
- **Agent payload.** Its raw sums, run through the PRD formulas, give 13,061 / 98,187.
- **Session page.** Its per-message usage timeline rows are (10, 270, 10,103, 20,828), (10, 65, 2,436, 30,931) and (10, 46, 111, 33,367), which sum to the totals above.
- **Token Analytics.** The day trend (2026-09-24) and the Project and Model breakdowns (`h23-scratch`, `claude-haiku-4-5-20251001`) show the same values.
- **Sessions index.** The row shows Actual 13,061 and Total 98,187.
- **How the dashboard values were read.** The exact numbers come from the pages' Inertia props, captured with headless Chrome. The rendered pages show the compact values in parentheses. Screenshots of the session page, the filtered Token Analytics page and the sessions index were checked visually. They are not committed, because they show the paired account's email.
- **Org day.** The session ran at 13:02 in Asia/Dhaka, so it lands on org day 2026-09-24 everywhere.
- **Privacy.** The captured payload contains no prompt text, `session_messages` is empty, and the payload has `messages: []`.

## 5. Billing equivalence (PRD §20, §59)

**The local data does not establish any equivalence between Actual Consumed Tokens and Anthropic billing or subscription quota.** Actual Consumed Tokens and Total Token Activity stay monitoring calculations. The dashboard labels them that way ("a monitoring calculation, not an Anthropic billing or quota value").

What the local data holds (key names inspected, not values):
- **`message.usage`** holds `input_tokens`, `output_tokens`, `cache_creation_input_tokens` (with its `ephemeral_5m` / `ephemeral_1h` breakdown), `cache_read_input_tokens`, `output_tokens_details.thinking_tokens`, `server_tool_use.{web_search,web_fetch}_requests`, `service_tier`, `inference_geo`, `iterations` and `speed`. These are counts and request metadata. There is no price, plan, quota or limit field.
- **Money-like figures come from Claude Code itself.** Claude Code writes a client-side cost estimate in `cost-state` lines (`totalCostUSD`, `modelUsage`; contract §4) and returns `total_cost_usd` in `claude -p --output-format json`. These are local estimates, not an invoice or quota ledger. The agent never reads them (contract §4, §10).
- **`~/.claude.json` `oauthAccount`** has billing-type and tier fields. These describe the account, not per-token consumption against a quota, and the agent never keeps them.
- **What is missing entirely:** subscription quota consumption, rate-limit utilisation and invoice data. None of it is in the local data.

Exact billing reconciliation therefore stays out of scope (PRD §59).

## 6. Mismatches and follow-ups

No token mismatches were found between the oracle, the agent, the DB and the dashboard.

Non-token issues found while running the real session (filed for the orchestrator, not fixed here):
1. **A dev agent build is rejected by a fresh backend.** `npm run build` stamps agent version `0.1.0`, while the default `tracking_settings.min_agent_version` is `1.0.0`. The first heartbeat got `426 agent_outdated`. For this run, the local DB's `min_agent_version` was set to `0.1.0` through tinker. Owners: H18 (version stamping) or H22 (E2E harness setup).
2. **`npm run build` leaves an untracked `6am-agent/.cache/`** (the Node runtime download cache), and `6am-agent/.gitignore` does not ignore it. Owner: H18.

## 7. How to reproduce

```
cd 6am-agent && npx vitest run test/validation
H23_REAL_CLAUDE_DIR=$HOME/.claude npx vitest run test/validation   # opt-in: agent reader vs oracle over all real data
cd agent-dashboard && php artisan test --filter=TokenValidation
node tools/token-audit/token-audit.mjs --dir ~/.claude --session <id>
```
