#!/bin/sh
# Installs 6am-agent for the current user, without root:
#   ~/.local/share/6am-agent/   runtime, app, launcher
#   ~/.local/bin/6am-agent      symlink to the launcher
# then pairs the device (which installs the systemd --user service). On an upgrade of a device
# that is already set up, it only reinstalls and restarts the service.
# Usage: ./install.sh [--no-pair]
set -eu

if [ "$(id -u)" -eq 0 ]; then
  echo "Run install.sh as your normal user, not root. The agent is installed per user." >&2
  exit 1
fi

src=$(cd "$(dirname "$0")" && pwd)
data_home=${XDG_DATA_HOME:-$HOME/.local/share}
config_home=${XDG_CONFIG_HOME:-$HOME/.config}
dest="$data_home/6am-agent"
bindir="$HOME/.local/bin"

already_set_up=
if [ -e "$config_home/systemd/user/6am-agent.service" ] ||
  [ -e "$config_home/autostart/6am-agent.desktop" ]; then
  already_set_up=1
fi

mkdir -p "$data_home" "$bindir"
staging="$dest.new.$$"
rm -rf "$staging"
mkdir "$staging"
trap 'rm -rf "$staging"' EXIT
cp -R "$src/runtime" "$src/app" "$src/bin" "$src/VERSION" "$src/uninstall.sh" "$staging/"
chmod 0755 "$staging/runtime/node" "$staging/bin/6am-agent" "$staging/uninstall.sh"

if [ -d "$dest" ]; then
  rm -rf "$dest.old"
  mv "$dest" "$dest.old"
fi
mv "$staging" "$dest"
rm -rf "$dest.old"
ln -sfn "$dest/bin/6am-agent" "$bindir/6am-agent"

echo "Installed 6am-agent $(cat "$dest/VERSION") in $dest"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "Add $bindir to your PATH to run '6am-agent' directly." ;;
esac

if [ "${1:-}" = --no-pair ]; then
  echo "Run '$bindir/6am-agent pair' to finish setup."
elif [ -n "$already_set_up" ]; then
  "$dest/bin/6am-agent" install-service
else
  "$dest/bin/6am-agent" pair
fi
