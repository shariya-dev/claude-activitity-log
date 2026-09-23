# Claude Code Activity Monitor — Architecture (V1)

Source of truth for requirements: [`/PRD.md`](../../PRD.md). This folder is the source of truth for **how** it is built.
If this folder and the PRD disagree, the PRD wins and this folder must be corrected in the same change.

| Doc | Contents |
|---|---|
| [agent.md](agent.md) | Desktop Agent architecture, modules, adapters, packaging, agent tooling & guardrails |
| [backend.md](backend.md) | Laravel + Inertia/Vue app architecture, module layout, packages, conventions, guardrails |
| [sync-protocol.md](sync-protocol.md) | Agent ↔ backend boundary: endpoints, auth, payloads, cursor, idempotency, errors (draft; finalized by H03 into `docs/contracts/sync-api-v1.md`) |
| [data-model.md](data-model.md) | MySQL entities, relationships, indexes, constraints |
| [claude-config.md](claude-config.md) | Where every CLAUDE.md / rule / skill / MCP / setting lives; tool & skill evaluation |
| [../handovers/EXECUTION.md](../handovers/EXECUTION.md) | Execution order (waves) + copy-paste agent prompts |

## 1. System shape

```
Developer device                                   Company server
┌───────────────────────────────────────┐          ┌────────────────────────────────────────────┐
│ Claude Code ──writes──► ~/.claude/…    │          │ agent-dashboard (one Laravel app)           │
│                        (JSONL, json)  │          │                                            │
│ 6am-agent (Node 24 runtime bundled)    │  HTTPS   │  /api/agent/v1/*  (device token, Sanctum)   │
│  Collect → Detect → Normalize → Sync ─┼─────────►│   Validate → Persist → Calculate → Rollup   │
│  SQLite: checkpoints + config only    │◄─────────┼── ack, cursor, settings_version             │
│  LaunchAgent / Scheduled Task / systemd│          │  /  (web, Inertia + Vue, session auth)      │
└───────────────────────────────────────┘          │   View → Filter → Analyze → Configure       │
                                                   │  MySQL 8                                    │
                                                   └────────────────────────────────────────────┘
```

Repository (monorepo, single git repo at this root):

```
/                         CLAUDE.md, PRD.md, .claude/, .mcp.json, docs/
├── 6am-agent/            Node.js + TypeScript desktop agent (+ packaging/)
├── agent-dashboard/      Laravel backend API + Inertia/Vue dashboard (one app)
├── tools/claude-data-probe/   Phase 0 zero-dependency probe script (H02)
└── docs/                 architecture/, contracts/, handovers/
```

## 2. Key decisions (ADR summary)

| # | Decision | Why | Rejected alternative |
|---|---|---|---|
| D1 | One Laravel app serves both agent API and Inertia dashboard | PRD stack; one deploy; shared models | Separate API service (unneeded infra) |
| D2 | Device credentials = Laravel Sanctum personal access tokens on the `Device` model | Hashed at rest, revocable, per-device, zero custom crypto | Custom HMAC keys; OAuth server (overkill) |
| D3 | Pairing = admin-issued one-time pairing code (8 chars, 15-min TTL) entered once in a loopback pairing page / CLI | "Controlled company pairing" with no URLs/creds typed by developer | SSO device flow (V2 candidate) |
| D4 | Backend URL baked into agent build config per company build | Developer must never enter backend URLs (PRD §5) | Prompting user |
| D5 | Usage is ingested **per API message** (`session_usage` row keyed by `message.id`); session totals + daily rollups are derived server-side | Idempotent upsert on stable IDs; backend authoritative calculation (PRD §21) | Agent-computed session totals (not idempotent, not authoritative) |
| D6 | Agent cursor = per-file byte-offset checkpoints in SQLite, committed only after 2xx ack; server returns an opaque ack cursor | Incremental, append-only JSONL; no history in SQLite (PRD §28) | Timestamp cursor (clock skew, rewritten files) |
| D7 | Token upsert uses `GREATEST()` per token column | Streamed/split lines and replayed batches can never lower or double counts | Last-write-wins (replay of partial line lowers values) |
| D8 | Sync processed synchronously inside the HTTP request, in one DB transaction per batch; `QUEUE_CONNECTION=sync` | PRD §27 forbids queue infra; batches are small | Laravel queues/Horizon/Redis |
| D9 | Table `claude_sessions` instead of PRD's `sessions` | Laravel's session driver owns `sessions` | Renaming Laravel's table |
| D10 | Node 24 LTS bundled runtime + esbuild single-file bundle; SQLite via built-in `node:sqlite` (fallback: `better-sqlite3` prebuilds, decided in H01) | No native deps to compile; developer installs nothing | Electron (heavy), pkg (unmaintained) |
| D11 | Per-user background mechanism: macOS LaunchAgent, Windows per-user Scheduled Task (At logon, restart on failure), Linux `systemd --user` unit | Claude data is per-user under the user's home; SYSTEM services can't read it cleanly | Windows SYSTEM service |
| D12 | Roles: `admin`, `viewer` enum on `users` + `can_view_prompts` flag, enforced by Gates/Policies | PRD §53 minimum; no package needed | spatie/laravel-permission (YAGNI) |
| D13 | Project identity: `project_key = sha256(normalized git remote)` when Git tracking is ON and a remote exists, else `sha256(device_uid + "\n" + absolute cwd)` | No git reads when Git is OFF; stable; same repo merges across devs when allowed | Name-based matching (collides) |
| D14 | Network tracking only stores last public IP seen by server when Network category is ON; never used for identity | PRD §26 | Agent-side SSID/IP collection |
| D15 | All timestamps stored UTC; day bucketing uses `MONITOR_TIMEZONE` (default `Asia/Dhaka`) into `recorded_on` | Correct "Today" for the org | Bucketing in UTC |

## 3. PRD invariants every agent must preserve (also in root CLAUDE.md)

1. `actual_consumed_tokens = input + output + cache_creation`; `total_token_activity = actual + cache_read`. Computed **only** by the backend (`App\Support\TokenMath`). Never called "billing" or "quota".
2. Cursor/checkpoints advance **only** after a 2xx sync response whose `success` is true.
3. Prompt OFF ⇒ agent never reads prompt text into payloads, backend drops any `messages` it receives, nothing stored.
4. No Redis/RabbitMQ/Kafka/SQS/Laravel queue workers.
5. Network data never identifies a developer or device. Device identity = hashed machine fingerprint + device token.
6. Platform-specific code only in `6am-agent/src/platform/<os>/`. Backend has no per-OS schema.
7. Disabling/uninstalling a device never deletes history.
8. Only files under the discovered Claude data dir (and `~/.claude.json` for account, `<cwd>/.git/config` only when Git is ON) are read.
