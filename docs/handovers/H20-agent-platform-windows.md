# H20 — Windows Adapter, Per-User Scheduled Task, Installer
Status: todo · Wave 5 · parallel with H18, H19, H21 · Branch `handover/H20-platform-windows`

## Objective
Implement `PlatformAdapter` for Windows and a per-user installer (no admin) that installs the bundled runtime + app, registers a logon Scheduled Task with restart-on-failure, and opens pairing.

## Read first
`src/platform/types.ts`, `docs/architecture/agent.md` §1–2, 4 (D11: why a per-user Scheduled Task instead of a SYSTEM service), `docs/contracts/claude-data-contract.md` (Windows section: may be UNVERIFIED, so verify the paths on the test machine and update only your adapter), PRD §7–8, §11–13.

## Depends on
H01, H02.

## Owned files
`6am-agent/src/platform/win32/**`, `6am-agent/packaging/windows/**`, `6am-agent/test/unit/platform/win32/**`.

## Allowed dependencies
None. Use `execFile` with `%SystemRoot%\System32\...` absolute paths: `reg.exe`, `schtasks.exe`, `WindowsPowerShell\v1.0\powershell.exe` (`-NoProfile -NonInteractive`), `cmd.exe /c start` for `openUrl`. Installer: Inno Setup 6 (`iscc`) script, built in CI/Windows.

## Adapter
- Candidates: `%CLAUDE_CONFIG_DIR%`, `%USERPROFILE%\.claude`, plus any contract-documented alternatives (e.g. `%APPDATA%\claude`). Global config: `%USERPROFILE%\.claude.json`.
- `deviceInfo()`: `platform:'windows'`, `platformVersion` = `os.release()` + display version from `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion` (`DisplayVersion`, `CurrentBuild`), arch `os.arch()`, fingerprint = sha256(`HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`).
- `credentials`: DPAPI (CurrentUser) via PowerShell `[Security.Cryptography.ProtectedData]::Protect`, with the plaintext passed on **stdin** and the ciphertext stored as base64 in `%LOCALAPPDATA%\6amAgent\cred\<key>.bin` (ACL inherited from the user profile). `backend='dpapi'`.
- `service`: `schtasks /Create /TN "6amAgent" /XML <task.xml> /F`, with task XML: LogonTrigger for the current user, `RestartOnFailure` (PT1M, 999), `ExecutionTimeLimit` PT0S, `DisallowStartIfOnBatteries` false, `Hidden` true, action `<install>\runtime\node.exe <install>\app\agent.cjs run` launched through `wscript`-free hidden start (use `conhost --headless` if available, else document the chosen approach to avoid a console window). `/Run` after install. `status` via `schtasks /Query /TN 6amAgent /FO CSV`.
- `appDataDir()` `%LOCALAPPDATA%\6amAgent`, logs `%LOCALAPPDATA%\6amAgent\logs`. Handles paths with spaces and non-ASCII usernames. `checkPermissions` gives hints for ACL errors.

## Installer (`packaging/windows/6amAgent.iss` + `build-installer.ps1 -PayloadDir -Version`)
`PrivilegesRequired=lowest`, install dir `{localappdata}\Programs\6amAgent`, `[Run]` post-install `install-service` then `pair` (opens browser), uninstall `[UninstallRun]` `uninstall-service` (deregisters). Optional signing params (`signtool`) skipped when absent. Output `6amAgent-<version>-<arch>.exe`.

## Tests
Unit (mock execFile, run on any OS): registry output parsing, task XML golden file (well-formed XML, trigger + restart settings), DPAPI commands never include the secret in argv, path quoting with spaces/unicode, candidate ordering.

## Validation
`npm test && npm run lint && npm run typecheck`. **Manual on Windows 10/11 x64** (a human or a Windows VM; paste outputs): build `win-x64`, compile the installer, install as a standard user, confirm the task runs with no console window, pair, see the heartbeat in the dashboard, sign out/in and reboot ⇒ running (AC10), uninstall ⇒ task removed and device marked uninstalled. Update your adapter if the real Claude paths differ, and note the differences for H24.

## Acceptance criteria
AC2, AC6, AC10 on Windows · no admin rights and no manual Node install.

## Review checklist
Absolute system binary paths · secrets via stdin only · no visible console window · uninstall is clean.

## Commit
`feat(H20): windows adapter, scheduled-task service and per-user installer`
