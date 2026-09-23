# Execution Plan & Agent Prompts

This is the single place for **execution order** and the **copy-paste agent prompts**. Every handover is independently executable, reviewable, and committable: it runs in its own git worktree and branch (`handover/HNN-<slug>`), owns an explicit set of files, and depends only on handovers from earlier waves. Each handover's procedure is in [PROTOCOL.md](PROTOCOL.md), and the handover specs are the `HNN-*.md` files next to this one.

How to use it: paste a prompt into a fresh Claude Code session started at the repo root (`/Applications/MAMP/htdocs/Claude-activity-agent`). Prompts are deliberately short — the shared rules (worktree, TDD, validation, review, commit format, guardrails) live once in [PROTOCOL.md](PROTOCOL.md), and the details live once in the handover spec; each prompt names both and adds only what is specific to that handover.

**Orchestrator checklist per wave:** (1) confirm the previous wave is merged into `main` and suites are green; (2) launch every prompt of the wave in separate sessions; (3) review each report (validation tails, review findings, deviations); (4) merge branches with `git merge --no-ff` in the listed order, running full suites after each; (5) `git worktree remove ../cam-HNN`.

## Dependency graph

```
W1  H01 foundation
      │
W2  ┌─┴───────────────┬───────────────────┐
    H02 data contract  H03 sync contract   H04 schema+domain core
      │                 │                   │
W3  ┌─┴──────┬─────────┴──┬────────┬──────┴─┬─────────┐
    H09 reader H10 engine  H05 agent-API  H06 ingestion  H07 analytics  H08 shell+RBAC
      │         │           │   │          │              │              │
W4    │         │           │   └──────────┴──────┬───────┴──────────────┘
      │         │           │        H11 overview · H12 developers · H13 devices+sync · H14 projects
      │         │           │        H15 sessions+prompts · H16 token analytics · H17 admin/settings/audit
W5  H18 app/CLI/pairing/build (H09,H10) · H19 macOS · H20 Windows · H21 Linux   (can run concurrently with W4)
W6  H22 E2E harness · H23 token validation · H24 cross-platform QA + CI
W7  H25 V1 acceptance audit + ops runbook
```

## Wave summary

| Wave | Agents | Parallel | Handovers | Starts after | Merge order |
|---|---|---|---|---|---|
| 1 | 1 | Solo | H01 | — | commits directly on `main` |
| 2 | 3 | Yes | H02, H03, H04 | W1 | H03 → H02 → H04 |
| 3 | 6 | Yes | H05, H06, H07, H08, H09, H10 | W2 | H08 → H05 → H06 → H07 → H09 → H10 |
| 4 | 7 | Yes | H11–H17 | W3 | any |
| 5 | 4 | Yes (may overlap W4) | H18, H19, H20, H21 | W3 | H18 first, then adapters in any order |
| 6 | 3 | Yes | H22, H23, H24 | W4 + W5 | any |
| 7 | 1 | Solo | H25 | W6 + follow-ups | — |

Review/commit boundary: one branch per handover, reviewed via its report, then merged with `git merge --no-ff`. Run the full suites on `main` after every merge. A wave is closed only when all its branches are merged and `main` is green.

---

## Wave 1 — Solo (1 agent)

Sequential, blocks everything. Deliverables: git repo, Laravel app scaffold (starter kit, Sanctum, Boost, Pest, Pint, Larastan, charts), agent scaffold (TS, vitest, eslint, esbuild, zod, `node:sqlite` check), frozen `PlatformAdapter` interface, route glob loaders, Claude config moved into place. Review/commit boundary: one branch, merged before Wave 2 starts.

**Handovers:** [H01](H01-foundation.md)

### H01

```text
Execute handover H01 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H01-foundation.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Bootstrap the monorepo: git init, Laravel vue-starter-kit + Sanctum + Boost + Larastan + chart.js in agent-dashboard/, TypeScript agent scaffold in 6am-agent/, frozen PlatformAdapter interface, route glob loaders, Claude config into place. No product code.
Needs merged: none (bootstrap; no repo yet — work in the main checkout, commit on main) — verify with git log first; stop and report if missing.
Setup: Work in the main checkout on `main` (bootstrap: no repo yet).
Own only: repo root · all of agent-dashboard/ · 6am-agent/ except src/core/** and test/fixtures/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/architecture/{README,agent,backend,claude-config}.md
Watch out: Copy src/platform/types.ts verbatim from agent.md §2 (frozen). No routes/api.php. QUEUE_CONNECTION=sync. Record the node:sqlite-on-Node-24 result in 6am-agent/CLAUDE.md.
Gate (all must pass, paste real output tails): agent-dashboard: php artisan migrate && php artisan test && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build · 6am-agent: npm ci && npm test && npm run lint && npm run typecheck && npm run build && node dist/agent.cjs · prove the eslint core→platform boundary rule fires
```

---

## Wave 2 — 3 agents in parallel

No inter-dependencies (H03 is written against the architecture draft and nullable fields; H02 verifies it). Disjoint files: H02 → `tools/`, `docs/contracts/claude-data-contract.md`, `6am-agent/test/fixtures/claude/`; H03 → `docs/contracts/sync-api-v1.md`, `docs/contracts/{schemas,examples}/`, `6am-agent/src/core/contract/`; H04 → `agent-dashboard/{database,app/Models,app/Enums,app/Support,app/Http/Middleware,config/monitor.php}`. Merge order: H03 → H02 → H04 (any order works; this order lets H02's reviewer check H03's nullables). **H02 note:** macOS is verified by the agent; Windows and Linux runs need a human to execute `probe.mjs` on those machines (≈10 min each). If they are not available, H02 merges with those sections marked `UNVERIFIED` and H24 closes them.

**Handovers:** [H02](H02-claude-data-contract.md), [H03](H03-sync-api-contract.md), [H04](H04-database-schema-domain-core.md)

### H02

```text
Execute handover H02 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H02-claude-data-contract.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Verify Claude Code's local data (PRD Phase 0): a zero-dependency structure-only probe, the contract doc, sanitized fixtures + expected outputs.
Needs merged: H01 — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H02 -b handover/H02-claude-data-contract main   # work only there
Own only: tools/claude-data-probe/** · docs/contracts/claude-data-contract.md · 6am-agent/test/fixtures/claude/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §13–14, §16–19, §24 · docs/architecture/agent.md · the handover's 'Known facts to verify' list · real data at ~/.claude (structure only)
Watch out: The probe prints structure and statistics only, never values. No real prompts, emails, hostnames or paths in git. Mark Windows/Linux UNVERIFIED unless a human supplies probe output.
Gate (all must pass, paste real output tails): node tools/claude-data-probe/probe.mjs --out /tmp/probe.json (<10 s) · grep -E "@|/Users/" /tmp/probe.json → nothing · grep -rE "6amtech|gmail|/Users/" 6am-agent/test/fixtures → nothing
```

### H03

```text
Execute handover H03 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H03-sync-api-contract.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Freeze sync API v1: normative spec, JSON Schemas, valid + invalid examples, and the agent zod contract module incl. the ScanSource interface.
Needs merged: H01 — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H03 -b handover/H03-sync-api-contract main   # work only there
Own only: docs/contracts/sync-api-v1.md · docs/contracts/{schemas,examples}/** · 6am-agent/src/core/contract/** · 6am-agent/test/unit/contract/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/architecture/sync-protocol.md (draft to finalize) · data-model.md · PRD §27–39
Watch out: Spec, schemas, zod and examples must agree. Agents never send actual/total token fields.
Gate (all must pass, paste real output tails): cd 6am-agent && npm test && npm run typecheck && npm run lint · every JSON under docs/contracts parses
```

### H04

```text
Execute handover H04 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H04-database-schema-domain-core.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Implement the full MySQL schema + shared domain core: models, enums, factories, TokenMath, OrgClock, AuditLog::record, TrackingSetting::current(), device middlewares.
Needs merged: H01 (parallel with H02, H03) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H04 -b handover/H04-database-schema-domain-core main   # work only there
Own only: agent-dashboard: database/{migrations,factories} · app/{Models,Enums} · app/Support/{TokenMath,OrgClock}.php · app/Http/Middleware/{EnsureDeviceIsActive,AttachSettingsVersion}.php · config/monitor.php · tests/{Unit/Domain,Feature/Schema} · middleware-alias lines in bootstrap/app.php only   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/architecture/data-model.md (normative, 1:1) · backend.md · agent-dashboard/CLAUDE.md · PRD §40–42. Boost MCP: database-schema, search-docs
Watch out: Table is claude_sessions, not sessions. restrictOnDelete on monitoring FKs. Token formulas only in TokenMath. Encrypted cast on SessionMessage. Exact signatures from the handover.
Gate (all must pass, paste real output tails): php artisan migrate:fresh && php artisan test && vendor/bin/pint --test && vendor/bin/phpstan analyse
```

---

## Wave 3 — 6 agents in parallel

**Dependencies:** H05 ← H03, H04 · H06 ← H03, H04 · H07 ← H04 · H08 ← H04 · H09 ← H02, H03 · H10 ← H03

Disjoint route files (`routes/agent/device.php` vs `routes/agent/sync.php`), disjoint action folders, disjoint agent folders (`core/claude`+`core/detect` vs `core/sync`+`core/state`+`core/settings`+`core/runtime`). Only H08 touches `bootstrap/providers.php`, `HandleInertiaRequests`, and the sidebar. Merge order: H08 → H05 → H06 → H07 → H09 → H10. Wave boundary: full backend + agent test suites green on `main`.

**Handovers:** [H05](H05-agent-api-pairing-heartbeat-settings.md), [H06](H06-sync-ingestion.md), [H07](H07-analytics-queries.md), [H08](H08-dashboard-shell-rbac.md), [H09](H09-agent-claude-reader.md), [H10](H10-agent-sync-engine.md)

### H05

```text
Execute handover H05 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H05-agent-api-pairing-heartbeat-settings.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Agent endpoints register/heartbeat/settings/sync-status/deregister + device lifecycle Actions (issue pairing code, register, heartbeat, disable, enable, request sync, deregister).
Needs merged: H03, H04 (parallel with H06–H10; don't touch routes/agent/sync.php or app/Actions/Ingestion) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H05 -b handover/H05-agent-api main   # work only there
Own only: agent-dashboard: routes/agent/device.php · app/Http/Controllers/Api/Agent/V1/{Register,Heartbeat,Settings,SyncStatus,Deregister}Controller.php · app/Http/Requests/Agent/{Register,Heartbeat}Request.php · app/Http/Resources/Agent/SettingsResource.php · app/Actions/Agent/** · tests/Feature/Agent/** · tests/Unit/Actions/Agent/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/contracts/sync-api-v1.md (normative) + examples/*.json (use in tests) · .claude/rules/sync-protocol.md · PRD §9, §11, §33, §35
Watch out: Pairing redemption inside a transaction with a row lock. Device found by (developer_id, machine_fingerprint), so re-pair reuses the row and revokes old tokens. Generic 422 for any bad code. Action signatures are a contract for H12/H13.
Gate (all must pass, paste real output tails): php artisan test --filter=Agent && vendor/bin/pint --test && vendor/bin/phpstan analyse && php artisan route:list --path=api/agent
```

### H06

```text
Execute handover H06 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H06-sync-ingestion.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: POST /sync: idempotent single-transaction ingestion, TokenMath calc, session/project totals, daily rollups, replay-safe batches, rejected records, recalculate/mark-offline commands, demo seeder via the real ingestion path.
Needs merged: H03, H04 (parallel with H05, H07–H10) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H06 -b handover/H06-sync-ingestion main   # work only there
Own only: agent-dashboard: routes/agent/sync.php · app/Http/Controllers/Api/Agent/V1/SyncController.php · app/Http/Requests/Agent/SyncRequest.php · app/Http/Resources/Agent/SyncResultResource.php · app/Actions/Ingestion/** · app/Console/Commands/{RecalculateTokens,MarkOffline}.php · routes/console.php (mark-offline schedule line) · database/seeders/MonitorDemoSeeder.php · tests/{Feature/Ingestion,Unit/Actions/Ingestion}/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/contracts/sync-api-v1.md + examples · .claude/rules/{sync-protocol,privacy}.md · data-model.md · PRD §19–22, §27–39
Watch out: Follow the handover's 8-step algorithm. GREATEST on token columns, LEAST/GREATEST on session times. Replay returns the stored response. Any exception ⇒ rollback + 500 persistence_failed, never a 200. Bulk upserts, no per-row saves.
Gate (all must pass, paste real output tails): php artisan test --filter=Ingestion && php artisan db:seed --class=MonitorDemoSeeder && vendor/bin/pint --test && vendor/bin/phpstan analyse · report the timing of a 500-usage batch (<1.5 s)
```

### H07

```text
Execute handover H07 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H07-analytics-queries.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Read-side analytics: DateRange, UsageFilters, Granularity, Dimension, TokenAnalytics, ActivityStats, AgentHealth, SessionSearch, FilterOptions.
Needs merged: H04 (parallel with H05, H06, H08–H10) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H07 -b handover/H07-analytics-queries main   # work only there
Own only: agent-dashboard/app/Queries/Analytics/** · agent-dashboard/tests/Feature/Analytics/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/architecture/data-model.md (rollups, indexes) · backend.md §3 · PRD §22, §43–50
Watch out: Exact signatures from the handover — Wave 4 codes against them. Token metrics from usage_daily_rollups only; counts from claude_sessions/devices. Org timezone, week starts Monday. ≤2 queries per method. Seed with factories.
Gate (all must pass, paste real output tails): php artisan test --filter=Analytics && vendor/bin/pint --test && vendor/bin/phpstan analyse · paste EXPLAIN for the trend and breakdown queries
```

### H08

```text
Execute handover H08 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H08-dashboard-shell-rbac.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Dashboard shell: gates/RBAC, Inertia shared props, full sidebar, placeholder routes + pages for every Wave 4 feature, shared monitor components, TS types, format helpers, monitor:create-admin.
Needs merged: H04 (parallel with H05–H07, H09, H10) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H08 -b handover/H08-dashboard-shell-rbac main   # work only there
Own only: agent-dashboard: app/Providers/MonitorAuthServiceProvider.php · bootstrap/providers.php · app/Http/Middleware/{HandleInertiaRequests,EnsureUserIsActive}.php (+ alias line in bootstrap/app.php) · app/Http/Controllers/Dashboard/PlaceholderController.php · routes/dashboard/{developers,devices,projects,sessions,token-analytics,sync,tracking-settings,audit-logs,users}.php · app/Console/Commands/CreateAdmin.php · resources/js/components/AppSidebar.vue (+ nav config) · resources/js/pages/Placeholder.vue · resources/js/components/monitor/** · resources/js/types/monitor.ts · resources/js/lib/format.ts · tests/Feature/Shell/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/architecture/backend.md §2–3 · agent-dashboard/CLAUDE.md (Boost Inertia/Vue/shadcn) · H07 handover (shapes to mirror) · PRD §43–53
Watch out: Exact route names/paths and gate definitions from the handover — Wave 4 depends on them. No feature logic. Exact PRD metric labels; never cost/billing/quota. No secrets in shared props.
Gate (all must pass, paste real output tails): php artisan test --filter=Shell && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build · manual: every nav item, dark mode, 375 px
```

### H09

```text
Execute handover H09 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H09-agent-claude-reader.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: OS-agnostic Claude data reader as a ScanSource: discovery, incremental tail reads from byte checkpoints, tolerant parsing, dedup by message.id, settings-gated extraction, chunking.
Needs merged: H02, H03 (parallel with H10; don't touch core/{sync,state,settings,runtime}) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H09 -b handover/H09-agent-claude-reader main   # work only there
Own only: 6am-agent/src/core/{claude,detect}/** · 6am-agent/test/unit/{claude,detect}/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/contracts/claude-data-contract.md (normative sources) · sync-api-v1.md · src/core/contract/scan.ts · .claude/rules/privacy.md · 6am-agent/CLAUDE.md · fixtures with expected/*.json
Watch out: Read-only on Claude dirs. Stat-only fast path; complete lines only; restart on shrink/identity change. Prompt/git/account code paths run only when that category is ON. No process.platform. Bounded memory. Chunk checkpoints must match the included lines exactly.
Gate (all must pass, paste real output tails): cd 6am-agent && npm test && npm run lint && npm run typecheck · npx vitest run --coverage ≥90% lines for core/claude + core/detect
```

### H10

```text
Execute handover H10 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H10-agent-sync-engine.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Agent sync engine: SQLite state store, settings manager, zod-validated API client, sync manager with the cursor-commit rule, backoff, heartbeat, runtime loop, redacting logger. Fakes for everything external.
Needs merged: H03 (parallel with H09; don't touch core/claude or core/detect) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H10 -b handover/H10-agent-sync-engine main   # work only there
Own only: 6am-agent/src/core/{state,settings,sync,runtime}/** · 6am-agent/test/unit/{state,settings,sync,runtime}/** · 6am-agent/test/helpers/fakes/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/contracts/sync-api-v1.md + examples · src/core/contract/** · .claude/rules/sync-protocol.md · 6am-agent/CLAUDE.md · PRD §27–33, §39, §55
Watch out: Exact interfaces from the handover. Commit checkpoints only after 200 + success:true, in one SQLite transaction; reuse batch_id on retry. SQLite holds only kv + file_checkpoints. Secrets only via CredentialStore. Timers, not busy loops. Never log tokens/prompts/emails.
Gate (all must pass, paste real output tails): cd 6am-agent && npm test && npm run lint && npm run typecheck · ≥90% coverage for the owned dirs
```

---

## Wave 4 — 7 agents in parallel

All need H07 + H08 (H12, H13 also H05; demo data from H06's seeder). Each owns exactly one `routes/dashboard/<feature>.php`, one controller, one `pages/<Feature>/` folder, and its tests; each replaces the placeholder H08 left for it. Merge in any order.

**Handovers:** [H11](H11-dashboard-overview.md), [H12](H12-dashboard-developers.md), [H13](H13-dashboard-devices-sync-monitor.md), [H14](H14-dashboard-projects.md), [H15](H15-dashboard-sessions-prompts.md), [H16](H16-dashboard-token-analytics.md), [H17](H17-dashboard-admin-settings-audit.md)

### H11

```text
Execute handover H11 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H11-dashboard-overview.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Organization overview (PRD §43): KPIs, token metrics, trend, top breakdowns, recent sessions, offline/stale agents, date presets.
Needs merged: H07, H08 (demo data from H06's seeder; parallel with H12–H17) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H11 -b handover/H11-dashboard-overview main   # work only there
Own only: agent-dashboard: routes/dashboard/overview.php · app/Http/Controllers/Dashboard/OverviewController.php · resources/js/pages/Dashboard.vue · resources/js/pages/Overview/** · tests/Feature/Dashboard/OverviewTest.php   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §43 · docs/handovers/H07-analytics-queries.md (interfaces) · resources/js/components/monitor/ + types/monitor.ts · agent-dashboard/CLAUDE.md
Watch out: Thin controller calling only H07 queries; gate viewMonitoring; default range 'today'. Exact PRD metric labels, no billing wording. Touch only your own route/controller/pages.
Gate (all must pass, paste real output tails): php artisan test --filter=Overview && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build · manual with php artisan migrate:fresh --seed --seeder=MonitorDemoSeeder
```

### H12

```text
Execute handover H12 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H12-dashboard-developers.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Developers (PRD §10, §44–45): list, create/edit/deactivate, detail dashboard, one-time pairing code generation.
Needs merged: H05, H07, H08 (parallel with H11, H13–H17) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H12 -b handover/H12-dashboard-developers main   # work only there
Own only: agent-dashboard: routes/dashboard/developers.php · app/Http/Controllers/Dashboard/{Developer,DeveloperPairingCode}Controller.php · app/Http/Requests/Dashboard/{Store,Update}DeveloperRequest.php · resources/js/pages/Developers/** · tests/Feature/Dashboard/Developers*Test.php   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §9–10, §15, §44–45 · H05 handover (IssuePairingCode) · H07/H08 handovers
Watch out: Reads need viewMonitoring, mutations manageAgents. Deactivate, never delete. Pairing code only via IssuePairingCode, shown once through flash; never persisted or logged in plaintext. No N+1.
Gate (all must pass, paste real output tails): php artisan test --filter=Developers && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build
```

### H13

```text
Execute handover H13 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H13-dashboard-devices-sync-monitor.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Devices + sync monitor (PRD §11, §49–52): list/detail, disable/enable/re-pair code/Sync Now, sync health with failures and rejections.
Needs merged: H05, H07, H08 (parallel with H11, H12, H14–H17) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H13 -b handover/H13-devices-sync-monitor main   # work only there
Own only: agent-dashboard: routes/dashboard/{devices,sync}.php · app/Http/Controllers/Dashboard/{Device,DeviceAction,SyncMonitor}Controller.php · resources/js/pages/{Devices,Sync}/** · tests/Feature/Dashboard/{Devices,SyncMonitor}*Test.php   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §11, §33, §49–52 · H05 handover (actions) · H07 AgentHealth · data-model (devices, agent_sync_states, sync_batches)
Watch out: Actions only through H05 Actions, with confirmation dialogs. Prove history survives disable. Health states Healthy/Offline/Sync Failed/Disabled (+Outdated). No credentials in props.
Gate (all must pass, paste real output tails): php artisan test --filter="Devices|SyncMonitor" && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build
```

### H14

```text
Execute handover H14 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H14-dashboard-projects.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Project analytics (PRD §17, §46): list + detail with paths, developers, devices, sessions, tokens, trend.
Needs merged: H07, H08 (parallel with H11–H13, H15–H17) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H14 -b handover/H14-dashboard-projects main   # work only there
Own only: agent-dashboard: routes/dashboard/projects.php · app/Http/Controllers/Dashboard/ProjectController.php · resources/js/pages/Projects/** · tests/Feature/Dashboard/ProjectsTest.php   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §17, §46 · data-model (projects, project_locations) · H07/H08 handovers
Watch out: Token metrics via H07 with the project filter (rollups only). Paths from project_locations. No N+1 on counts.
Gate (all must pass, paste real output tails): php artisan test --filter=Projects && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build
```

### H15

```text
Execute handover H15 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H15-dashboard-sessions-prompts.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Sessions list + detail (PRD §47–48) with a per-message usage timeline and permission-gated, audited prompt viewing (PRD §24, §52).
Needs merged: H07, H08 (parallel with H11–H14, H16, H17) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H15 -b handover/H15-dashboard-sessions main   # work only there
Own only: agent-dashboard: routes/dashboard/sessions.php · app/Http/Controllers/Dashboard/SessionController.php · resources/js/pages/Sessions/** · tests/Feature/Dashboard/Sessions*Test.php   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §16, §24, §47–48, §52, §54 · .claude/rules/privacy.md · H07 SessionSearch/FilterOptions · H08 components
Watch out: Prompts load only through an Inertia optional prop on explicit user action; the closure authorizes viewPrompts and writes a prompt.viewed audit row. The initial load must contain no message content. Prompt text never in logs or audit metadata. Whitelist sorts.
Gate (all must pass, paste real output tails): php artisan test --filter=Sessions && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build
```

### H16

```text
Execute handover H16 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H16-dashboard-token-analytics.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Token analytics explorer (PRD §19–22): all dimension filters, granularity, group-by, totals, trend, breakdown, calculation explainer.
Needs merged: H07, H08 (parallel with H11–H15, H17) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H16 -b handover/H16-token-analytics main   # work only there
Own only: agent-dashboard: routes/dashboard/token-analytics.php · app/Http/Controllers/Dashboard/TokenAnalyticsController.php · resources/js/pages/Analytics/** · tests/Feature/Dashboard/TokenAnalyticsTest.php   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §19–22 · H07 TokenAnalytics/FilterOptions/Granularity/Dimension · H08 components
Watch out: Invalid params fall back to defaults, never 500. Test the invariants: trend sum == totals, full breakdown sum == totals. Exact PRD labels; state 'monitoring calculation, not billing'.
Gate (all must pass, paste real output tails): php artisan test --filter=TokenAnalytics && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build
```

### H17

```text
Execute handover H17 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H17-dashboard-admin-settings-audit.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Admin area: versioned + audited tracking settings, initial sync range and intervals, min agent version, retention + monitor:prune, user/role management, audit log viewer.
Needs merged: H08, H04 models (parallel with H11–H16) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H17 -b handover/H17-admin-settings-audit main   # work only there
Own only: agent-dashboard: routes/dashboard/{tracking-settings,users,audit-logs}.php · app/Http/Controllers/Dashboard/{TrackingSettings,User,AuditLog}Controller.php · app/Http/Requests/Dashboard/{UpdateTrackingSettings,StoreUser,UpdateUser}Request.php · app/Actions/Tracking/UpdateTrackingSettings.php · app/Console/Commands/PruneMonitoringData.php · routes/console.php (prune schedule line) · resources/js/pages/Admin/** · tests/Feature/Dashboard/Admin/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §23–26, §31, §52–53, §56 · data-model (tracking_settings, audit_logs, users) · .claude/rules/privacy.md · H08 gates
Watch out: Version bumps on every change; audits carry before/after diffs. Prompt enable is a confirmed two-step action. Last-admin protection. Prune touches only raw messages/usage (usage only where already rolled up) and old sync_batches — never rollups, sessions or devices.
Gate (all must pass, paste real output tails): php artisan test --filter=Admin && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build && php artisan schedule:list
```

---

## Wave 5 — 4 agents in parallel (can run at the same time as Wave 4)

**Dependencies:** H18 ← H09, H10 · H19 ← H01, H02 · H20 ← H01, H02 · H21 ← H01, H02

Adapters implement the frozen interface inside their own `src/platform/<os>/` + `packaging/<os>/`; installers consume the payload layout defined in `docs/architecture/agent.md` §1 (tested with a stub payload). H20/H21 need Windows/Linux machines or VMs for their manual smoke steps; automated tests run anywhere. Merge order: H18 first, then adapters in any order.

**Handovers:** [H18](H18-agent-app-cli-pairing-build.md), [H19](H19-agent-platform-macos.md), [H20](H20-agent-platform-windows.md), [H21](H21-agent-platform-linux.md)

### H18

```text
Execute handover H18 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H18-agent-app-cli-pairing-build.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Make the agent runnable: container wiring core + adapter, CLI (run/pair/status/sync-now/diagnostics/repair/install-service/uninstall-service), loopback pairing page, startup discovery, dev-only env overrides, per-target build bundling a verified Node 24 runtime.
Needs merged: H09, H10 (parallel with H19–H21; adapters may be stubs, so test with the fake adapter) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H18 -b handover/H18-agent-app main   # work only there
Own only: 6am-agent: src/app/** · src/cli/** · scripts/build.ts · build-config.example.json · test/unit/{app,cli}/** · test/helpers/fakeAdapter.ts   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: docs/architecture/agent.md · 6am-agent/CLAUDE.md · H09/H10 interfaces · src/platform/types.ts · PRD §5, §8–9, §13, §32
Watch out: No OS branching outside selectAdapter. Pairing is the only interactive step; server binds 127.0.0.1 with a URL token. Credentials only via adapter.credentials. Dev overrides ignored when channel=stable. Build layout dist/<target>/{runtime,app,VERSION}, runtime SHA-256 verified.
Gate (all must pass, paste real output tails): cd 6am-agent && npm test && npm run lint && npm run typecheck && npm run build -- --target darwin-arm64 && dist/darwin-arm64/runtime/node dist/darwin-arm64/app/agent.cjs --version · pairing smoke test against php artisan serve with a temp CLAUDE_CONFIG_DIR from fixtures
```

### H19

```text
Execute handover H19 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H19-agent-platform-macos.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: macOS adapter (discovery, ioreg/sw_vers device info, Keychain credentials, per-user LaunchAgent) + .pkg installer and uninstaller.
Needs merged: H01, H02 (parallel with H18, H20, H21; package a stub payload if H18 isn't merged) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H19 -b handover/H19-platform-macos main   # work only there
Own only: 6am-agent/src/platform/darwin/** · 6am-agent/packaging/macos/** · 6am-agent/test/unit/platform/darwin/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: src/platform/types.ts (frozen) · docs/architecture/agent.md §1–2, 4 · claude-data-contract.md (macOS) · PRD §7–8, §11–13
Watch out: Absolute binary paths via execFile. Secrets on stdin (security -i), never argv or logs. Per-user LaunchAgent only. Golden test for the plist. Signing/notarization optional params.
Gate (all must pass, paste real output tails): npm test && npm run lint && npm run typecheck · manual on this Mac: launchctl print shows it running, pairing opens, survives logout + reboot, Keychain item exists, clean uninstall (paste outputs)
```

### H20

```text
Execute handover H20 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H20-agent-platform-windows.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Windows adapter (discovery, MachineGuid device info, DPAPI credentials, per-user logon Scheduled Task with restart-on-failure, no console window) + per-user Inno Setup installer.
Needs merged: H01, H02 (parallel with H18, H19, H21; needs a Windows 10/11 machine or VM for manual steps) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H20 -b handover/H20-platform-windows main   # work only there
Own only: 6am-agent/src/platform/win32/** · 6am-agent/packaging/windows/** · 6am-agent/test/unit/platform/win32/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: src/platform/types.ts · docs/architecture/agent.md §1–2, 4 (D11) · claude-data-contract.md (Windows, may be UNVERIFIED) · PRD §7–8, §11–13
Watch out: No admin rights, no SYSTEM service. Absolute System32 paths; secrets on stdin. Golden test for the task XML. Handle paths with spaces and non-ASCII usernames. If real Claude paths differ from the contract, fix your adapter and report it for H24.
Gate (all must pass, paste real output tails): npm test && npm run lint && npm run typecheck (any OS) · manual on Windows: install as standard user, no console window, pair, heartbeat visible, survives sign-out + reboot, clean uninstall (paste outputs)
```

### H21

```text
Execute handover H21 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H21-agent-platform-linux.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Linux adapter (discovery, os-release/machine-id device info, secret-tool or 0600 file credentials, systemd --user unit with XDG autostart fallback) + deb/rpm/tar.gz via nfpm.
Needs merged: H01, H02 (parallel with H18–H20; needs Ubuntu 24.04 with systemd + Fedora for rpm) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H21 -b handover/H21-platform-linux main   # work only there
Own only: 6am-agent/src/platform/linux/** · 6am-agent/packaging/linux/** · 6am-agent/test/unit/platform/linux/**   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: src/platform/types.ts · docs/architecture/agent.md §1–2, 4 · claude-data-contract.md (Linux) · PRD §7–8, §11–13
Watch out: Must work with no desktop keyring (0600 files, 0700 dirs). Tarball install needs no root. Secrets never in argv. Golden test for the unit file.
Gate (all must pass, paste real output tails): npm test && npm run lint && npm run typecheck · manual on Ubuntu + Fedora: install, 6am-agent pair, systemctl --user status, survives logout + reboot, clean uninstall (paste outputs)
```

---

## Wave 6 — 3 agents in parallel

**Dependencies:** H22 ← all of Wave 3 + H18 · H23 ← H06, H09, H16 · H24 ← Wave 5

Output: automated E2E suite, token validation report, platform matrix report + CI builds. Bugs found here become new follow-up handovers (`H26+`), not fixes inside these branches (except test code they own).

**Handovers:** [H22](H22-e2e-sync-harness.md), [H23](H23-token-validation.md), [H24](H24-cross-platform-qa-ci.md)

### H22

```text
Execute handover H22 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H22-e2e-sync-harness.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Automated end-to-end suite: the real built agent against the real Laravel backend through a fault-injecting proxy, covering the handover's 10 scenarios.
Needs merged: all of Wave 3 + H18 (parallel with H23, H24) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H22 -b handover/H22-e2e main   # work only there
Own only: e2e/** (its own package.json: vitest + tsx only)   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §27–39, §55, §61 · docs/contracts/sync-api-v1.md · H18 CLI + dev env overrides (AGENT_API_BASE_URL, AGENT_DATA_DIR, AGENT_CREDENTIAL_BACKEND=file) · H06 behavior
Watch out: Never touch the real ~/.claude — assert the temp CLAUDE_CONFIG_DIR. Don't mock app code. A product bug becomes a follow-up handover, not a fix here. Map each scenario to AC numbers in e2e/README.md.
Gate (all must pass, paste real output tails): cd e2e && npm ci && npm test — green twice in a row, under 5 min
```

### H23

```text
Execute handover H23 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H23-token-validation.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Prove token correctness (PRD Phase 8): an independent oracle script, agent + backend validation tests, and a controlled real-session comparison report.
Needs merged: H06, H09, H16 (parallel with H22, H24; step 4 needs a human to run ~3 Claude prompts) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H23 -b handover/H23-token-validation main   # work only there
Own only: 6am-agent/test/validation/** · agent-dashboard/tests/Feature/TokenValidation/** · docs/validation/token-validation.md · tools/token-audit/token-audit.mjs   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §19–22, §58 Phase 8 · claude-data-contract.md (dedup evidence) · H06/H07/H09/H16 handovers
Watch out: The oracle must not import agent code. Compare oracle vs agent vs DB vs dashboard, including cross-midnight and split-line cases and the PRD §20 example. No real prompt text in the report. Mismatches become follow-up handovers.
Gate (all must pass, paste real output tails): cd 6am-agent && npx vitest run test/validation · cd agent-dashboard && php artisan test --filter=TokenValidation · report table all-equal
```

### H24

```text
Execute handover H24 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H24-cross-platform-qa-ci.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: CI + installer build workflows, the PRD Phase 7 matrix run on real macOS/Windows/Ubuntu/Fedora, and closure of every UNVERIFIED item in the data contract.
Needs merged: Wave 5 (parallel with H22, H23; needs human operators on each OS) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H24 -b handover/H24-cross-platform-qa main   # work only there
Own only: .github/workflows/{ci,agent-build}.yml · docs/validation/platform-matrix.md · the platform sections of docs/contracts/claude-data-contract.md   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: PRD §7–8, §14, §57–58, §61 · claude-data-contract.md · H19–H21 validation sections
Watch out: Signing steps gated on secrets. Evidence must be real and free of personal data. Fill every matrix cell with tester + date, plus CPU/RAM figures. FAILs become follow-up handover specs, not fixes here.
Gate (all must pass, paste real output tails): CI green on a PR from this branch (or documented local equivalents) · every matrix cell filled in
```

---

## Wave 7 — Solo (1 agent)

Checks all 41 PRD acceptance criteria with evidence and writes the ops runbook. V1 is done when every criterion is `PASS`.

**Handovers:** [H25](H25-v1-acceptance-audit.md)

### H25

```text
Execute handover H25 of the Claude Code Activity Monitor (6AM Technologies).

Authoritative, read both first: docs/handovers/H25-v1-acceptance-audit.md (the spec) and docs/handovers/PROTOCOL.md (worktree, TDD, validation, review, commit, report, guardrails). Follow them exactly; this prompt only summarises.

Objective: Verify all 41 PRD acceptance criteria with reproducible evidence, run the privacy + security audits, and write the deploy, rollout and troubleshooting runbooks.
Needs merged: every earlier handover and all follow-ups (solo) — verify with git log first; stop and report if missing.
Setup: git worktree add ../cam-H25 -b handover/H25-acceptance main   # work only there
Own only: docs/validation/v1-acceptance.md · docs/operations/{deploy-backend,agent-rollout,troubleshooting}.md   (anything else ⇒ stop, list under Blocked / follow-ups)
Also read: the whole PRD (esp. §59, §61–62) · docs/architecture/* · docs/validation/* · e2e/README.md · all handover reports
Watch out: No product code changes — any FAIL becomes a linked follow-up handover. Include the out-of-scope grep and the prompt-OFF capture audit.
Gate (all must pass, paste real output tails): full suites green on main: backend tests, agent tests, e2e (paste summaries)
```

---

## Handover index

| ID | Title | Wave | Depends on | Primary area |
|---|---|---|---|---|
| H01 | Foundation & scaffolding | 1 | — | repo, both apps |
| H02 | Claude data contract (Phase 0) | 2 | H01 | tools, docs, fixtures |
| H03 | Sync API contract (Phase 2) | 2 | H01 | docs, agent contract |
| H04 | Database schema & domain core (Phase 1) | 2 | H01 | backend |
| H05 | Agent API: pairing, heartbeat, settings | 3 | H03, H04 | backend |
| H06 | Sync ingestion, token calc, rollups | 3 | H03, H04 | backend |
| H07 | Analytics query layer | 3 | H04 | backend |
| H08 | Dashboard shell & RBAC | 3 | H04 | backend + Vue |
| H09 | Agent Claude reader & normalizer | 3 | H02, H03 | agent |
| H10 | Agent sync engine | 3 | H03 | agent |
| H11 | Organization overview page | 4 | H07, H08 | dashboard |
| H12 | Developers & pairing codes | 4 | H05, H07, H08 | dashboard |
| H13 | Devices, agent health & sync monitor | 4 | H05, H07, H08 | dashboard |
| H14 | Projects analytics | 4 | H07, H08 | dashboard |
| H15 | Sessions list/detail & prompts | 4 | H07, H08 | dashboard |
| H16 | Token analytics explorer | 4 | H07, H08 | dashboard |
| H17 | Tracking settings, users, audit log, retention | 4 | H08 | dashboard |
| H18 | Agent app, CLI, pairing UX, build | 5 | H09, H10 | agent |
| H19 | macOS adapter + .pkg | 5 | H01, H02 | agent |
| H20 | Windows adapter + installer | 5 | H01, H02 | agent |
| H21 | Linux adapter + packages | 5 | H01, H02 | agent |
| H22 | End-to-end sync harness (Phase 7 automated) | 6 | W3, H18 | e2e |
| H23 | Token validation (Phase 8) | 6 | H06, H09, H16 | validation |
| H24 | Cross-platform QA & CI | 6 | W5 | QA |
| H25 | V1 acceptance audit & ops runbook | 7 | all | docs |

## PRD phase coverage

Phase 0 → H02 (+H24) · Phase 1 → H04 · Phase 2 → H03 · Phase 3 → H05, H06, H07 · Phase 4 → H08, H11–H17 · Phase 5 → H09, H10, H18 · Phase 6 → H19–H21 · Phase 7 → H22, H24 · Phase 8 → H23 · Acceptance → H25.
