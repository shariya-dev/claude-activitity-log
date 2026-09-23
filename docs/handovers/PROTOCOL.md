# Handover Execution Protocol (applies to every HNN)

## 0. Before you start
1. Read: root `CLAUDE.md`, your `docs/handovers/HNN-*.md`, and every doc listed under its **Read first**.
2. Check **Depends on**: `git log --oneline main | grep "HNN"` for each dependency. If one is missing, **stop** and report.
3. Create an isolated worktree (skill `superpowers:using-git-worktrees`):
   `git worktree add ../cam-HNN -b handover/HNN-<slug> main` and work only there.
   Backend worktrees: copy `agent-dashboard/.env` from the main checkout (never commit it) and run `composer install && npm ci`. Agent worktrees: `npm ci` in `6am-agent/`.

## 1. While implementing
- Only create/modify files listed under **Owned files** (globs). Generated files that are git-ignored don't count.
- Need to change a file you don't own, add a dependency not in **Allowed dependencies**, or change a frozen interface? **Stop.** Write it under "Blocked / follow-ups" in your report. Don't work around it.
- TDD (skill `superpowers:test-driven-development`): write the listed tests first, watch them fail, then implement.
- Follow the rule homes: root `CLAUDE.md` (its 8 invariants are binding), `.claude/rules/*`, component CLAUDE.md / Boost guidelines. Superpowers is installed globally — use its skills, never reinstall them.
- No placeholders, TODOs, or commented-out code in committed work (except where the handover explicitly says to leave placeholder pages).

## 2. Validation (skill `superpowers:verification-before-completion`)
Run every command in the handover's **Validation** section and paste the real tail of each output into your report. All must pass. "Should pass" is not evidence.

## 3. Review
Use skill `superpowers:requesting-code-review` against: the handover's Acceptance criteria + Review checklist, `docs/architecture/*`, and the PRD sections cited. Fix every Critical/Important finding (`superpowers:receiving-code-review`), then re-run Validation.

## 4. Commit
- Commit on your branch `handover/HNN-<slug>`. Conventional message, first line: `feat(HNN): <summary>` (or `docs(HNN)`, `chore(HNN)`, `test(HNN)`).
- Body: bullet list of deliverables + `Handover: docs/handovers/HNN-<slug>.md`, ending with:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- Several commits inside the branch are fine. **Never push, never merge to main yourself.**
- Tick the handover's status line `Status: done (<short sha>)` in the same branch.

## 5. Report (final message)
1. Deliverables (files created/changed) 2. Validation output tails 3. Review findings + resolutions 4. Deviations from the handover and why 5. Blocked / follow-ups 6. Branch name + commit SHAs.

## 6. Integration (orchestrator / human, not the handover agent)
After a wave's branches are reviewed: merge each into `main` with `git merge --no-ff handover/HNN-<slug>` in the wave's listed merge order, run the full validation suite on `main` after each merge, then `git worktree remove ../cam-HNN`.
