# 6AM Claude Code Activity Monitor: Production Deployment and Operations Guide

This guide takes the system from this repository to a live deployment at **https://sixammonitor.com**, with agents installed on developer computers. Section 13 covers running everything on one Mac for testing.

**Contents**
1. How the system works
2. Tech stack
3. What changes for production (files to add, change, or leave out)
4. Before you start: domain, server, accounts
5. Deploy the backend and dashboard on the server
6. Processes that must keep running
7. First login and dashboard setup
8. Build and sign the agent installers
9. Distribute the installers
10. Install the agent on a developer's computer
11. Upgrades (backend and agent)
12. Backups, security checklist and monitoring
13. Local testing on one Mac
14. Command reference and troubleshooting

---

## 1. How the system works

```
 Developer computer (macOS / Windows / Linux)                 Server: sixammonitor.com
┌───────────────────────────────────────────┐           ┌──────────────────────────────────────┐
│ Claude Code writes local logs             │           │ Nginx (HTTPS, Let's Encrypt)         │
│   ~/.claude/projects/**/*.jsonl           │           │   └─ PHP 8.4-FPM → Laravel 13 app    │
│                │ read-only                │  HTTPS    │        ├─ /api/agent/v1/*  agent API │
│ 6AM Agent (background service)            │ ───────►  │        └─ /login, /dashboard …  UI   │
│   reads → checkpoints → gzip JSON batches │  bearer   │ MySQL 8 (all data)                   │
│   device token in Keychain / DPAPI / keyring│  token  │ Cron → php artisan schedule:run      │
└───────────────────────────────────────────┘           └──────────────────────────────────────┘
                                                              ▲
                              Admins and viewers ─ browser ───┘  https://sixammonitor.com/login
```

- **One domain serves both** the dashboard (web pages) and the agent API (`https://sixammonitor.com/api/agent/v1`).
- The agent **pairs once** with a one-time code from the dashboard. After that it authenticates with its own device token, sends a heartbeat every 5 minutes, and syncs new usage every 2 minutes. Both intervals are set in Tracking settings.
- Data is written inside the HTTP request, so there is **no queue, no Redis and no worker**.
- Token numbers come from Claude Code's local logs. They measure **usage, not billing, cost or quota**.

---

## 2. Tech stack

### Backend and dashboard (`agent-dashboard/`)
| Layer | Technology |
|---|---|
| Language / runtime | **PHP 8.4** (the locked dependencies require ≥ 8.4.1) |
| Framework | **Laravel 13** |
| Database | **MySQL 8** |
| Dashboard auth | Laravel Fortify: email + password login only. No sign-up, reset or verification. |
| Agent auth | Laravel Sanctum personal access tokens (one per device, stored hashed) |
| Frontend | **Inertia.js 3 + Vue 3.5 + TypeScript**, Tailwind CSS 4, reka-ui components, Chart.js (vue-chartjs), Lucide icons |
| Routing in TS | Laravel Wayfinder (typed route helpers) |
| Build tool | Vite (needs **Node 24** at build time only) |
| Background jobs | Laravel Scheduler via cron: `monitor:mark-offline` every 5 min, `monitor:prune` daily. **No queue workers** (`QUEUE_CONNECTION=sync`). |
| Encryption at rest | Prompt text (only if prompt tracking is ON) is encrypted with `APP_KEY` |
| Tests / quality | Pest, Larastan (PHPStan), Pint; ESLint/Prettier, vue-tsc |

### Agent (`6am-agent/`)
| Layer | Technology |
|---|---|
| Language | **TypeScript** |
| Runtime | **Node 24**, bundled inside every installer, so developers don't install Node |
| Bundler | esbuild: one file, `app/agent.cjs` |
| Local state | `node:sqlite` (built into Node): checkpoints, sync cursor, settings cache (`state.db`, mode 0600) |
| Validation | zod (the only runtime dependency) |
| HTTP | `node:http`/`node:https` with gzip request bodies |
| Credential storage | macOS Keychain · Windows DPAPI · Linux Secret Service (libsecret), or a 0600 file |
| Background service | macOS LaunchAgent · Windows Scheduled Task · Linux systemd user service |
| Installers | macOS `.pkg` (pkgbuild/productbuild) · Windows `.exe` (Inno Setup 6) · Linux `.deb`/`.rpm`/`.tar.gz` (nfpm) |
| Tests / quality | Vitest, ESLint, Prettier, `tsc` |

### Other folders
- `e2e/`: end-to-end tests (real agent + real backend + fault-injecting proxy). Vitest.
- `.github/workflows/ci.yml`: backend + agent checks. `agent-build.yml`: builds all installers.
- `docs/`: architecture, API contract, handovers, validation reports.

---

## 3. What changes for production

**No application code changes.** Going from local to sixammonitor.com is configuration only.

### Files you create or change

| # | File | Where | What |
|---|---|---|---|
| 1 | `agent-dashboard/.env` | on the **server** only (never committed) | Production settings (section 5.4) |
| 2 | `6am-agent/build-config.json` | on the **build machine** (or the GitHub variable `AGENT_API_BASE_URL`) | `{"apiBaseUrl": "https://sixammonitor.com", "channel": "stable"}` |
| 3 | Nginx site `/etc/nginx/sites-available/sixammonitor.com` | on the server | Serves `agent-dashboard/public` over HTTPS (section 5.5) |
| 4 | Crontab entry for the web user | on the server | Runs the scheduler every minute (section 6) |
| 5 | `6am-agent/package.json` → `"version"` | repo | Only when you release a **new** agent version (section 11.2) |

That's **2 project files** (`.env` and `build-config.json`) plus **2 server config entries** (Nginx site and cron). Change the fifth file only for agent upgrades.

### What to leave out in production
| Leave out | Why |
|---|---|
| `php artisan serve`, `composer run dev`, `npm run dev`, `schedule:work` | Local development only. Production uses Nginx + PHP-FPM + cron. |
| `php artisan db:seed --class=MonitorDemoSeeder` | Creates fake demo data and a `viewer@example.com` / `password` login |
| `APP_DEBUG=true` | Leaks stack traces |
| `agent-dashboard/.htaccess` (local only, not in git) | A MAMP safety net for this Mac; Nginx doesn't use it |
| `build-config.example.json` for release builds | It is the **dev** channel pointed at `127.0.0.1`; release builds must use `stable` + `https` |
| `6am-agent/dist/`, `node_modules/`, `vendor/` from your Mac | Build or install them on the target instead |
| Queue workers, Redis, Horizon, Supervisor | Not used by design |

---

## 4. Before you start

| Need | Detail |
|---|---|
| Domain | `sixammonitor.com`, with DNS **A record** → your server's public IP (and `www` if wanted) |
| Server | Ubuntu 24.04 LTS, 2 vCPU / 4 GB RAM / 40 GB SSD is plenty to start. Ports 22, 80 and 443 open. |
| TLS certificate | Let's Encrypt (free, auto-renewing). **Required:** release agents refuse plain `http`. |
| Apple Developer account (for macOS) | "Developer ID Installer" certificate + notarization, so the `.pkg` opens without Gatekeeper warnings |
| Windows code-signing certificate (optional) | Avoids SmartScreen warnings for the `.exe` |
| Build machines | A Mac for the `.pkg`, a Windows PC for the `.exe`, Linux (or macOS with nfpm) for deb/rpm. **Or** let GitHub Actions build all of them (section 8.4). |

---

## 5. Deploy the backend and dashboard

Run these on the server as a sudo user. Replace passwords and emails with your own.

### 5.1 Install the system packages
```sh
sudo apt update && sudo apt -y upgrade
sudo apt -y install software-properties-common curl git unzip nginx mysql-server
sudo add-apt-repository -y ppa:ondrej/php && sudo apt update
sudo apt -y install php8.4-fpm php8.4-cli php8.4-mysql php8.4-mbstring php8.4-xml \
  php8.4-curl php8.4-zip php8.4-bcmath php8.4-intl php8.4-gd
curl -sS https://getcomposer.org/installer | php && sudo mv composer.phar /usr/local/bin/composer
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt -y install nodejs   # build step only
```

### 5.2 Create the database
```sh
sudo mysql <<'SQL'
CREATE DATABASE sixammonitor CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'sixammonitor'@'localhost' IDENTIFIED BY 'CHANGE-ME-strong-db-password';
GRANT ALL PRIVILEGES ON sixammonitor.* TO 'sixammonitor'@'localhost';
FLUSH PRIVILEGES;
SQL
```

### 5.3 Get the code
```sh
sudo mkdir -p /var/www && sudo chown $USER:www-data /var/www
cd /var/www
git clone https://github.com/shariya-dev/claude-activitity-log.git sixammonitor
cd sixammonitor/agent-dashboard
composer install --no-dev --optimize-autoloader
npm ci && npm run build
cp .env.example .env
php artisan key:generate
```

### 5.4 Configure `.env`
Edit `/var/www/sixammonitor/agent-dashboard/.env` and set these values. Leave the rest as they are.

```dotenv
APP_NAME="6AM Monitor"
APP_ENV=production
APP_DEBUG=false
APP_URL=https://sixammonitor.com
# APP_KEY=… was generated by key:generate. BACK IT UP (section 12).

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=sixammonitor
DB_USERNAME=sixammonitor
DB_PASSWORD=CHANGE-ME-strong-db-password

QUEUE_CONNECTION=sync          # required: the system has no queue
SESSION_DRIVER=database
SESSION_SECURE_COOKIE=true     # cookies only over HTTPS
CACHE_STORE=database

LOG_CHANNEL=daily
LOG_LEVEL=warning

MONITOR_TIMEZONE=Asia/Dhaka    # day boundaries for the daily charts
MONITOR_TRUSTED_PROXIES=       # empty if Nginx faces the internet directly;
                               # the proxy IPs if behind Cloudflare or a load balancer
```

Then:
```sh
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
sudo chown -R $USER:www-data storage bootstrap/cache && sudo chmod -R ug+rwX storage bootstrap/cache
```

### 5.5 Nginx site
Create `/etc/nginx/sites-available/sixammonitor.com`:
```nginx
server {
    listen 80;
    server_name sixammonitor.com www.sixammonitor.com;
    root /var/www/sixammonitor/agent-dashboard/public;
    index index.php;

    client_max_body_size 4m;          # agent batches are ≤ 2 MB

    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
    }

    location ~ /\.(?!well-known).* { deny all; }   # never serve .env or other dotfiles

    location /downloads/ {                          # agent installers (section 9)
        alias /var/www/sixammonitor-downloads/;
        autoindex off;
    }
}
```
```sh
sudo ln -s /etc/nginx/sites-available/sixammonitor.com /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo mkdir -p /var/www/sixammonitor-downloads
sudo nginx -t && sudo systemctl reload nginx
```

### 5.6 HTTPS
```sh
sudo apt -y install certbot python3-certbot-nginx
sudo certbot --nginx -d sixammonitor.com -d www.sixammonitor.com --redirect -m admin@6amtech.com --agree-tos
```
Certbot adds the 443 server and the HTTP→HTTPS redirect, and renews automatically.

### 5.7 Check it
```sh
curl -I https://sixammonitor.com/                            # 302 → /login
curl -s https://sixammonitor.com/api/agent/v1/sync/status    # {"success":false,"error":{"code":"unauthenticated",…}}
```

---

## 6. Processes that must keep running

| Process | How it runs | Check |
|---|---|---|
| **Nginx** | systemd service | `systemctl status nginx` |
| **PHP 8.4-FPM** | systemd service | `systemctl status php8.4-fpm` |
| **MySQL 8** | systemd service | `systemctl status mysql` |
| **Laravel scheduler** | cron, every minute | `crontab -l` |

Add the scheduler to the crontab of the user that owns the app (`crontab -e`):
```
* * * * * cd /var/www/sixammonitor/agent-dashboard && php artisan schedule:run >> /dev/null 2>&1
```
It marks silent devices **offline** every 5 minutes and prunes data older than the retention setting daily.

**Nothing else.** Don't run a queue worker, `php artisan serve`, `schedule:work`, Redis or Supervisor.

Enable everything at boot: `sudo systemctl enable nginx php8.4-fpm mysql`.

---

## 7. First login and dashboard setup

1. **Create the first admin** on the server. It asks for a password of at least 12 characters:
   ```sh
   cd /var/www/sixammonitor/agent-dashboard
   php artisan monitor:create-admin admin@6amtech.com --name="Admin"
   ```
2. Open **https://sixammonitor.com** → the **Log in** page → you land on **/dashboard**. There is no sign-up, email verification or password reset.
3. **Users** (admin): create accounts for the others. The roles are:
   - **admin:** everything, including users, devices, pairing and settings
   - **viewer:** read-only dashboards

   **Can view prompts** is a separate permission.
4. **Tracking settings** (admin), set once:
   - Categories: prompt tracking, Git and Network are **OFF** by default. Turning prompt tracking ON collects prompt text (stored encrypted, every view audited).
   - **Minimum agent version:** `1.0.0` to start. Raise it after rolling out a newer agent.
   - **Retention:** how long data is kept.
   - **Sync interval / heartbeat interval:** 120 s / 300 s by default.
5. **Developers → Add developer:** one entry per person whose computer will run the agent.
6. **Pairing code:** open the developer → **Generate pairing code**. You get a one-time code like `ABCD-2345`, valid **15 minutes**. Send it privately to the developer.

**Locked-out user:** there is no "forgot password" email. Run this on the server, then have the person change it under Settings → Password:
```sh
php artisan tinker --execute="App\Models\User::where('email','person@6amtech.com')->first()->update(['password'=>'Temp-Password-2026'])"
```

---

## 8. Build and sign the agent installers

The server address is **baked into the installer at build time**. Build once per release and per OS; every developer uses the same installer.

### 8.1 Point the build at production
Create `6am-agent/build-config.json` (git-ignored; don't commit it):
```json
{ "apiBaseUrl": "https://sixammonitor.com", "channel": "stable" }
```
- `stable` builds **require `https://`**, and they ignore all developer environment overrides.
- Don't add `/api/agent/v1`; the agent appends it.

### 8.2 Build on each OS
Once per build machine, run `cd 6am-agent && npm ci`.

**macOS** (on a Mac with Xcode command-line tools):
```sh
npm run build -- --target darwin-arm64 --config build-config.json      # Apple Silicon
npm run build -- --target darwin-x64   --config build-config.json      # Intel Macs
packaging/macos/build-pkg.sh dist/darwin-arm64 1.0.0 \
  --sign "Developer ID Installer: 6AM Technologies (TEAMID)" --notarize-profile 6am-notary
packaging/macos/build-pkg.sh dist/darwin-x64 1.0.0 \
  --sign "Developer ID Installer: 6AM Technologies (TEAMID)" --notarize-profile 6am-notary
# → dist/macos/6amAgent-1.0.0-arm64.pkg, 6amAgent-1.0.0-x64.pkg
```
One-time notarization setup: `xcrun notarytool store-credentials 6am-notary --apple-id <id> --team-id <TEAMID>`.
Without `--sign`/`--notarize-profile` the `.pkg` still works, but users must right-click → Open, or run `sudo installer`.

**Windows** (Windows with Inno Setup 6.3+):
```powershell
npm run build -- --target win-x64 --config build-config.json
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-installer.ps1 `
  -PayloadDir dist\win-x64 -Version 1.0.0 -SignToolPath <signtool.exe> -CertificateThumbprint <sha1>
# → packaging\windows\Output\6amAgent-1.0.0-x64.exe
```

**Linux** (needs `nfpm`):
```sh
npm run build -- --target linux-x64 --config build-config.json
packaging/linux/build-packages.sh dist/linux-x64 1.0.0 x64
# → dist/packages/*.deb, *.rpm, *.tar.gz
```

### 8.3 Check a build before shipping
```sh
cat dist/darwin-arm64/app/build-config.json    # must show https://sixammonitor.com and "stable"
dist/darwin-arm64/runtime/node dist/darwin-arm64/app/agent.cjs --version
```

### 8.4 Or let GitHub Actions build everything
In the GitHub repo, go to **Settings → Secrets and variables → Actions**:
- **Variable** `AGENT_API_BASE_URL` = `https://sixammonitor.com`. The workflow then creates a `stable` build-config itself.
- **Secrets**, all optional; each one enables signing:
  - macOS: `MACOS_INSTALLER_CERT_P12`, `MACOS_INSTALLER_CERT_PASSWORD`, `MACOS_SIGN_IDENTITY`
  - macOS notarization: `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`
  - Windows: `WINDOWS_CERT_PFX`, `WINDOWS_CERT_PASSWORD`

Then run the **agent-build** workflow and download the installers from the run's artifacts.

---

## 9. Distribute the installers

Upload them to the server's download folder:
```sh
scp dist/macos/6amAgent-1.0.0-*.pkg user@sixammonitor.com:/var/www/sixammonitor-downloads/
scp 6amAgent-1.0.0-x64.exe 6am-agent_1.0.0_*.deb 6am-agent-1.0.0*.rpm user@sixammonitor.com:/var/www/sixammonitor-downloads/
```
Developers download from `https://sixammonitor.com/downloads/<file>`. Send each developer the link for their OS and, separately, their pairing code. MDM or an internal file share work too.

---

## 10. Install the agent on a developer's computer

The flow is the same on every OS: **install → enter the pairing code → it runs in the background** and restarts after each login or reboot. Claude Code should already be installed and used on that computer. The agent reads Claude's local data and never changes it.

> **Platform status:** macOS is tested end to end. Windows and Linux are built and unit-tested but not yet validated on real machines. Treat them as beta.

### macOS
1. Double-click `6amAgent-1.0.0-arm64.pkg` (Apple Silicon) or `…-x64.pkg` (Intel), then click through the installer.
2. A **pairing page opens in the browser**. Enter the code. The first sync starts right away and covers the last 7 days.
3. It runs as LaunchAgent `com.6amtech.agent`. It shows under System Settings → General → Login Items as `node`; keep it on.

Terminal equivalent:
```sh
A="/Library/Application Support/6amAgent/current"
"$A/runtime/node" "$A/app/agent.cjs" pair ABCD-2345
"$A/runtime/node" "$A/app/agent.cjs" status
```

### Windows 10/11 (beta)
1. Run `6amAgent-1.0.0-x64.exe`. No admin rights needed; it installs per user.
2. Enter the code on the pairing page that opens.
3. It runs as Scheduled Task `6amAgent` at logon, hidden.

On company-managed PCs, PowerShell must be in FullLanguage mode (`$ExecutionContext.SessionState.LanguageMode`), because the token uses DPAPI.

### Linux (beta)
```sh
sudo apt install ./6am-agent_1.0.0_amd64.deb     # or: sudo dnf install ./6am-agent-1.0.0.x86_64.rpm
6am-agent pair                                   # as your normal user; type the code
```
There's also a no-sudo option: `tar xzf 6am-agent-1.0.0-linux-x64.tar.gz && ./6am-agent-1.0.0-linux-x64/install.sh`.
To keep it running after logout: `sudo loginctl enable-linger <user>`.

### Confirm it works
- `status` shows **Paired: yes**, **Agent state: ok**, a recent **Last success**, and **Service: running**.
- The dashboard shows the device **online** under **Devices**, and data under Sessions, Projects and Token Analytics.

---

## 11. Upgrades

### 11.1 Backend (every deploy)
```sh
cd /var/www/sixammonitor/agent-dashboard
php artisan down
git pull
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan migrate --force
php artisan config:cache && php artisan route:cache && php artisan view:cache
php artisan up
sudo systemctl reload php8.4-fpm
```
Agents keep their local checkpoints, so a few minutes of downtime loses nothing; they catch up afterwards.

### 11.2 Agent (new version)
1. Bump `"version"` in `6am-agent/package.json` (for example `1.0.0` → `1.1.0`), and commit.
2. Rebuild and sign all installers (section 8), then upload them (section 9).
3. Developers run the new installer over the old one. It keeps the pairing and data, and restarts the service.
4. When everyone has updated, raise **Minimum agent version** in Tracking settings. Older agents then show **update required** and stop syncing, keeping their data until they update.

### 11.3 Moving to a new domain
The URL is baked into the installers, so rebuild them with the new `apiBaseUrl`. Every developer installs the new build and pairs again.

---

## 12. Backups, security and monitoring

### Backups
- **Database, daily:**
  ```sh
  mysqldump --single-transaction -u sixammonitor -p sixammonitor | gzip > /var/backups/sixammonitor-$(date +%F).sql.gz
  ```
  Copy it off the server.
- **`APP_KEY`:** store it in your password manager. If it's lost, encrypted prompt text can't be read, even with the database backup.

### Security checklist
- [ ] HTTPS only (certbot redirect), `SESSION_SECURE_COOKIE=true`, `APP_DEBUG=false`
- [ ] Nginx root is `agent-dashboard/public`, and dotfiles are denied. Confirm with `curl -I https://sixammonitor.com/.env` → 403 or 404.
- [ ] Firewall: `sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable`; MySQL not exposed
- [ ] Strong DB password; the app DB user only has rights on its own database
- [ ] Few admins; prompt permission only for those who need it; check **Audit logs** regularly
- [ ] `MONITOR_TRUSTED_PROXIES` set if behind Cloudflare or a load balancer; otherwise leave it empty
- [ ] Signed installers (Developer ID + notarization; Authenticode)

### Monitoring
- **Dashboard → Sync:** failing devices and batch errors. **Devices:** offline, outdated, disabled.
- **App errors:** `storage/logs/laravel-YYYY-MM-DD.log`
- **Nginx and PHP errors:** `/var/log/nginx/error.log`, `journalctl -u php8.4-fpm`

---

## 13. Local testing on one Mac

This uses the same code; only the addresses differ.

**Backend** (Homebrew PHP 8.4, MAMP MySQL on port 8889). MAMP's Apache runs PHP 8.3, so it can't serve this app.
```sh
cd /Applications/MAMP/htdocs/Claude-activity-agent/agent-dashboard
php artisan migrate
php artisan monitor:create-admin you@6amtech.com --name="You"
php artisan serve --host=0.0.0.0 --port=8100     # dashboard: http://127.0.0.1:8100 or http://<wifi-ip>:8100
php artisan schedule:work                        # second terminal
```

**Agent:**
```sh
cd /Applications/MAMP/htdocs/Claude-activity-agent/6am-agent
echo '{ "apiBaseUrl": "http://127.0.0.1:8100", "channel": "dev" }' > build-config.local.json
npm ci && npm run build -- --target darwin-arm64 --config build-config.local.json
packaging/macos/build-pkg.sh dist/darwin-arm64 1.0.0      # → dist/macos/6amAgent-1.0.0-arm64.pkg
```
- Plain `http://` is allowed only for loopback (`127.0.0.1` / `localhost`) in **dev** builds. So the agent on the same Mac uses `127.0.0.1`, even though the dashboard is also reachable on the Wi-Fi IP.
- To test from a *second* computer, the backend needs HTTPS.

---

## 14. Command reference and troubleshooting

### Agent commands
`agent` means the full path (macOS: `"/Library/Application Support/6amAgent/current/runtime/node" "/Library/Application Support/6amAgent/current/app/agent.cjs"`; Windows: `& "$env:LOCALAPPDATA\Programs\6amAgent\runtime\node.exe" "$env:LOCALAPPDATA\Programs\6amAgent\app\agent.cjs"`; Linux: `6am-agent`).

| Command | Purpose |
|---|---|
| `agent status` | Pairing, last sync, service state (`--json` available) |
| `agent sync-now` | Sync immediately |
| `agent diagnostics` | Support report: no tokens, no prompts, safe to share |
| `agent pair [CODE]` | Pair (without a code: opens the pairing page) |
| `agent repair` | Forget the pairing and pair again (needs a re-pair code) |
| `agent install-service` / `uninstall-service` | (Re)start the background service / remove it and deregister |
| `agent --version` | Version |

| | macOS | Windows | Linux |
|---|---|---|---|
| Program | `/Library/Application Support/6amAgent/current` | `%LOCALAPPDATA%\Programs\6amAgent` | `/opt/6am-agent` or `~/.local/share/6am-agent` |
| Data | `~/Library/Application Support/6amAgent` | `%LOCALAPPDATA%\6amAgent` | `~/.local/state/6am-agent` |
| Logs | `~/Library/Logs/6amAgent` | `%LOCALAPPDATA%\6amAgent\logs` | `~/.local/state/6am-agent/logs`, `journalctl --user -u 6am-agent` |
| Uninstall | `sudo "/Library/Application Support/6amAgent/current/uninstall.sh"` | Settings → Apps → 6AM Agent | `sudo apt remove 6am-agent` / `dnf remove`; tarball `uninstall.sh --purge` |

Uninstalling or disabling a device never deletes its history in the dashboard.

### Server commands
| Command | Purpose |
|---|---|
| `php artisan monitor:create-admin <email>` | Create an admin |
| `php artisan migrate --force` | Apply database changes after a deploy |
| `php artisan schedule:run` | What cron runs every minute |
| `php artisan down` / `up` | Maintenance mode during deploys |
| `php artisan config:cache` | Required after any `.env` change |

### Troubleshooting
| Symptom | Fix |
|---|---|
| Agent **needs repair** | The pairing was revoked or replaced. Admin: Devices → **Generate re-pair code**, then `agent pair CODE`. |
| **update required** | The agent is below the minimum agent version. Install the new build, or lower the minimum. No data is lost. |
| **device disabled** | An admin disabled it. After **Enable**, it resumes within about an hour. |
| **Claude data unavailable** | Claude Code never ran under this user, or it uses a custom `CLAUDE_CONFIG_DIR`. The agent looks again every 10 minutes. |
| Pairing code rejected | Expired (15 min), already used, or the developer is inactive. Generate a new one. |
| Agent can't connect | `curl https://sixammonitor.com/api/agent/v1/sync/status` from that computer should return JSON with `unauthenticated`. Check DNS, the certificate and the firewall. |
| Every sync fails with 500 | `storage/logs`, DB credentials, disk space. Agents keep their data and retry. |
| Dashboard 500 after changing `.env` | `php artisan config:cache` |
| Devices all show **offline** | Cron isn't running `schedule:run`, or the agents can't reach the server |
| macOS "unidentified developer" | Sign and notarize the `.pkg` (section 8.2), or right-click → Open |
| Windows `DPAPI protect failed` | PowerShell Constrained Language Mode. Ask IT to allow it. |

### Privacy guarantees
- The agent reads only Claude Code's data folder and the account block of `~/.claude.json` (and `.git/config`/`HEAD` only if Git tracking is ON). It never writes there.
- **Prompt text is never read or sent unless an admin turns prompt tracking ON.** Git and Network are also OFF by default.
- Network data never identifies a developer or device.
- History is never deleted by disabling or uninstalling a device.
