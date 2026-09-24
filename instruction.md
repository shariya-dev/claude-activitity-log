# 6AM Claude Code Activity Monitor: Setup and Installation Guide

This system has two parts:

- **Dashboard (backend):** a Laravel web app. It receives data from the agents and shows usage to admins and viewers.
- **Agent:** a small background program on each developer's computer. It reads Claude Code's local usage data and sends it to the dashboard.

Token counts come from Claude Code's local logs. They show usage, not billing, cost or quota.

| Who | What they do | Section |
|---|---|---|
| Server admin | Installs and runs the dashboard | 1, 2 |
| Dashboard admin | Adds developers, issues pairing codes, manages devices and settings | 3 |
| Release owner | Builds the installers (macOS, Windows, Linux) | 4 |
| Developer | Installs the agent and pairs it | 5 |
| Anyone | Day-to-day commands, uninstall, troubleshooting | 6, 7, 8 |

> **Platform status:** macOS is tested end to end. The Windows and Linux installers are built and unit-tested, but they haven't been validated on real machines yet. Treat them as beta.

---

## 1. Run the dashboard locally (development, on a Mac with MAMP)

**You need:** PHP 8.4, Composer, Node 24 and npm, and MAMP's MySQL 8 (127.0.0.1, port 8889, user `root`, password `root`).

```sh
cd agent-dashboard

# first time only
cp .env.example .env            # already set up for MAMP MySQL; note its DB_DATABASE name
php artisan key:generate
composer install
npm ci && npm run build
/Applications/MAMP/Library/bin/mysql80/bin/mysql -h127.0.0.1 -P8889 -uroot -proot \
  -e "CREATE DATABASE IF NOT EXISTS claude_monitor"   # use the DB_DATABASE name from .env
php artisan migrate
php artisan monitor:create-admin you@6amtech.com --name="Your Name"   # asks for a password (at least 12 characters)

# every time you work on it (two terminals)
php artisan serve --port=8000   # dashboard + agent API at http://127.0.0.1:8000
php artisan schedule:work       # background jobs: offline detection, data retention
```

Open **http://127.0.0.1:8000** and log in.

Optional demo data, for exploring the pages without any agents: `php artisan db:seed --class=MonitorDemoSeeder`. It creates the login `viewer@example.com` / `password`. Use it only on a local database.

---

## 2. Deploy the dashboard to a server (production)

### Server requirements
- PHP 8.4 with the usual Laravel extensions (pdo_mysql, mbstring, openssl, json, zlib, intl), plus Composer.
- MySQL 8.
- A web server (Nginx or Apache) serving `agent-dashboard/public`.
- **HTTPS with a valid certificate.** Company agent builds only talk to `https://` addresses.
- Cron, for the scheduler. **No queue worker, Redis or similar is needed.**

### Install
```sh
git clone <repo> /var/www/claude-monitor
cd /var/www/claude-monitor/agent-dashboard
cp .env.example .env
php artisan key:generate
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan migrate --force
php artisan monitor:create-admin admin@6amtech.com --name="Admin"
php artisan config:cache && php artisan route:cache && php artisan view:cache
```

### Important `.env` values
| Key | Value |
|---|---|
| `APP_ENV` / `APP_DEBUG` | `production` / `false` |
| `APP_URL` | `https://monitor.yourdomain.com` |
| `APP_KEY` | Generated above. **Back it up somewhere safe.** Stored prompt text is encrypted with this key; if you lose it, stored prompts can't be read. |
| `DB_*` | Your MySQL host, database, user and password |
| `QUEUE_CONNECTION` | `sync` (keep it; there is no queue) |
| `MONITOR_TRUSTED_PROXIES` | IP(s) of your load balancer or reverse proxy, comma separated, if one sits in front of the app. Leave it empty if clients connect directly. |

### Scheduler (cron)
Add to the web user's crontab:
```
* * * * * cd /var/www/claude-monitor/agent-dashboard && php artisan schedule:run >> /dev/null 2>&1
```
This marks devices offline every 5 minutes and prunes old data daily, according to the retention settings.

### Backups
Back up the MySQL database daily, and keep `APP_KEY` with the backups.

### Upgrading
```sh
git pull
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
```

---

## 3. Using the dashboard

1. Go to your dashboard URL. The only public page is **Log in** (email + password). After you log in you land on the **Dashboard**. There is no sign-up, email verification or password reset. Accounts are created by an admin.
2. **Users** (admin only): create dashboard accounts, and choose each user's role (admin or viewer) and whether they may view prompts. Everyone can change their own password under **Settings → Password**. There is no "forgot password" email. If someone is locked out, a server admin sets a new password:
   ```sh
   php artisan tinker --execute="App\Models\User::where('email','person@6amtech.com')->first()->update(['password' => 'NewPassword-2026'])"
   ```
   The password is hashed automatically. Tell the person to change it under Settings → Password.
3. **Developers → Add developer:** add each person whose computer will run the agent.
4. **Pairing:** open a developer and click **Generate pairing code**. You get a one-time code like `ABCD-2345`, valid for 15 minutes. Send it to the developer; they need it in section 5.
5. **Devices:** each paired computer appears here with its status (online, stale, offline, outdated, disabled). The actions are:
   - **Disable:** the agent stops sending data and checks back hourly. History is kept.
   - **Enable:** the agent resumes on its own at its next hourly check. No new pairing is needed.
   - **Generate re-pair code:** use it when a developer reinstalled or their agent shows "needs repair".
   - **Sync now:** asks the agent to sync at its next heartbeat, within about a minute.
6. **Sync:** per-device batch history, errors and health.
7. **Tracking settings** (admin): turn data categories on or off. **Prompt tracking is OFF by default.** When it is ON, prompt text is collected and stored encrypted; only users with prompt permission can read it, and every view is recorded in **Audit logs**. The same page sets **minimum agent version** and data retention.

---

## 4. Build the agent installers (release owner)

Build on the matching operating system; the GitHub Actions workflow `.github/workflows/agent-build.yml` builds all of them. Every installer bundles its own Node runtime, so developers don't install Node.

### 4.1 Point the build at your dashboard
Create `6am-agent/build-config.json`:
```json
{ "apiBaseUrl": "https://monitor.yourdomain.com", "channel": "stable" }
```
- `stable` builds require `https://`.
- For local testing, use `{ "apiBaseUrl": "http://127.0.0.1:8000", "channel": "dev" }`. This is `build-config.example.json`, the default when you pass no `--config`.

### 4.2 Build per platform
```sh
cd 6am-agent
npm ci
```

**macOS** (on a Mac):
```sh
npm run build -- --target darwin-arm64 --config build-config.json     # Apple Silicon; use darwin-x64 for Intel
packaging/macos/build-pkg.sh dist/darwin-arm64 1.0.0
# signed + notarized (recommended for distribution):
packaging/macos/build-pkg.sh dist/darwin-arm64 1.0.0 \
  --sign "Developer ID Installer: 6AM Technologies (TEAMID)" --notarize-profile 6am-notary
```
Result: `6amAgent-1.0.0-arm64.pkg`

**Windows** (on Windows with Inno Setup 6.3+):
```powershell
npm run build -- --target win-x64 --config build-config.json
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-installer.ps1 -PayloadDir dist\win-x64 -Version 1.0.0
# optional signing: -SignToolPath <signtool.exe> -CertificateThumbprint <sha1>
```
Result: `packaging\windows\Output\6amAgent-1.0.0-x64.exe`

**Linux** (needs `nfpm` on PATH):
```sh
npm run build -- --target linux-x64 --config build-config.json
packaging/linux/build-packages.sh dist/linux-x64 1.0.0 x64
```
Result in `dist/packages/`: `.deb`, `.rpm` and `.tar.gz`

### 4.3 Distribute
Put the installers somewhere your developers can download them, such as an internal file share or MDM. Send each developer the installer for their OS and, separately, their pairing code.

> The agent version must be **≥ the minimum agent version** set in Tracking settings (default `1.0.0`). Otherwise the agent reports "update required" and doesn't sync.

---

## 5. Install the agent on a developer's computer

The flow is the same everywhere: **install → pair with the code → it runs in the background by itself**, and it starts again after every login or reboot. Claude Code should already be installed and used on this computer. The agent only reads Claude's local data and never changes it.

### 5.1 macOS
1. Double-click `6amAgent-<version>-<arch>.pkg` and follow the installer. If macOS blocks an unsigned package, right-click → **Open**, or run:
   ```sh
   sudo installer -pkg ~/Downloads/6amAgent-1.0.0-arm64.pkg -target /
   ```
2. When it finishes, a **pairing page opens in your browser**. Enter the code from your admin, and the agent pairs and starts its first sync.
3. Done. It runs as a LaunchAgent (`com.6amtech.agent`) and shows under System Settings → General → Login Items as `node`. Keep it switched on.

If the pairing page didn't open, or you want to use the terminal:
```sh
AGENT='/Library/Application Support/6amAgent/current'
"$AGENT/runtime/node" "$AGENT/app/agent.cjs" pair ABCD-2345
"$AGENT/runtime/node" "$AGENT/app/agent.cjs" status
```
Tip: add `alias 6am-agent='"/Library/Application Support/6amAgent/current/runtime/node" "/Library/Application Support/6amAgent/current/app/agent.cjs"'` to `~/.zshrc`, then use `6am-agent status`.

### 5.2 Windows 10/11 (beta)
1. Double-click `6amAgent-<version>-x64.exe`. No admin rights are needed; it installs for the current user only.
2. A **pairing page opens in your browser**. Enter your code.
3. Done. It runs as the Scheduled Task `6amAgent` at every logon, with no window.

Terminal alternative (PowerShell):
```powershell
$A = "$env:LOCALAPPDATA\Programs\6amAgent"
& "$A\runtime\node.exe" "$A\app\agent.cjs" pair ABCD-2345
& "$A\runtime\node.exe" "$A\app\agent.cjs" status
```
On company-managed PCs, PowerShell must run in FullLanguage mode, because the token is protected with Windows DPAPI. Check with `$ExecutionContext.SessionState.LanguageMode`, and ask IT if it's restricted.

### 5.3 Linux: Ubuntu/Debian/Fedora (beta)
**With a package (needs sudo):**
```sh
sudo apt install ./6am-agent_1.0.0_amd64.deb      # Ubuntu/Debian
sudo dnf install ./6am-agent-1.0.0.x86_64.rpm      # Fedora/RHEL
6am-agent pair            # as YOUR user, not root: type the code; it then installs the service
```
**Without sudo (tarball):**
```sh
tar xzf 6am-agent-1.0.0-linux-x64.tar.gz
./6am-agent-1.0.0-linux-x64/install.sh             # installs to ~/.local/share/6am-agent and asks for the code
```
It runs as a systemd **user** service (`6am-agent.service`). To keep it running after you log out and start it at boot, an admin runs `sudo loginctl enable-linger <your-user>` once.

### 5.4 Check that it's working
- `status` shows **Paired: yes**, a recent last sync, and service **running**.
- In the dashboard, the device appears under **Devices** as online. Sessions, Projects and Token Analytics fill up after the first sync. The first sync covers the last 7 days.

---

## 6. Everyday agent commands

`agent` below means the command for your OS: the alias or full path from section 5 on macOS and Windows, or `6am-agent` on Linux.

| Command | What it does |
|---|---|
| `agent status` | Pairing, last sync, pending data, service state (`--json` for scripts) |
| `agent sync-now` | Sync immediately (otherwise it syncs by itself every 2 minutes; admins can change this in Tracking settings) |
| `agent diagnostics` | Health report for support; contains no tokens and no prompts |
| `agent pair [CODE]` | Pair this computer (without a code: opens the pairing page) |
| `agent repair` | Forget the pairing and pair again (needs a new code from an admin) |
| `agent install-service` | (Re)install and start the background service |
| `agent uninstall-service` | Stop the service and unregister the device (dashboard history is kept) |
| `agent --version` | Show the version |

### Where things are
| | macOS | Windows | Linux |
|---|---|---|---|
| Program | `/Library/Application Support/6amAgent/current` | `%LOCALAPPDATA%\Programs\6amAgent` | `/opt/6am-agent` or `~/.local/share/6am-agent` |
| Data | `~/Library/Application Support/6amAgent` | `%LOCALAPPDATA%\6amAgent` | `~/.local/state/6am-agent` |
| Logs | `~/Library/Logs/6amAgent` | `%LOCALAPPDATA%\6amAgent\logs` | `~/.local/state/6am-agent/logs`, plus `journalctl --user -u 6am-agent` |
| Device token | login Keychain (`com.6amtech.agent`) | DPAPI-protected file | Secret Service keyring, or a `0600` file |

---

## 7. Uninstall

- **macOS:** `sudo "/Library/Application Support/6amAgent/current/uninstall.sh"`
- **Windows:** Settings → Apps → **6AM Agent** → Uninstall
- **Linux:** `sudo apt remove 6am-agent` or `sudo dnf remove 6am-agent`; tarball: `~/.local/share/6am-agent/uninstall.sh --purge`

Uninstalling marks the device **uninstalled** in the dashboard. Its history is always kept.

---

## 8. Troubleshooting

| What you see | Cause and fix |
|---|---|
| `status` says **needs repair** | The pairing was revoked or replaced. Get a re-pair code from an admin (Devices → Generate re-pair code) and run `agent pair CODE`. |
| **update required** | The agent is older than the dashboard's minimum agent version. Install the newer build, or have an admin lower the minimum in Tracking settings. Nothing is lost: pending data syncs after updating. |
| **device disabled** | An admin disabled this device. It resumes by itself within about an hour of being enabled again. |
| **Claude data unavailable** | Claude Code has never run under this user, or uses a custom `CLAUDE_CONFIG_DIR`. Run Claude Code once; the agent looks again every 10 minutes. |
| Pairing says the code is invalid | The code expired (after 15 minutes), was already used, or the developer is inactive. Generate a new one. |
| Device shows **offline** | The computer is off or asleep, or the service is stopped. Run `agent status`, then `agent install-service`. |
| Nothing new in the dashboard | Run `agent sync-now`, then check **Sync** in the dashboard for errors, and `agent diagnostics`. |
| macOS: service won't start | Check that `node` is allowed under System Settings → Login Items, then run `agent install-service` again. |
| Windows: pairing fails with `DPAPI protect failed` | PowerShell is in Constrained Language Mode. Ask IT to allow it for this app. |
| Linux: `user service manager is not reachable` | Run it from a normal login session, not `sudo`/`su`, or have an admin run `sudo loginctl enable-linger <user>`. |
| Local testing: agent refuses `http://` | Only `dev` builds may use `http://127.0.0.1`/`localhost`. Build with `build-config.example.json`, or set `AGENT_ALLOW_INSECURE_LOCALHOST=1`. |

When asking for help, send the output of `agent diagnostics`. It is safe to share: it contains no tokens and no prompts.

---

## Privacy summary
- The agent reads only Claude Code's data folder and the account block of `~/.claude.json`, plus `.git/config` and `HEAD` if Git tracking is ON. It never modifies them.
- **Prompt text is not read or sent unless an admin turns prompt tracking ON.** Git and Network tracking are also OFF by default.
- Network data never identifies a developer or device.
- Disabling or uninstalling a device never deletes its history.
