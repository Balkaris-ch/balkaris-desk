#!/usr/bin/env bash
# Tell Telegram which updates the desk wants — and change nothing else.
#
# Telegram only delivers the kinds of update a webhook asked for when it was
# set. The desk's was set for messages; a button pressed under one of its
# replies is a `callback_query`, which it therefore never heard. This sets the
# SAME webhook again, at the same address with the same secret, with the list
# in src/telegram.ts (`UPDATES`).
#
# It mints nothing and moves nothing. The token and the secret are read out of
# the box's own .env, on the box, and used there: no value is an argument, in
# a log, or on this terminal. `mint-secrets.sh` is the one that rotates them,
# and it now asks for the same list.
#
#   bash deploy/webhook.sh
set -euo pipefail

HOST=${BALKARIS_HOST:-deploy@91.99.153.205}
KEY=${BALKARIS_KEY:-/e/Balkaris/secrets/hetzner_ed25519}

[ -f "$KEY" ] || { echo "no ssh key at $KEY — set BALKARIS_KEY"; exit 1; }

ssh -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes "$HOST" bash -se <<'REMOTE'
set -euo pipefail
ENV=/opt/balkaris-desk/.env

value() { grep -m1 "^$1=" "$ENV" | cut -d= -f2-; }
TG=$(value TELEGRAM_BOT_TOKEN)
HOOK=$(value TELEGRAM_WEBHOOK_SECRET)
URL=$(value DESK_URL)
URL=${URL:-https://desk.balkaris.ch}

[ -n "$TG" ] && [ -n "$HOOK" ] || { echo "the box has no bot token or no webhook secret in $ENV"; exit 1; }

curl -s -X POST "https://api.telegram.org/bot$TG/setWebhook" \
  -H 'content-type: application/json' \
  -d "{\"url\":\"$URL/tg/$HOOK\",\"secret_token\":\"$HOOK\",\"allowed_updates\":[\"message\",\"edited_message\",\"callback_query\"],\"drop_pending_updates\":false}" \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const r=JSON.parse(s);console.log("setWebhook:",r.ok?"ok":"FAILED "+r.description)})'

# The address carries the secret. Print its shape, never its value.
curl -s "https://api.telegram.org/bot$TG/getWebhookInfo" \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const r=JSON.parse(s).result||{};console.log("webhook:",(r.url||"(none)").replace(/\/tg\/[0-9a-f]+$/,"/tg/<secret>"),"| updates",(r.allowed_updates||["(all the defaults)"]).join(", "),"| pending",r.pending_update_count||0,r.last_error_message?"| last error: "+r.last_error_message:"")})'
REMOTE
