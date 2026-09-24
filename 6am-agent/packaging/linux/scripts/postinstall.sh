#!/bin/sh
# deb postinst / rpm %post. Runs as root. The service is per user, so nothing is started for
# root; on upgrade, units that are already running are restarted so they pick up the new build.
set -e

for runtime_dir in /run/user/*; do
  [ -d "$runtime_dir" ] || continue
  uid=${runtime_dir##*/}
  user=$(getent passwd "$uid" | cut -d: -f1) || continue
  [ -n "$user" ] || continue
  runuser -u "$user" -- env XDG_RUNTIME_DIR="$runtime_dir" \
    systemctl --user try-restart 6am-agent.service >/dev/null 2>&1 || true
done

cat <<'EOF'

6am-agent is installed in /opt/6am-agent.
To finish setup, run this as your normal user (not root):

    6am-agent pair

EOF
