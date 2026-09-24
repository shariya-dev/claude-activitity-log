# Windows installer (H20)

Per-user Inno Setup installer for the 6AM Agent. No admin rights, no UAC prompt, no Node install on the developer machine: the installer ships the bundled Node 24 runtime.

## Prerequisites

- **Build host only:** Windows with [Inno Setup 6.3+](https://jrsoftware.org/isdl.php) (`ISCC.exe` on `PATH` or in the default install location), Node 24 for `npm run build`.
- Optional signing: `signtool.exe` (Windows SDK) and a code-signing certificate in the certificate store.
- **Developer machines:** nothing. They run the produced `.exe` only.

## Build

From `6am-agent/`:

```powershell
npm run build -- --target win-x64          # H18: produces dist\win-x64\{runtime,app,VERSION}
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-installer.ps1 -PayloadDir dist\win-x64 -Version 0.1.0
# -> packaging\windows\Output\6amAgent-0.1.0-x64.exe
```

Options: `-Arch arm64` (with `dist\win-arm64`), `-OutputDir <dir>`, and signing with `-SignToolPath <signtool.exe> -CertificateThumbprint <sha1>` (and optionally `-TimestampUrl`, default `http://timestamp.digicert.com`). Without both signing params the build is unsigned, which is fine for internal testing.

## What the installer does

1. Installs `runtime\node.exe`, `app\agent.cjs`, `app\build-config.json` and `VERSION` into `%LOCALAPPDATA%\Programs\6amAgent` (no directory prompt). On upgrade it first stops the running agent (`schtasks /End /TN 6amAgent`).
2. Runs `node.exe agent.cjs install-service` (from `[Code]`, so a failure is reported), which registers and starts the per-user Scheduled Task `6amAgent` (at logon, hidden, restart on failure).
3. Unless the device is already paired (`%LOCALAPPDATA%\6amAgent\cred\device_token.bin` exists), launches `node.exe agent.cjs pair`, which opens the pairing page in the browser. The installer does not wait for it.
4. On uninstall (Settings > Apps, "6AM Agent"): runs `uninstall-service` (ends and deletes the task, deregisters the device best-effort), then deletes the install dir, `state.db*`, `cred\`, `agent.lock` and `sync-request` under `%LOCALAPPDATA%\6amAgent`. `logs\` is kept.

If `install-service` fails, Setup shows an error and skips pairing (silent installs log it only).

The Setup log is written to `%TEMP%\Setup Log <date> #NNN.txt`.

## Manual validation checklist (Windows 10 and 11, x64)

Log in as a **standard (non-admin) user**. Run each command in PowerShell and paste the output into the H20 report.

1. **Install:** double-click `6amAgent-<version>-x64.exe`. Expected: no UAC prompt, no directory page, and the pairing page opens in the browser.

   ```powershell
   Get-ChildItem "$env:LOCALAPPDATA\Programs\6amAgent" -Recurse | Select-Object FullName
   ```

2. **Task registered and running:**

   ```powershell
   schtasks /Query /TN 6amAgent /V /FO LIST
   Get-Process node | Select-Object Id, Path, StartTime, MainWindowHandle
   ```

   Expected: `Status: Running`, logon trigger, `Run As User` is the current user, `Path` is under `%LOCALAPPDATA%\Programs\6amAgent\runtime`.

3. **No console window:** confirm visually that no console window is open. `MainWindowHandle` above is `0`, and the process does not appear under "Apps" in Task Manager.
4. **Pair:** issue a code in the dashboard, enter it on the pairing page, and wait for "initial sync". Then:

   ```powershell
   Test-Path "$env:LOCALAPPDATA\6amAgent\cred\device_token.bin"   # True
   & "$env:LOCALAPPDATA\Programs\6amAgent\runtime\node.exe" "$env:LOCALAPPDATA\Programs\6amAgent\app\agent.cjs" status
   ```

5. **Heartbeat:** the device appears on the dashboard Devices page with a recent "last seen". Take a screenshot.
6. **Survives sign-out/sign-in and reboot (AC10):** sign out and back in, re-run step 2, and check the dashboard heartbeat. Reboot, then repeat.
7. **Upgrade:** install the same or a newer build over the existing one. Expected: no pairing page (already paired), the task is still running, and the device is not duplicated in the dashboard.
8. **Uninstall:** Settings > Apps > "6AM Agent" > Uninstall. Then:

   ```powershell
   schtasks /Query /TN 6amAgent                          # must fail: task does not exist
   Test-Path "$env:LOCALAPPDATA\Programs\6amAgent"      # False
   Get-ChildItem "$env:LOCALAPPDATA\6amAgent"            # only logs\ remains
   Get-Process node -ErrorAction SilentlyContinue        # no agent node process
   ```

   Expected: the dashboard shows the device as **uninstalled**, and its history is still present.

9. **Paths with spaces and non-ASCII characters:** repeat steps 1, 2 and 8 with a user whose profile path contains a space or a non-ASCII character (for example `C:\Users\José Test`), if one is available.

### Troubleshooting

- **Credential errors on managed machines.** The agent protects its device token with DPAPI through Windows PowerShell (`Add-Type`, `[Security.Cryptography.ProtectedData]`). PowerShell Constrained Language Mode (AppLocker or WDAC policies) blocks both, and pairing then fails with `DPAPI protect failed: …`. Check with `$ExecutionContext.SessionState.LanguageMode` (must be `FullLanguage`) and ask IT to allow it. Record the result for H24.
- **Agent still running after uninstall.** `uninstall-service` ends the task and stops `node.exe` processes running this install's `agent.cjs`. If `Get-Process node` still shows one from `%LOCALAPPDATA%\Programs\6amAgent`, record it in the report.

### Claude data probe (for H24)

Record the real Claude Code paths and format on this machine (contract §12). From a checkout, or with a copy of `tools/claude-data-probe/probe.mjs` (Node 18+ required, e.g. the bundled `runtime\node.exe`):

```powershell
node tools/claude-data-probe/probe.mjs --out probe-windows-1.json
claude -p "Reply with the single word ok."
claude -p "Reply ok." --continue
node tools/claude-data-probe/probe.mjs --compare probe-windows-1.json --out probe-windows-2.json
Select-String -Path probe-*.json -Pattern '@','C:\\Users'   # must print nothing
```

Also record `$env:CLAUDE_CONFIG_DIR`, `Test-Path "$env:USERPROFILE\.claude"`, `Test-Path "$env:APPDATA\claude"` and `Test-Path "$env:USERPROFILE\.claude.json"`. Attach both reports to H24.
