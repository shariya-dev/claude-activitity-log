# H21 — Linux Adapter, systemd User Service, Packages
Status: code complete (002739a), manual Ubuntu/Fedora validation pending · Wave 5 · parallel with H18–H20 · Branch `handover/H21-platform-linux`

## Objective
Implement `PlatformAdapter` for Linux and `.deb`/`.rpm`/`.tar.gz` packages that install the bundled runtime + app and a `systemd --user` service, then start pairing.

## Read first
`src/platform/types.ts`, `docs/architecture/agent.md` §1–2, 4, `docs/contracts/claude-data-contract.md` (Linux section), PRD §7–8, §11–13.

## Depends on
H01, H02.

## Owned files
`6am-agent/src/platform/linux/**`, `6am-agent/packaging/linux/**`, `6am-agent/test/unit/platform/linux/**`.

## Allowed dependencies
None in the agent. Packaging uses `nfpm` (CLI, installed in CI/build host only).

## Adapter
- Candidates: `$CLAUDE_CONFIG_DIR`, `~/.claude`, `$XDG_CONFIG_HOME/claude` (only if the contract lists it). Global config: `~/.claude.json`.
- `deviceInfo()`: `platform:'linux'`, `platformVersion` = `PRETTY_NAME` from `/etc/os-release` (fallback `os.release()`), arch, fingerprint = sha256(`/etc/machine-id` || `/var/lib/dbus/machine-id`).
- `credentials`: `secret-tool store/lookup/clear --label 6amAgent service com.6amtech.agent key <key>` (secret via stdin) when `secret-tool` exists and a Secret Service is reachable; otherwise a `0600` file in `$XDG_STATE_HOME/6am-agent/cred/` (dir `0700`), `backend='file-0600'` (the expected case on headless workstations; documented).
- `service`: `~/.config/systemd/user/6am-agent.service` (`Type=simple`, `ExecStart=<node> <agent.cjs> run`, `Restart=always`, `RestartSec=30`, `Nice=10`, `IOSchedulingClass=idle`, `WantedBy=default.target`), `systemctl --user daemon-reload && enable --now`. Status via `systemctl --user is-active`. If `systemctl --user` is unavailable (no systemd), fall back to an XDG autostart `.desktop` entry and report `status='installed'`. Suggest `loginctl enable-linger` in diagnostics (not auto-run: needs privileges).
- `appDataDir()` `$XDG_STATE_HOME/6am-agent` (default `~/.local/state/6am-agent`), logs under it. `openUrl` via `xdg-open` (no-op + print the URL when headless).

## Packages (`packaging/linux/nfpm.yaml`, `build-packages.sh <payload-dir> <version> <arch>`)
Install to `/opt/6am-agent/`. Since the unit is per-user, `postinstall` doesn't start services for root. It prints and places `/usr/bin/6am-agent` (wrapper → bundled node + agent.cjs). First run by the user: `6am-agent pair` (the wrapper auto-runs `install-service` on successful pairing). Tarball: `install.sh` installs into `~/.local/share/6am-agent` without root and runs `install-service` + `pair`. `preremove`/`uninstall.sh` runs `uninstall-service` for invoking users where possible.

## Tests
Unit: os-release parsing, machine-id fallback, unit file golden, secret-tool invocation via stdin, file store permissions (0600/0700), systemd-missing fallback path.

## Validation
`npm test && npm run lint && npm run typecheck`. **Manual on Ubuntu 24.04 (VM/container with systemd, or a workstation)** and one RPM distro (Fedora): install the package, `6am-agent pair`, `systemctl --user status 6am-agent`, logout/login + reboot ⇒ running (AC10), uninstall. Paste outputs and update adapter paths if real Claude paths differ, noting them for H24.

## Acceptance criteria
AC3, AC6, AC10 on Linux · works with no desktop keyring.

## Review checklist
No root required for the tarball path · secrets never in argv · per-user unit · clean uninstall.

## Commit
`feat(H21): linux adapter, systemd user service and deb/rpm/tarball packages`
