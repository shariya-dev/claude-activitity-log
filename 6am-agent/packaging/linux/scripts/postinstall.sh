#!/bin/sh
# deb postinst / rpm %post. Runs as root. The service is per user, so nothing is started for
# root. On upgrade, a logged-in user's existing unit is rewritten with `install-service` (which
# restarts it), so unit changes such as new node flags take effect; if that fails, the running
# unit is only restarted. Users who are not logged in get the new unit at their next
# `6am-agent install-service` or re-pair.
set -e

for runtime_dir in /run/user/*; do
  [ -d "$runtime_dir" ] || continue
  uid=${runtime_dir##*/}
  entry=$(getent passwd "$uid") || continue
  user=$(printf '%s' "$entry" | cut -d: -f1)
  home=$(printf '%s' "$entry" | cut -d: -f6)
  [ -n "$user" ] || continue
  if [ -n "$home" ] && [ -f "$home/.config/systemd/user/6am-agent.service" ] &&
    runuser -u "$user" -- env HOME="$home" XDG_RUNTIME_DIR="$runtime_dir" \
      /usr/bin/6am-agent install-service >/dev/null 2>&1; then
    continue
  fi
  runuser -u "$user" -- env XDG_RUNTIME_DIR="$runtime_dir" \
    systemctl --user try-restart 6am-agent.service >/dev/null 2>&1 || true
done

cat <<'EOF'

6am-agent is installed in /opt/6am-agent.
To finish setup, run this as your normal user (not root):

    6am-agent pair

EOF
