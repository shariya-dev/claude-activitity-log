# H01 — Foundation & Scaffolding
Status: done (9940198) · Wave 1 (solo) · Branch: none (commits directly on `main`)

## Objective
Create the repository, both application skeletons with **every** dependency later handovers need, tooling gates, route/page wiring that lets later handovers work on disjoint files, the frozen agent platform interface, and the Claude configuration. No product features.

## Read first
`CLAUDE.md`, `docs/architecture/README.md`, `agent.md` §1–2, `backend.md` §1–2, `claude-config.md`, `docs/handovers/PROTOCOL.md`.

## Depends on
Nothing. Note: the repo is **not** a git repo yet, so this handover runs in the main checkout (no worktree) and creates `main`.

## Owned files
Everything at the root, all of `6am-agent/` except `src/core/**` and `test/fixtures/**`, and all of `agent-dashboard/` (generated scaffold).

## Allowed dependencies
Backend composer: `laravel/sanctum`, dev: `laravel/boost`, `larastan/larastan`, `laravel/pint` (starter kit), Pest (starter kit). npm (dashboard): `chart.js`, `vue-chartjs`. Agent npm: runtime `zod`; dev `typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `esbuild`, `eslint`, `typescript-eslint`, `prettier`, `@types/node`.

## Steps
1. `git init -b main`; `.gitignore` (root: `.DS_Store`, `node_modules/`, `.claude/settings.local.json`, `*.log`, `/e2e/.tmp/`). Initial commit of the existing docs/config: `chore(H01): planning docs and Claude config`.
2. **Backend scaffold** (the folder must be empty, so `mv agent-dashboard/.gitkeep` if any): `composer create-project laravel/vue-starter-kit agent-dashboard`. Record the Laravel version in the report.
   - `.env`/`.env.example`: `DB_CONNECTION=mysql DB_HOST=127.0.0.1 DB_PORT=8889 DB_DATABASE=claude_monitor DB_USERNAME=root DB_PASSWORD=root QUEUE_CONNECTION=sync CACHE_STORE=database SESSION_DRIVER=database MONITOR_TIMEZONE=Asia/Dhaka`.
   - Create DBs `claude_monitor`, `claude_monitor_test` (utf8mb4_unicode_ci) with MAMP mysql. `phpunit.xml`: `DB_CONNECTION=mysql`, `DB_DATABASE=claude_monitor_test` (remove sqlite in-memory lines).
   - `composer require laravel/sanctum` → `php artisan install:api` is **not** used (it adds routes/api.php); instead publish Sanctum config + migration only (`php artisan vendor:publish --provider="Laravel\Sanctum\SanctumServiceProvider"`).
   - `composer require --dev laravel/boost larastan/larastan`; `php artisan boost:install` (select Claude Code, guidelines + MCP + skills if offered). Move `docs/claude-config/6am-backend.md` → `agent-dashboard/.ai/guidelines/6am-backend.md` and run `php artisan boost:update` (or re-run install) so it is merged into the generated `agent-dashboard/CLAUDE.md`. Move the Boost MCP entry into root `/.mcp.json` as `{"mcpServers":{"laravel-boost":{"command":"php","args":["agent-dashboard/artisan","boost:mcp"]}}}` and delete `agent-dashboard/.mcp.json` if created. Delete `docs/claude-config/`.
   - `phpstan.neon`: larastan extension, level 6, paths `app/`. `composer.json` scripts: `"lint": "pint --test"`, `"stan": "phpstan analyse"`.
   - `config/monitor.php`: `timezone` (env MONITOR_TIMEZONE), `platforms` `['macos','windows','linux']`, `online_minutes` 10, `stale_hours` 24, `session_active_minutes` 30, `pairing_code_ttl_minutes` 15, `sync_limits` `['usage'=>500,'sessions'=>200,'messages'=>200,'bytes'=>2097152]`. (H04 may add keys; it owns the file after this handover.)
   - `bootstrap/app.php` `withRouting(... then: fn () => ...)`: load every `routes/agent/*.php` under `Route::prefix('api/agent/v1')->middleware('api')`, and every `routes/dashboard/*.php` under `Route::middleware(['web','auth','verified'])`. Create empty dirs with `.gitkeep`. Remove the starter kit's `dashboard` route from `routes/web.php` into `routes/dashboard/overview.php` (same name `dashboard`, same Inertia page) so behavior is unchanged.
   - `npm install chart.js vue-chartjs`.
3. **Agent scaffold** in `6am-agent/` (keep existing `CLAUDE.md`): `package.json` (`"type":"module"`, `engines.node >=24`, scripts `test`=`vitest run`, `lint`=`eslint . && prettier --check .`, `typecheck`=`tsc --noEmit`, `build`=`tsx scripts/build.ts`, `dev`=`tsx src/cli/main.ts`), `.nvmrc` = `24`, `tsconfig.json` (strict, `module`/`moduleResolution` `NodeNext`, target ES2023), `vitest.config.ts`, `eslint.config.js` with `no-restricted-imports` forbidding `**/platform/darwin/**|win32/**|linux/**` from `src/core/**` and `no-restricted-properties` forbidding `process.platform` in `src/core/**`.
   - `src/platform/types.ts` exactly as in `docs/architecture/agent.md` §2 (**frozen**).
   - `src/platform/{darwin,win32,linux}/index.ts`: `export function createAdapter(): PlatformAdapter` that throws `new Error('<os> adapter not implemented (H19/H20/H21)')`.
   - `src/platform/index.ts`: `selectAdapter(platform = process.platform): PlatformAdapter` mapping `darwin|win32|linux`, throwing on anything else.
   - `src/cli/main.ts`: prints version and exits (placeholder entry, replaced by H18).
   - `scripts/build.ts`: esbuild bundle `src/cli/main.ts` → `dist/agent.cjs` (platform node, target node24, cjs, minify false, sourcemap). H18 extends it.
   - **node:sqlite check**: `test/unit/sqlite-smoke.test.ts` opens `new DatabaseSync(':memory:')`, creates a table, inserts, and selects. Run under Node 24 (`npx -y node@24 node_modules/.bin/vitest run test/unit/sqlite-smoke.test.ts`, or nvm). Record in `6am-agent/CLAUDE.md` whether it runs without flags/warnings. If it doesn't, add `better-sqlite3` and record the fallback (reviewer must approve).
4. Update root `CLAUDE.md` only if a command changed. Commit.

## Tests / Validation
- `cd agent-dashboard && php artisan migrate && php artisan test && vendor/bin/pint --test && vendor/bin/phpstan analyse && npm run lint && npm run types && npm run build` — all green (the starter kit's tests pass on MySQL).
- `php artisan route:list --path=dashboard` shows `dashboard`.
- `php artisan boost:mcp` starts (Ctrl-C). `claude mcp list` from the root shows `laravel-boost`.
- `cd 6am-agent && npm ci && npm test && npm run lint && npm run typecheck && npm run build && node dist/agent.cjs` prints the version.
- The eslint rule fires: temporarily add `import '../platform/darwin/index.js'` in a scratch `src/core/x.ts`, run lint, confirm the error, then delete the file.

## Acceptance criteria
- `main` has a clean history. Both apps build, lint, and test green. No secrets committed (`.env` ignored).
- `agent-dashboard/CLAUDE.md` is Boost-generated and contains the 6AM guideline section. Root `.mcp.json` has laravel-boost.
- The frozen interface file matches the architecture doc exactly.

## Review checklist
Starter kit untouched apart from the listed edits · no `routes/api.php` · Sanctum migration present · `QUEUE_CONNECTION=sync` · eslint boundary rule proven · no product code.

## Commit
`chore(H01): scaffold laravel dashboard, agent package, tooling and claude config` (plus the step-1 docs commit). Because this is the bootstrap, H01 commits directly on `main` (no worktree, no merge).
