# Linux packaging

Builds `.deb`, `.rpm` and `.tar.gz` from one per-target build payload (`dist/linux-x64` or `dist/linux-arm64`, layout in `docs/architecture/agent.md` §1).

```sh
npm run build -- --target linux-x64
packaging/linux/build-packages.sh dist/linux-x64 1.0.0 x64   # needs nfpm on PATH
ls dist/packages
```

| File                     | Purpose                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| `nfpm.yaml`              | deb/rpm definition; `build-packages.sh` stages `./root` and `./scripts`   |
| `build-packages.sh`      | `<payload-dir> <version> <arch>` → deb, rpm, tarball in `OUT_DIR`         |
| `bin/6am-agent`          | launcher: bundled node + `app/agent.cjs`; `pair` then `install-service`   |
| `scripts/postinstall.sh` | deb/rpm: restarts already-running user units on upgrade, prints next step |
| `scripts/preremove.sh`   | deb/rpm removal: removes every local user's unit (not on upgrade)         |
| `tarball/install.sh`     | per-user install without root, then `pair`                                |
| `tarball/uninstall.sh`   | per-user removal; `--purge` also deletes local state and secrets          |

## Install

**deb/rpm** (root): installs to `/opt/6am-agent/` and links `/usr/bin/6am-agent`. The service is per user, so nothing starts for root. Each developer then runs `6am-agent pair` as themselves. The launcher prompts for the pairing code and, after pairing succeeds, runs `install-service`. `6am-agent pair --browser` uses the local pairing page instead. That process keeps running as the agent, so the developer runs `6am-agent install-service` afterwards. The launcher refuses to run as root, except for `--version`, `status` and `diagnostics`.

**tarball** (no root): `tar xzf 6am-agent-<v>-linux-<arch>.tar.gz && ./6am-agent-<v>-linux-<arch>/install.sh`. It installs into `~/.local/share/6am-agent/`, links `~/.local/bin/6am-agent` and runs `pair`. If the service is already set up (an upgrade), it only reinstalls and restarts the service.

## Service

`install-service` writes `~/.config/systemd/user/6am-agent.service` (`Restart=always`, `RestartSec=30`, `Nice=10`, `IOSchedulingClass=idle`, `WantedBy=default.target`), then runs `systemctl --user daemon-reload`, `enable` and `restart`. `restart` is used rather than `enable --now`, so that a reinstall runs the new build.

If systemd is running but the shell has no user bus (for example after `su -` or `sudo -iu`), `install-service` retries with `XDG_RUNTIME_DIR=/run/user/<uid>`. If the user manager still can't be reached, it fails with a hint instead of falling back.

On machines without systemd, the agent writes an XDG autostart entry (`~/.config/autostart/6am-agent.desktop`) instead, starts the agent right away, and reports the service as `installed`. A package upgrade restarts systemd units only: an agent started from an autostart entry keeps running the old build until the next login.

A user unit runs while the user has a session. To keep it running after logout and start it at boot before login, an admin enables lingering: `sudo loginctl enable-linger <user>`. The launcher prints this hint after pairing when lingering is off. The agent never runs it itself, because it needs privileges.

## Credentials

- If `secret-tool` exists and a Secret Service (gnome-keyring, KWallet) answers, the device token is stored with `secret-tool store --label=6amAgent service com.6amtech.agent key <key>`. The secret goes over stdin, never argv. The backend is `libsecret`.
- Otherwise the token is stored in `~/.local/state/6am-agent/cred/<key>`: file mode `0600`, directory `0700`, backend `file-0600`. This is the expected case on headless workstations and servers.
- Reads also check the file store, so a device paired without a keyring keeps working if a keyring appears later.

## Uninstall

- **deb/rpm** (`apt remove 6am-agent` / `dnf remove 6am-agent`): the pre-remove script runs `6am-agent uninstall-service` for every local user with a session, and deletes the unit files of the others. Upgrades skip this step.
- **tarball**: `~/.local/share/6am-agent/uninstall.sh [--purge]`.

Local state (`~/.local/state/6am-agent`) is user data. It is removed only by `uninstall.sh --purge`, or by hand. Server-side history is never deleted (invariant 7).
