#!/bin/sh
# deb prerm / rpm %preun. Runs as root. On removal (not upgrade), removes the per-user service of
# every user that installed it: local login users (UID_MIN..UID_MAX in /etc/passwd) plus anyone
# with a running session (/run/user/<uid>), so directory users are not enumerated. Users with a
# session get `6am-agent uninstall-service` (stops the unit, deregisters the device best-effort);
# for the others the unit files are deleted so nothing starts at their next login. Local state in
# ~/.local/state/6am-agent is left alone (it is the user's data; see packaging/linux/README.md).
set -e

case "${1:-}" in
  remove | 0) ;;
  *) exit 0 ;;
esac

unit=6am-agent.service
uid_min=$(awk '$1 == "UID_MIN" { print $2 }' /etc/login.defs 2>/dev/null || true)
uid_max=$(awk '$1 == "UID_MAX" { print $2 }' /etc/login.defs 2>/dev/null || true)
uid_min=${uid_min:-1000}
uid_max=${uid_max:-60000}

candidates() {
  awk -F: -v min="$uid_min" -v max="$uid_max" '$3 >= min && $3 <= max { print $1 ":" $3 ":" $6 }' /etc/passwd
  for runtime_dir in /run/user/*; do
    [ -d "$runtime_dir" ] || continue
    getent passwd "${runtime_dir##*/}" | awk -F: '{ print $1 ":" $3 ":" $6 }'
  done
}

candidates | sort -u | while IFS=: read -r user uid home; do
  [ -n "$home" ] && [ -d "$home" ] || continue
  config="$home/.config"
  files="$config/systemd/user/$unit $config/systemd/user/default.target.wants/$unit $config/autostart/6am-agent.desktop"
  found=
  for f in $files; do
    if [ -e "$f" ] || [ -L "$f" ]; then
      found=1
    fi
  done
  [ -n "$found" ] || continue

  runtime_dir="/run/user/$uid"
  if [ -d "$runtime_dir" ]; then
    runuser -u "$user" -- env XDG_RUNTIME_DIR="$runtime_dir" \
      timeout 30 /opt/6am-agent/bin/6am-agent uninstall-service >/dev/null 2>&1 ||
      runuser -u "$user" -- env XDG_RUNTIME_DIR="$runtime_dir" \
        systemctl --user disable --now "$unit" >/dev/null 2>&1 || true
  fi

  # shellcheck disable=SC2086 # $files is a space-separated list of paths without spaces
  runuser -u "$user" -- rm -f $files || true

  if [ -d "$runtime_dir" ]; then
    runuser -u "$user" -- env XDG_RUNTIME_DIR="$runtime_dir" \
      systemctl --user daemon-reload >/dev/null 2>&1 || true
  fi
  echo "6am-agent: removed the service for $user"
done

exit 0
