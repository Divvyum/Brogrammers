# Deploying HACKOS to a VPS

## Live install: the okoboji VPS (current)

AURA runs on the shared okoboji server (CyberPanel + OpenLiteSpeed, which own
ports 80/443, so there is no Caddy/Nginx here):

| What | Where |
|---|---|
| Student app | https://aura.okoboji.in |
| Admin app | https://admin.aura.okoboji.in |
| API | `/api` on both sites → PM2 process `aura-api` on `127.0.0.1:3210` |
| Code | `/opt/aura/app` (secrets in `apps/*/.env` and the service-account file, root-only) |
| Node | `/opt/aura/node` (Node 24, AURA only; the system Node 20 is untouched) |
| Web server | `/usr/local/lsws/conf/vhosts/{aura,admin.aura}.okoboji.in/vhost.conf`, registered in `httpd_config.conf` |
| HTTPS | certbot webroot certificates, renewed by the server's existing certbot timer |
| DNS | `aura` and `admin.aura` A records in the `okoboji.in` zone (PowerDNS on this server) |

- **Update:** `bash deploy/okoboji-vps.sh` from a laptop with the `~/.ssh/aura_vps` key.
- **Logs and the WhatsApp QR:** `ssh -i ~/.ssh/aura_vps root@147.93.29.129 "pm2 logs aura-api"`.
- **Health:** `curl https://admin.aura.okoboji.in/api/public/health`.

The sections below describe a dedicated VPS with Caddy instead.

One Ubuntu VPS runs everything: the API server (systemd), both portals (static
files) and HTTPS (Caddy). Firebase stays the database and login. Budget: any
1 vCPU / 1 GB machine works.

You need: the VPS's IP, SSH access, and **two domain names** pointing at it, for
example `admin.yourdomain.in` and `app.yourdomain.in`. HTTPS is not optional:
phone cameras and offline mode only work on HTTPS.

## 1. Firebase (once, from your laptop)

```bash
firebase login
firebase deploy --only firestore        # rules + indexes; indexes take a few minutes to build
```

Firebase console → Authentication → Settings → **Authorized domains**: add both domains.

## 2. Server machine (once)

```bash
# as root
apt update && apt install -y git curl debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
npm i -g pnpm
# Caddy (HTTPS)
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
useradd --system --create-home --shell /usr/sbin/nologin hackos
mkdir -p /opt/hackos && chown hackos:hackos /opt/hackos
sudo -u hackos git clone https://github.com/Divvyum/Brogrammers.git /opt/hackos
```

## 3. Secrets (copy from your laptop, never commit)

```bash
scp apps/server/.env apps/server/brogramming-ae10d-firebase-adminsdk-*.json  root@VPS:/opt/hackos/apps/server/
scp apps/admin/.env        root@VPS:/opt/hackos/apps/admin/
scp apps/participant/.env  root@VPS:/opt/hackos/apps/participant/
ssh root@VPS 'chown hackos:hackos /opt/hackos/apps/*/.env /opt/hackos/apps/server/*.json && chmod 600 /opt/hackos/apps/*/.env /opt/hackos/apps/server/*.json'
```

Then edit them **on the VPS**:

`apps/server/.env`
- **Delete** `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST` (otherwise it looks for emulators).
- `CORS_ORIGINS=https://admin.yourdomain.in,https://app.yourdomain.in`
- `PARTICIPANT_APP_URL=https://app.yourdomain.in`
- `PUBLIC_BASE_URL=https://admin.yourdomain.in` (certificate links)
- Optional: `APP_CHECK_ENFORCE=true` once App Check is set up (plan D29; skipped for now).

`apps/admin/.env` and `apps/participant/.env`
- `VITE_USE_EMULATORS=false`

## 4. Build and start

```bash
cd /opt/hackos
sudo -u hackos pnpm install --frozen-lockfile
sudo -u hackos pnpm --filter @hackos/admin build
sudo -u hackos pnpm --filter @hackos/participant build

cp deploy/hackos-server.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hackos-server

# edit the two domains in deploy/Caddyfile first
cp deploy/Caddyfile /etc/caddy/Caddyfile && systemctl reload caddy
```

Check: `curl https://admin.yourdomain.in/api/public/health` → `{"status":"ok","firestore":"ok","emulators":false}`

## 5. First data

```bash
cd /opt/hackos
sudo -u hackos pnpm superadmin            # makes SUPERADMIN_EMAIL the super admin
```

Then sign in to the admin portal with that Google account and create the event.
Message templates are created automatically when the server starts.

## Updating

```bash
cd /opt/hackos && sudo -u hackos git pull && sudo -u hackos pnpm install --frozen-lockfile
sudo -u hackos pnpm --filter @hackos/admin build && sudo -u hackos pnpm --filter @hackos/participant build
systemctl restart hackos-server
```

## Demo day checklist (plan section 7)

- `systemctl status hackos-server` is green; `journalctl -u hackos-server -f` shows `[jobs] cron jobs and check-in listener started`.
- Firebase console → Firestore → Usage stays under 50% of the free limits.
- Every volunteer phone opened the admin site once **online** (so it works offline) and synced the roster.
- The WhatsApp SIM is logged in (Phase 2).
