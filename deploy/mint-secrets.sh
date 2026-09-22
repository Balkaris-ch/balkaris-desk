#!/usr/bin/env bash
# Put the desk's three secrets on the box, and never print one.
#
#   TELEGRAM_BOT_TOKEN        from E:\Balkaris\secrets\desk-telegram-token.txt (Fini's, from @BotFather)
#   TELEGRAM_WEBHOOK_SECRET   minted here; Telegram sends it back in a header on every update
#   DESK_RUNNER_SECRET        minted here; the workstation's runner carries it as a bearer token
#
# The two minted ones are written to E:\Balkaris\secrets\ as well, because the
# runner on the workstation needs its half and a webhook that has to be re-set
# after a token roll needs the other. Everything travels over ssh stdin, so no
# value is ever an argument, in a log, or on this terminal.
#
# Re-running it mints NEW secrets and re-points the webhook. That is the
# rotation, and it is one command.
set -euo pipefail

HOST=${BALKARIS_HOST:-deploy@91.99.153.205}
KEY=${BALKARIS_KEY:-/e/Balkaris/secrets/hetzner_ed25519}
SECRETS=${BALKARIS_SECRETS:-/e/Balkaris/secrets}
DIR=/opt/balkaris-desk
URL=${DESK_URL:-https://desk.balkaris.ch}

[ -f "$KEY" ] || { echo "no ssh key at $KEY"; exit 1; }
[ -f "$SECRETS/desk-telegram-token.txt" ] || {
  echo "no bot token at $SECRETS/desk-telegram-token.txt — @BotFather first"; exit 1; }

TG=$(tr -d ' \r\n' < "$SECRETS/desk-telegram-token.txt")
[ -n "$TG" ] || { echo "the token file is empty"; exit 1; }

# 32 bytes of hex each. Telegram only accepts A-Z a-z 0-9 _ - in a webhook
# secret, which hex satisfies.
HOOK=$(openssl rand -hex 32)
RUN=$(openssl rand -hex 32)

printf '%s' "$HOOK" > "$SECRETS/desk-webhook-secret.txt"
printf '%s' "$RUN"  > "$SECRETS/desk-runner-secret.txt"
echo "-> minted, and written to $SECRETS (webhook, runner)"

# The .env is rewritten whole, from stdin, with nothing else in it. The desk
# has no other state in that file — the database is beside it, not in it.
{
  printf 'NODE_ENV=production\n'
  printf 'DESK_PORT=3400\n'
  printf 'DESK_URL=%s\n' "$URL"
  printf 'DESK_DB=%s/desk.db\n' "$DIR"
  printf 'SITE_REPO=%s/site\n' "$DIR"
  printf 'SITE_BRANCH=main\n'
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$TG"
  printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$HOOK"
  printf 'DESK_RUNNER_SECRET=%s\n' "$RUN"
} | ssh -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes "$HOST" \
    "sudo mkdir -p $DIR && sudo tee $DIR/.env >/dev/null && sudo chmod 600 $DIR/.env && sudo chown deploy:deploy $DIR/.env && sudo systemctl restart balkaris-desk" >/dev/null

echo "-> .env placed (0600) and the service restarted"
sleep 3

# Point Telegram at us. The secret goes in the path AND as the header token,
# and the handler checks both.
RES=$(curl -s -X POST "https://api.telegram.org/bot$TG/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"$URL/tg/$HOOK\",\"secret_token\":\"$HOOK\",\"allowed_updates\":[\"message\",\"edited_message\"]}")

python - "$RES" <<'PY'
import json, sys
d = json.loads(sys.argv[1])
print("setWebhook:", "ok" if d.get("ok") else f"FAILED {d.get('description')}")
PY

curl -s "https://api.telegram.org/bot$TG/getWebhookInfo" | python -c "
import sys, json, re
r = json.load(sys.stdin).get('result', {})
# The URL carries the secret. Print its shape, never its value.
url = re.sub(r'/tg/[0-9a-f]+$', '/tg/<secret>', r.get('url', ''))
print('webhook:', url or '(none)',
      '| pending', r.get('pending_update_count', 0),
      '| custom cert', r.get('has_custom_certificate'),
      ('| last error: ' + r['last_error_message']) if r.get('last_error_message') else '')
"
