# H24 — Cross-Platform QA & CI Builds (PRD Phase 7 manual matrix, Phase 0 closure)
Status: todo · Wave 6 · parallel with H22, H23 · Branch `handover/H24-cross-platform-qa`

## Objective
Build installers for all targets in CI, run the Phase 7 test matrix on real macOS, Windows, and Linux machines, and close every `UNVERIFIED` item in the Claude data contract.

## Read first
PRD §7–8, §14, §58 Phase 7, §61, `docs/contracts/claude-data-contract.md`, H19–H21 validation sections.

## Depends on
Wave 5 merged. Human operators with: macOS (Apple Silicon; Intel if available), Windows 11 x64, Ubuntu 24.04, Fedora (or another RPM distro). Each machine has Claude Code installed and logged in.

## Owned files
`.github/workflows/agent-build.yml`, `.github/workflows/ci.yml`, `docs/validation/platform-matrix.md`, the Windows/Linux (and any macOS correction) sections of `docs/contracts/claude-data-contract.md`.

## Allowed dependencies
CI actions only: `actions/checkout`, `actions/setup-node`, `shivammathur/setup-php`, and Inno Setup/nfpm installation steps.

## Deliverables
1. `ci.yml`: on PR, backend (MySQL service, `php artisan test`, pint, phpstan, npm lint/types/build) + agent (`npm test`, lint, typecheck) on ubuntu, plus agent unit tests on `macos-latest` and `windows-latest` (adapter tests run on their real OS).
2. `agent-build.yml`: manual/tag trigger, matrix macOS (pkg), Windows (Inno Setup exe), Linux (deb/rpm/tar.gz) for x64 + arm64 where runners allow; artifacts uploaded. Signing steps are gated on secrets (skipped when absent). If the repo has no GitHub remote yet, document local build commands per OS in the matrix doc instead, and keep the workflow files ready.
3. Run `tools/claude-data-probe/probe.mjs` on each OS and update the contract sections (verified/not, paths, differences). Any difference that requires reader/adapter changes ⇒ a follow-up handover spec in the report.
4. `platform-matrix.md`: rows = PRD Phase 7 checks (Installation, Pairing, Claude detection, Data detection, Initial sync, New sessions, Updated sessions, Projects, Models, Token usage, Cache handling, Offline periods, Internet recovery, Duplicate sync, Failed sync, Agent restart, OS restart, Device disable, Settings changes, plus: no Node/npm preinstalled, no console window (Win), network switch doesn't create a device, uninstall keeps history), columns = macOS/Windows/Ubuntu/Fedora, each cell PASS/FAIL + evidence link/notes + tester + date. Also record CPU/RAM idle and during sync (PRD §57 "lightweight"; target < 1 % CPU idle, < 120 MB RSS).

## Validation
CI green on a PR from this branch (or local equivalents documented). Every matrix cell filled in, with FAILs linked to follow-up handovers.

## Acceptance criteria
AC1–AC6, AC10, AC13, AC14 evidenced per OS · the Phase 0 contract has no UNVERIFIED items left (or each has a documented reason + nullable handling).

## Review checklist
Evidence is real (outputs/screenshots) · no personal data in evidence · follow-ups are well-scoped handovers.

## Commit
`chore(H24): ci pipelines, installer builds and cross-platform validation matrix`
