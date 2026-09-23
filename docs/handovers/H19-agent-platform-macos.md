# H19 — macOS Adapter, LaunchAgent, .pkg Installer
Status: todo · Wave 5 · parallel with H18, H20, H21 · Branch `handover/H19-platform-macos`

## Objective
Implement `PlatformAdapter` for macOS and a `.pkg` that installs the bundled runtime + app, registers a per-user LaunchAgent, and opens pairing on first run.

## Read first
`src/platform/types.ts` (frozen), `docs/architecture/agent.md` §1–2, 4, `docs/contracts/claude-data-contract.md` (macOS section), PRD §7–8, §11–13.

## Depends on
H01, H02. (Payload layout from `agent.md` §1 / H18. Test packaging with a stub payload if H18 isn't merged.)

## Owned files
`6am-agent/src/platform/darwin/**`, `6am-agent/packaging/macos/**`, `6am-agent/test/unit/platform/darwin/**`.

## Allowed dependencies
None (use `node:child_process` `execFile` with absolute binaries: `/usr/sbin/ioreg`, `/usr/bin/security`, `/bin/launchctl`, `/usr/bin/sw_vers`, `/usr/bin/open`).

## Adapter
- `claudeDataCandidates()`: `$CLAUDE_CONFIG_DIR`, `~/.claude`, plus any extra macOS path the H02 contract documents. `claudeGlobalConfigCandidates()`: `$CLAUDE_CONFIG_DIR/.claude.json`, `~/.claude.json`.
- `deviceInfo()`: hostname (`os.hostname()`, strip `.local`), `platform:'macos'`, `platformVersion` from `sw_vers -productVersion`, `os.arch()`, fingerprint = sha256(`IOPlatformUUID` from `ioreg -rd1 -c IOPlatformExpertDevice`).
- `credentials`: Keychain generic password (service `com.6amtech.agent`, account = key) via `security add-generic-password -U -s … -a … -w <value>`, `find-generic-password -w`, and `delete-generic-password`. **Never pass the secret in argv**: use `security -i` with the command on stdin. Fall back to a `0600` file in app data only if the Keychain is unavailable (headless), reporting `backend='file-0600'`.
- `service`: write `~/Library/LaunchAgents/com.6amtech.agent.plist` (`ProgramArguments` [node, agent.cjs, run], `RunAtLoad` true, `KeepAlive` {SuccessfulExit:false}, `ThrottleInterval` 30, `ProcessType` Background, `LowPriorityIO` true, stdout/err to logDir). `launchctl bootstrap gui/<uid>` / `bootout`, `status` via `launchctl print gui/<uid>/com.6amtech.agent`.
- `appDataDir()` `~/Library/Application Support/6amAgent`, `logDir()` `~/Library/Logs/6amAgent`. `openUrl` via `open`. `checkPermissions`: readability test, with a hint about Full Disk Access if EPERM on a TCC-protected location (normally `~/.claude` isn't protected; record the finding).

## Installer (`packaging/macos/build-pkg.sh <payload-dir> <version>`)
`pkgbuild` component installing the payload to `/Library/Application Support/6amAgent/<version>` with a stable symlink `current`, and a `postinstall` that, for the console user (`stat -f%Su /dev/console`), runs `launchctl asuser <uid> sudo -u <user> <node> <agent.cjs> install-service` and then `… pair` (opens the pairing page in the user's browser). `productbuild` with a distribution XML (title, license, min macOS 13). An uninstall script `packaging/macos/uninstall.sh` (uninstall-service → deregister → remove files; keeps nothing but logs). Signing/notarization are parameters (`--sign "Developer ID Installer: …"`, `--notarize-profile`) that are skipped when absent.

## Tests
Unit (mock `execFile`): fingerprint parsing from sample `ioreg` output, `sw_vers` parsing, plist XML generation (golden file), Keychain commands never include the secret in argv, fallback store is 0600, candidates honor `CLAUDE_CONFIG_DIR`.

## Validation
`npm test && npm run lint && npm run typecheck`. **Manual on this Mac** (paste outputs): build a pkg from `dist/darwin-arm64` (or a stub payload), install, confirm `launchctl print` shows it running, the pairing page opens, logout/login and reboot restart it (AC10), `security find-generic-password -s com.6amtech.agent` exists, then uninstall cleanly.

## Acceptance criteria
AC1 (macOS part), AC6, AC10 on macOS · no Node/npm/SQLite needed on the machine.

## Review checklist
Absolute binary paths · no secrets in argv/logs · LaunchAgent is per-user · uninstall leaves no service behind.

## Commit
`feat(H19): macos adapter, launchagent service and pkg installer`
