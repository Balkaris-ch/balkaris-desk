#!/usr/bin/env bash
# Switch the desk's Hosting screen on. ONE line, on the workstation, from the
# desk's repository (Git Bash):
#
#   bash deploy/vercel-connect.sh          does it
#   bash deploy/vercel-connect.sh --dry    says what it would do. It calls no
#                                          Vercel endpoint at all and writes
#                                          nothing; it only reads the token
#                                          file's presence and asks the desk's
#                                          own door whether it is deployed.
#
# WHAT IT DOES, each step only when needed, so running it again is safe:
#
#   1. reads the team token VERCEL_TOKEN from balkaris-cms/.env.local into a
#      variable. It is never printed, never an argument, never in an address:
#      it reaches deploy/vercel-connect.mjs through that one child's
#      environment and Vercel through an Authorization header.
#   2. asks the desk's door (GET https://desk.balkaris.ch/drain/vercel) whether
#      it is deployed. The drain cannot be created before it is: Vercel tests
#      the endpoint when it creates the drain.
#   3. the Log Drain, for the website's project only, production only, sources
#      static + lambda + edge + build, NDJSON, to the door:
#        - a drain to that address already exists: it is not made twice. Its
#          secret is read back from Vercel and placed on the box again (so a
#          box that lost it gets it back); if Vercel does not show it, the
#          manual step is printed;
#        - none exists: a secret is made here (openssl rand -hex 32), placed
#          on the box with
#              printf 'VERCEL_DRAIN_SECRET=%s\n' "$S" | bash deploy/env-put.sh
#          (which restarts the desk), the door is asked until it says ready,
#          Vercel is asked to send it a test batch (POST /v1/drains/test), and
#          only when that went through is the drain created (POST /v1/drains).
#   4. the desk's own Vercel token (DESK_VERCEL_TOKEN) is NOT made here.
#      Vercel's API mints a token only for a full-account token ("Creating
#      tokens through the CLI or API requires a full-account token",
#      vercel.com/docs/accounts/access-tokens), and the one in balkaris-cms is
#      team-scoped; a team-wide token for the desk is out of the question. The
#      two lines to do it by hand are printed at the end.
#
# It prints names and states only, never a value.
set -euo pipefail

DRY=0
for a in "$@"; do
  case "$a" in
    --dry) DRY=1 ;;
    *) echo "usage: bash deploy/vercel-connect.sh [--dry]"; exit 2 ;;
  esac
done

HERE=$(cd "$(dirname "$0")" && pwd)
ENVFILE=${BALKARIS_CMS_ENV:-/e/Balkaris/Code/balkaris-cms/.env.local}
KEY=${BALKARIS_KEY:-/e/Balkaris/secrets/hetzner_ed25519}
DOOR=${DRAIN_ENDPOINT:-https://desk.balkaris.ch/drain/vercel}
export DRAIN_ENDPOINT=$DOOR

say() { printf '%s\n' "$*"; }
step() { printf '\n%s\n' "$*"; }

# ---- 1. the team token ------------------------------------------------------
step "1. The team token"
[ -f "$ENVFILE" ] || { say "   no file at $ENVFILE (set BALKARIS_CMS_ENV)"; exit 1; }
VT=$(grep -m1 -E '^VERCEL_TOKEN=' "$ENVFILE" | cut -d= -f2- | tr -d '\r' || true)
VT=${VT#\"}; VT=${VT%\"}; VT=${VT#\'}; VT=${VT%\'}
[ -n "$VT" ] || { say "   $ENVFILE has no VERCEL_TOKEN line"; exit 1; }
say "   VERCEL_TOKEN read from $(basename "$(dirname "$ENVFILE")")/$(basename "$ENVFILE") (${#VT} characters; the value is not shown)"
[ -f "$KEY" ] && say "   the box's ssh key is there, for env-put.sh" || say "   no ssh key at $KEY: env-put.sh will refuse (set BALKARIS_KEY)"

vercel() { VERCEL_CONNECT_TOKEN="$VT" node "$HERE/vercel-connect.mjs" "$@"; }

# ---- 2. the desk's door -----------------------------------------------------
step "2. The desk's door, $DOOR"
door_ready() { curl -s -m 15 "$DOOR" 2>/dev/null | grep -q '"ready":true'; }
door_there() { curl -s -m 15 "$DOOR" 2>/dev/null | grep -q '"door":"vercel-drain"'; }
if door_there; then
  if door_ready; then say "   deployed, and it already holds a secret"; else say "   deployed; it holds no secret yet"; fi
else
  say "   not answering as the drain's door (the desk is not deployed with it yet: src/cc/vercel/drain.ts,"
  say "   the /drain/vercel exemption in src/server.ts and the /drain/vercel path in deploy/Caddyfile.desk)."
  if [ "$DRY" = 1 ]; then
    say "   A real run stops here until bash deploy/push.sh has deployed the desk."
  else
    say "   Deploy the desk first (bash deploy/push.sh), then run this again. Nothing was changed."
    exit 1
  fi
fi

# ---- 3. the drain -------------------------------------------------------------
step "3. The Log Drain (project prj_WTjPcDZitjDlW32Cp5920AVLkAj4, production; static, lambda, edge, build; NDJSON)"
if [ "$DRY" = 1 ]; then
  say "   --dry: nothing is asked of Vercel. A real run would:"
  say "   a. list the team's drains for the project and look for one delivering to $DOOR;"
  say "   b. if there is one: read its secret back and place it on the box (no second drain);"
  say "   c. if there is none: make a secret here, place it on the box with"
  say "        printf 'VERCEL_DRAIN_SECRET=%s\\n' \"\$S\" | bash deploy/env-put.sh"
  say "      wait for the door to say ready, have Vercel send it a test batch, then create the drain."
  say "   The requests, exactly:"
  node "$HERE/vercel-connect.mjs" plan 2>&1 | sed 's/^/   /'
else
  FOUND=$(vercel find)
  read -r WHAT ID STATUS SECRET_STATE <<<"$FOUND"
  if [ "$WHAT" = "found" ]; then
    say "   a drain to the door exists ($ID, $STATUS): not created again"
    [ "$STATUS" = "enabled" ] || say "   it is $STATUS: Team Settings > Drains says why; Resume it there"
    if [ "$SECRET_STATE" = "readable" ]; then
      S=$(vercel secret "$ID")
      printf 'VERCEL_DRAIN_SECRET=%s\n' "$S" | bash "$HERE/env-put.sh"
      unset S
      say "   its secret is placed on the box again"
    else
      say "   Vercel does not show its secret. By hand: Team Settings > Drains > $ID > Edit, copy the"
      say "   Signature Verification Secret, then: bash deploy/env-put.sh --ask VERCEL_DRAIN_SECRET"
    fi
  else
    S=$(openssl rand -hex 32)
    printf 'VERCEL_DRAIN_SECRET=%s\n' "$S" | bash "$HERE/env-put.sh"
    say "   a new secret is placed on the box (made here, never shown)"
    for i in $(seq 1 30); do door_ready && break; sleep 2; done
    door_ready || { say "   the door does not say ready after a minute; nothing was created at Vercel. Run this again."; unset S; exit 1; }
    say "   the door is ready"
    if ! DRAIN_SECRET="$S" vercel test; then
      say "   Vercel's test did not get through, so no drain was created. The secret on the box is harmless; run this again once the door answers."
      unset S
      exit 1
    fi
    DRAIN_SECRET="$S" vercel create >/dev/null
    unset S
  fi
fi

# ---- 4. the desk's own token ---------------------------------------------------
step "4. The desk's own Vercel token (DESK_VERCEL_TOKEN): by hand, two lines"
say "   Vercel's API mints a token only for a full-account token, and the one here is team-scoped,"
say "   so the script makes none (and never a team-wide one for the desk):"
say "   1. vercel.com/account/tokens: name desk-hosting, Scope: team balkaris, then the project"
say "      balkaris-web-infrastructure (not All Projects), expiration 1 year, Create; copy it once."
say "   2. bash deploy/env-put.sh --ask DESK_VERCEL_TOKEN      (paste it at the hidden prompt)"

step "Then, by hand"
say "   - E:\\Balkaris\\secrets\\README.md: a row each for VERCEL_DRAIN_SECRET and DESK_VERCEL_TOKEN"
say "     (name, scope, date, /opt/balkaris-desk/.env); never the value."
say "   - Recommended: Vercel Team Settings > Security & Privacy > IP Address Visibility: hidden in Drains."
say "     The desk keeps no IP address either way; hidden, it never receives one."
say "   - The day after the drain starts, once people have opened pages: desk.balkaris.ch/hosting,"
say "     'How page views are counted' must show Prefetches above zero. That proves Vercel's records"
say "     carry the router's markers (?_rsc= in proxy.path, .segments/.rsc in path). If the panel says"
say "     'Router markers absent', the page views include prefetches: the desk's code needs a look."
unset VT
