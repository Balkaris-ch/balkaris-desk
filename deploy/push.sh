#!/usr/bin/env bash
# Ship the desk to the Hetzner box: the server and the interface, together.
#
# The same shape as balkaris-engine/deploy/push.sh, and for the same reasons:
# `git archive HEAD` ships only COMMITTED, TRACKED files, so the box's .env
# cannot be clobbered by a tarball (it is not in git, so it is not in the
# tarball) and node_modules is left alone.
#
#   host      deploy@91.99.153.205   key  E:/Balkaris/secrets/hetzner_ed25519
#   directory /opt/balkaris-desk     NOT a git checkout
#   services  balkaris-desk          the server      :3400   npm run start
#             balkaris-desk-web      the interface   :3401   node server.js
#   domain    desk.balkaris.ch       Caddy, its own certificate, routes by path
#
# THE INTERFACE IS BUILT HERE, NOT THERE. `next build` wants a gigabyte for a
# minute and the box shares 3.7 GB with the engine. A standalone build made on
# this machine runs on the box as it is (proved 2 October 2026: built on
# Windows, served on Linux), so what is shipped is a folder and the box only
# ever runs `node server.js`.
#
# `git push` is not a deploy. Nothing on the box pulls.
set -euo pipefail

HOST=${BALKARIS_HOST:-deploy@91.99.153.205}
KEY=${BALKARIS_KEY:-/e/Balkaris/secrets/hetzner_ed25519}
DIR=/opt/balkaris-desk
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes "$HOST")
SCP=(scp -q -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes)
TRACKED=(src scripts deploy web package.json package-lock.json tsconfig.json)

[ -f "$KEY" ] || { echo "no key at $KEY — set BALKARIS_KEY"; exit 1; }

if [ -n "$(git status --porcelain -- "${TRACKED[@]}")" ]; then
  echo "uncommitted changes — commit first, or the tarball ships the last commit and you debug a build you never made:"
  git status --short -- "${TRACKED[@]}"
  exit 1
fi

REV=$(git rev-parse --short HEAD)
# mktemp, not a literal /tmp: this runs in Git Bash as often as on Linux, and
# git for Windows writes to a Windows path. A hard-coded /tmp fails there with
# "could not open for writing", which reads like a permissions problem and is
# not one.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

echo "→ building the interface ($REV)"
# From the committed tree and nothing else: the build is made in a clean export
# of HEAD, so a file that exists only on this machine cannot end up on the box.
mkdir -p "$STAGE/src"
git archive --format=tar HEAD web | tar -x -C "$STAGE/src"
(
  cd "$STAGE/src/web"
  npm ci --no-audit --no-fund --silent
  NEXT_TELEMETRY_DISABLED=1 npx next build >"$STAGE/build.log" 2>&1 || { tail -40 "$STAGE/build.log"; echo "✗ the interface did not build"; exit 1; }
)
WEB="$STAGE/src/web"
[ -f "$WEB/.next/standalone/server.js" ] || { echo "✗ no standalone build came out of next build"; exit 1; }
# The standalone folder leaves out what a CDN would serve; this box has no CDN.
mkdir -p "$WEB/.next/standalone/.next"
cp -r "$WEB/.next/static" "$WEB/.next/standalone/.next/static"
[ -d "$WEB/public" ] && cp -r "$WEB/public" "$WEB/.next/standalone/public"
tar -czf "$STAGE/desk-web.tar.gz" -C "$WEB/.next/standalone" .

echo "→ packing the server"
git archive --format=tar.gz -o "$STAGE/desk.tar.gz" HEAD

echo "→ uploading"
"${SCP[@]}" "$STAGE/desk.tar.gz" "$HOST":/tmp/desk.tar.gz
"${SCP[@]}" "$STAGE/desk-web.tar.gz" "$HOST":/tmp/desk-web.tar.gz

echo "→ installing"
"${SSH[@]}" REV="$REV" bash -se <<'REMOTE'
set -euo pipefail
DIR=/opt/balkaris-desk
sudo mkdir -p "$DIR"
sudo chown "$USER":"$USER" "$DIR"

# The database and the .env are the two things a deploy must never touch.
tar -xzf /tmp/desk.tar.gz -C "$DIR"
rm -f /tmp/desk.tar.gz

cd "$DIR"
npm ci --omit=dev --silent

# The interface: each release in its own folder, the live one a symlink, so
# the swap is one rename and the previous build is still there to go back to.
REL="$DIR/web-releases/$REV-$(date +%s)"
mkdir -p "$REL"
tar -xzf /tmp/desk-web.tar.gz -C "$REL"
rm -f /tmp/desk-web.tar.gz
ln -sfn "$REL" "$DIR/web-live.next"
mv -T "$DIR/web-live.next" "$DIR/web-live"
# Keep the three newest releases.
ls -1dt "$DIR"/web-releases/*/ 2>/dev/null | tail -n +4 | xargs -r rm -rf

# The units and the Caddy block are in the tarball, so a change to any of them
# ships with the code rather than being remembered by hand. CR is stripped: a
# checkout made on Windows ends lines in CRLF and systemd keeps the CR as part
# of a value.
for unit in balkaris-desk balkaris-desk-web; do
  sed 's/\r$//' "deploy/$unit.service" | sudo tee "/etc/systemd/system/$unit.service" >/dev/null
done
sudo systemctl daemon-reload

sudo systemctl enable --now balkaris-desk
sudo systemctl restart balkaris-desk
sudo systemctl enable --now balkaris-desk-web
sudo systemctl restart balkaris-desk-web
sleep 4
systemctl is-active balkaris-desk
systemctl is-active balkaris-desk-web

# Both must answer on loopback BEFORE Caddy is pointed at them.
curl -fsS -m 10 -o /dev/null http://127.0.0.1:3400/health
code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' http://127.0.0.1:3401/)
case "$code" in
  200|302|303|307|308|401) echo "  interface answers ($code)" ;;
  *) echo "✗ the interface answered $code on :3401 — Caddy left as it was"; journalctl -u balkaris-desk-web -n 30 --no-pager; exit 1 ;;
esac

# Replace the desk's OWN block in the Caddyfile and nothing else: the engine's
# block is in the same file and operation.balkaris.ch goes down if it is lost.
# The new file is validated before it is put in place, and the old one kept.
node deploy/caddy-block.mjs /etc/caddy/Caddyfile deploy/Caddyfile.desk > /tmp/Caddyfile.new
if ! cmp -s /tmp/Caddyfile.new /etc/caddy/Caddyfile; then
  caddy validate --config /tmp/Caddyfile.new --adapter caddyfile >/dev/null 2>&1 || { echo "✗ the new Caddyfile does not validate — left as it was"; rm -f /tmp/Caddyfile.new; exit 1; }
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  sudo cp /tmp/Caddyfile.new /etc/caddy/Caddyfile
  sudo systemctl reload caddy
  echo "  caddy: the desk's block replaced and reloaded"
fi
rm -f /tmp/Caddyfile.new
REMOTE

echo "→ proving it from outside"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 10 https://desk.balkaris.ch/health >/dev/null 2>&1; then
    curl -s https://desk.balkaris.ch/health; echo
    code=$(curl -s -m 15 -o /dev/null -w '%{http_code}' https://desk.balkaris.ch/)
    echo "  https://desk.balkaris.ch/ answers $code"
    echo "  operation.balkaris.ch answers $(curl -s -m 15 -o /dev/null -w '%{http_code}' https://operation.balkaris.ch/)"
    echo "✓ $REV is live on https://desk.balkaris.ch"
    exit 0
  fi
  echo "  waiting… ($i)"
  sleep 10
done

echo "✗ desk.balkaris.ch did not answer. On the box: journalctl -u balkaris-desk -n 50; journalctl -u balkaris-desk-web -n 50; journalctl -u caddy -n 30"
exit 1
