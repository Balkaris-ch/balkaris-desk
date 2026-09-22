#!/usr/bin/env bash
# Ship the desk to the Hetzner box.
#
# The same shape as balkaris-engine/deploy/push.sh, and for the same reasons:
# `git archive HEAD` ships only COMMITTED, TRACKED files, so the box's .env
# cannot be clobbered by a tarball (it is not in git, so it is not in the
# tarball) and node_modules is left alone.
#
#   host      deploy@91.99.153.205   key  E:/Balkaris/secrets/hetzner_ed25519
#   directory /opt/balkaris-desk     NOT a git checkout
#   service   balkaris-desk          ExecStart=npm run start
#   domain    desk.balkaris.ch       Caddy, its own certificate
#
# `git push` is not a deploy. Nothing on the box pulls.
set -euo pipefail

HOST=${BALKARIS_HOST:-deploy@91.99.153.205}
KEY=${BALKARIS_KEY:-/e/Balkaris/secrets/hetzner_ed25519}
DIR=/opt/balkaris-desk
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes "$HOST")

[ -f "$KEY" ] || { echo "no key at $KEY — set BALKARIS_KEY"; exit 1; }

if [ -n "$(git status --porcelain -- src scripts deploy package.json package-lock.json tsconfig.json)" ]; then
  echo "uncommitted changes — commit first, or the tarball ships the last commit and you debug a build you never made:"
  git status --short -- src scripts deploy package.json package-lock.json tsconfig.json
  exit 1
fi

REV=$(git rev-parse --short HEAD)
echo "→ packing $REV"
# mktemp, not a literal /tmp: this runs in Git Bash as often as on Linux, and
# git for Windows writes to a Windows path. A hard-coded /tmp fails there with
# "could not open for writing", which reads like a permissions problem and is
# not one.
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
git archive --format=tar.gz -o "$STAGE/desk.tar.gz" HEAD

echo "→ uploading"
scp -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes \
  "$STAGE/desk.tar.gz" "$HOST":/tmp/desk.tar.gz

echo "→ installing"
"${SSH[@]}" bash -se <<'REMOTE'
set -euo pipefail
DIR=/opt/balkaris-desk
sudo mkdir -p "$DIR"
sudo chown "$USER":"$USER" "$DIR"

# The database and the .env are the two things a deploy must never touch.
tar -xzf /tmp/desk.tar.gz -C "$DIR"
rm -f /tmp/desk.tar.gz

cd "$DIR"
npm ci --omit=dev --silent

# The unit and the Caddy block are in the tarball, so a change to either
# ships with the code rather than being remembered by hand.
sudo cp deploy/balkaris-desk.service /etc/systemd/system/balkaris-desk.service
sudo systemctl daemon-reload

# APPEND the Caddy block if it is not already there. Never rewrite the file:
# the engine's block is in it and operation.balkaris.ch goes down if it is lost.
if ! grep -q "desk.balkaris.ch" /etc/caddy/Caddyfile; then
  sudo cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
  cat deploy/Caddyfile.desk | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  sudo systemctl reload caddy
  echo "  caddy: desk.balkaris.ch added and reloaded"
fi

sudo systemctl enable --now balkaris-desk
sudo systemctl restart balkaris-desk
sleep 3
systemctl is-active balkaris-desk
REMOTE

echo "→ proving it from outside"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -m 10 https://desk.balkaris.ch/health >/dev/null 2>&1; then
    curl -s https://desk.balkaris.ch/health; echo
    echo "✓ $REV is live on https://desk.balkaris.ch"
    exit 0
  fi
  echo "  waiting for the certificate… ($i)"
  sleep 10
done

echo "✗ desk.balkaris.ch did not answer. On the box: journalctl -u balkaris-desk -n 50; journalctl -u caddy -n 30"
exit 1
