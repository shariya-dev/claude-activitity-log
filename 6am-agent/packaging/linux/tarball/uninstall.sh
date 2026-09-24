#!/bin/sh
# Removes a per-user (tarball) install of 6am-agent: the service, the launcher link and
# ~/.local/share/6am-agent. Server-side history is never touched.
# --purge also deletes local state (~/.local/state/6am-agent: checkpoints, logs, file credentials)
# and the Secret Service entries.
# Usage: ~/.local/share/6am-agent/uninstall.sh [--purge]
set -eu

data_home=${XDG_DATA_HOME:-$HOME/.local/share}
config_home=${XDG_CONFIG_HOME:-$HOME/.config}
state_home=${XDG_STATE_HOME:-$HOME/.local/state}
dest="$data_home/6am-agent"
link="$HOME/.local/bin/6am-agent"
unit=6am-agent.service

if [ -x "$dest/bin/6am-agent" ]; then
  "$dest/bin/6am-agent" uninstall-service ||
    echo "6am-agent uninstall-service failed; removing the service files directly." >&2
fi

systemd_user=
if command -v systemctl >/dev/null 2>&1 &&
  systemctl --user show --property=Version >/dev/null 2>&1; then
  systemd_user=1
  systemctl --user disable --now "$unit" >/dev/null 2>&1 || true
fi
rm -f "$config_home/systemd/user/$unit" \
  "$config_home/systemd/user/default.target.wants/$unit" \
  "$config_home/autostart/6am-agent.desktop"
if [ -n "$systemd_user" ]; then
  systemctl --user daemon-reload || true
  systemctl --user reset-failed "$unit" >/dev/null 2>&1 || true
fi

if [ -L "$link" ] && [ "$(readlink "$link")" = "$dest/bin/6am-agent" ]; then
  rm -f "$link"
fi

if [ "${1:-}" = --purge ]; then
  if command -v secret-tool >/dev/null 2>&1; then
    secret-tool clear service com.6amtech.agent >/dev/null 2>&1 || true
  fi
  rm -rf "$state_home/6am-agent"
fi

rm -rf "$dest" "$dest.old" "$dest".new.*
echo "6am-agent removed."
