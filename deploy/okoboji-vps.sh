#!/usr/bin/env bash
# Pushes the current code from this laptop to the AURA install on the okoboji
# VPS and restarts it. Secrets (.env files, the Firebase service-account file)
# already live on the server and are never sent or overwritten.
#
#   bash deploy/okoboji-vps.sh
#
# Needs the deploy key ~/.ssh/aura_vps. Server layout (see deploy/README.md):
#   /opt/aura/node   Node 24 for AURA only (system Node is left alone)
#   /opt/aura/app    the code; PM2 runs the API as "aura-api" on 127.0.0.1:3210
#   OpenLiteSpeed vhosts aura.okoboji.in and admin.aura.okoboji.in serve the
#   built apps from /usr/local/lsws/conf/vhosts/<domain>/html and proxy /api.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=root@147.93.29.129
SSH=(ssh -i "$HOME/.ssh/aura_vps" -o BatchMode=yes "$HOST")

echo "→ uploading code"
tar --exclude=node_modules --exclude=dist --exclude=dev-dist --exclude=.git \
  --exclude='.env' --exclude='.env.local' --exclude='scripts/.sim' --exclude='*.log' \
  --exclude='apps/server/brogramming-*.json' --exclude='.firebase' \
  --exclude='test-results' --exclude='playwright-report' -czf - . |
  "${SSH[@]}" 'tar -xzf - -C /opt/aura/app'

echo "→ installing, building and restarting"
"${SSH[@]}" 'set -e
export PATH=/opt/aura/node/bin:$PATH
cd /opt/aura/app
CI=true pnpm install --frozen-lockfile >/dev/null
pnpm --filter @hackos/participant build >/dev/null
pnpm --filter @hackos/admin build >/dev/null
for pair in "participant aura.okoboji.in" "admin admin.aura.okoboji.in"; do
  set -- $pair
  html=/usr/local/lsws/conf/vhosts/$2/html
  rm -rf "$html.new" && cp -r "apps/$1/dist" "$html.new" && chown -R lsadm:nogroup "$html.new"
  rm -rf "$html.old" && mv "$html" "$html.old" && mv "$html.new" "$html" && rm -rf "$html.old"
done
pm2 restart aura-api --update-env >/dev/null
sleep 8
curl -sf -o /dev/null http://127.0.0.1:3210/api/p/public/event?code=x || true
pm2 ls | grep aura-api'

echo "✓ live: https://aura.okoboji.in and https://admin.aura.okoboji.in"
