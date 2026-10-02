#!/usr/bin/env bash
# Put variables into the desk's .env on the box. Only the lines named are
# changed, every other line stays exactly as it is, and no value is ever
# printed, logged, or passed as an argument.
#
#   bash deploy/env-put.sh --mint DESK_SESSION_SECRET
#       a new random value, made ON THE BOX. It never exists anywhere else.
#
#   bash deploy/env-put.sh --ask CLARITY_TOKEN
#       asks for the value here with the typing hidden, and sends it over
#       ssh stdin. Paste the token at the prompt, never into a chat.
#
#   printf 'NAME=value\nOTHER=value\n' | bash deploy/env-put.sh
#       for another script that already holds the values (mint-secrets.sh).
#
# WHY THIS EXISTS. The first version of mint-secrets.sh rewrote the whole file
# from a list of nine variables. The file has grown since (Google sign-in, the
# analytics key, the owner), so that rewrite would now silently drop them and
# the desk would come back unable to sign anybody in. One place merges, and
# everything else goes through it.
#
# The desk is restarted afterwards so the value is in use. Names must be
# CAPITALS, digits and underscores; a value may not contain a newline.
set -euo pipefail

HOST=${BALKARIS_HOST:-deploy@91.99.153.205}
KEY=${BALKARIS_KEY:-/e/Balkaris/secrets/hetzner_ed25519}
DIR=/opt/balkaris-desk
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no -o IdentitiesOnly=yes "$HOST")

[ -f "$KEY" ] || { echo "no ssh key at $KEY — set BALKARIS_KEY"; exit 1; }

name_ok() { [[ "$1" =~ ^[A-Z][A-Z0-9_]*$ ]] || { echo "not a variable name: $1"; exit 1; }; }

# The part that runs on the box. It reads NAME=value lines on stdin, or with
# MINT set makes the values itself, and merges them into the file.
REMOTE=$(cat <<'BOX'
set -euo pipefail
umask 077
DIR=/opt/balkaris-desk
ENVF="$DIR/.env"
NEW=$(mktemp)
ADD=$(mktemp)
trap 'rm -f "$NEW" "$ADD"' EXIT

if [ -n "${MINT:-}" ]; then
  for n in $MINT; do printf '%s=%s\n' "$n" "$(openssl rand -hex 32)" >> "$ADD"; done
else
  cat > "$ADD"
fi

[ -s "$ADD" ] || { echo "nothing to put"; exit 1; }
grep -Evq '^[A-Z][A-Z0-9_]*=.+$' "$ADD" && { echo "a line is not NAME=value, or its value is empty; nothing was changed"; exit 1; }

touch "$ENVF"
cp "$ENVF" "$NEW"
names=$(cut -d= -f1 "$ADD")
for n in $names; do
  grep -v "^$n=" "$NEW" > "$NEW.t" || true
  mv "$NEW.t" "$NEW"
done
# The file must end in a newline before anything is appended to it.
[ -z "$(tail -c1 "$NEW")" ] || printf '\n' >> "$NEW"
cat "$ADD" >> "$NEW"

cp "$ENVF" "$ENVF.bak"
install -m 600 -o deploy -g deploy "$NEW" "$ENVF"
sudo systemctl restart balkaris-desk
sleep 3
systemctl is-active balkaris-desk >/dev/null && echo "placed on the box and the desk restarted: $(echo $names | tr '\n' ' ')" \
  || { echo "the desk did not come back; restoring the previous file"; install -m 600 -o deploy -g deploy "$ENVF.bak" "$ENVF"; sudo systemctl restart balkaris-desk; exit 1; }
BOX
)

case "${1:-}" in
  --mint)
    shift
    [ $# -ge 1 ] || { echo "usage: env-put.sh --mint NAME [NAME…]"; exit 1; }
    for n in "$@"; do name_ok "$n"; done
    "${SSH[@]}" "MINT='$*' bash -c $(printf '%q' "$REMOTE")" </dev/null
    ;;
  --ask)
    shift
    [ $# -eq 1 ] || { echo "usage: env-put.sh --ask NAME"; exit 1; }
    name_ok "$1"
    read -r -s -p "$1 (typing is hidden): " VALUE
    echo
    VALUE=${VALUE//$'\r'/}
    [ -n "$VALUE" ] || { echo "empty; nothing was changed"; exit 1; }
    printf '%s=%s\n' "$1" "$VALUE" | "${SSH[@]}" "bash -c $(printf '%q' "$REMOTE")"
    unset VALUE
    ;;
  "")
    "${SSH[@]}" "bash -c $(printf '%q' "$REMOTE")"
    ;;
  *)
    echo "usage: env-put.sh --mint NAME… | --ask NAME | (NAME=value lines on stdin)"
    exit 1
    ;;
esac
