#!/bin/bash
# Removes the 6AM agent from this Mac, for every user that has it: stops and removes the per-user
# LaunchAgent (the agent's uninstall-service also deregisters the device, best effort), deletes
# its Keychain items and per-user state, then removes the installed runtime and the pkg receipt.
# Keeps only ~/Library/Logs/6amAgent. Server-side history is never deleted.
#
# Usage: sudo "/Library/Application Support/6amAgent/current/uninstall.sh"
set -u

APP_ROOT="/Library/Application Support/6amAgent"
NODE="$APP_ROOT/current/runtime/node"
ENTRY="$APP_ROOT/current/app/agent.cjs"
LABEL=com.6amtech.agent
MAX_KEYCHAIN_ITEMS=20

log() {
  echo "6amAgent uninstall: $*"
}

remove_for_user() {
  local home=$1 user uid plist data i
  plist="$home/Library/LaunchAgents/$LABEL.plist"
  data="$home/Library/Application Support/6amAgent"
  [ -e "$plist" ] || [ -e "$data" ] || return 0
  user=$(/usr/bin/stat -f%Su "$home")
  uid=$(/usr/bin/id -u "$user" 2>/dev/null) || return 0
  log "removing for $user"

  as_user() {
    /bin/launchctl asuser "$uid" /usr/bin/sudo -u "$user" -H "$@"
  }

  if [ -x "$NODE" ] && [ -f "$ENTRY" ]; then
    as_user "$NODE" "$ENTRY" uninstall-service || log "uninstall-service failed; removing the LaunchAgent directly"
  fi
  /bin/launchctl bootout "gui/$uid/$LABEL" >/dev/null 2>&1
  /bin/rm -f "$plist"

  for ((i = 0; i < MAX_KEYCHAIN_ITEMS; i++)); do
    as_user /usr/bin/security delete-generic-password -s "$LABEL" >/dev/null 2>&1 || break
  done
  if as_user /usr/bin/security find-generic-password -s "$LABEL" >/dev/null 2>&1; then
    log "could not delete the $LABEL Keychain items of $user (login keychain locked?);" \
      "remove them in Keychain Access"
  fi
  /bin/rm -rf "$data"
}

main() {
  if [ "$(/usr/bin/id -u)" -ne 0 ]; then
    echo "run with sudo: sudo \"$0\"" >&2
    exit 1
  fi
  local home
  for home in /Users/*; do
    [ -d "$home" ] && remove_for_user "$home"
  done
  /bin/rm -rf "$APP_ROOT"
  /usr/sbin/pkgutil --forget "$LABEL" >/dev/null 2>&1
  log "done (logs kept in ~/Library/Logs/6amAgent)"
}

# Everything runs from main so the whole script is parsed before it deletes its own directory.
main "$@"
