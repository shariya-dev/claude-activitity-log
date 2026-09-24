#!/bin/bash
# Builds the macOS installer from a per-target payload (dist/darwin-<arch>, agent.md §1):
#   <payload>/runtime/node  <payload>/app/agent.cjs  <payload>/app/build-config.json  [<payload>/VERSION]
#
# Usage: build-pkg.sh <payload-dir> <version> [--out <dir>]
#                     [--sign "Developer ID Installer: …"] [--notarize-profile <keychain-profile>]
#
# The pkg installs to /Library/Application Support/6amAgent/<version> with a stable `current`
# symlink; its postinstall registers the per-user LaunchAgent for the console user. Signing and
# notarization run only when their options are given (unsigned builds are for internal testing).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
IDENTIFIER=com.6amtech.agent
INSTALL_LOCATION="/Library/Application Support/6amAgent"

usage() {
  sed -n '6,7p' "$0" | sed 's/^# //' >&2
  exit 64
}

die() {
  echo "build-pkg: $*" >&2
  exit 1
}

[ $# -ge 2 ] || usage
PAYLOAD=$(cd "$1" 2>/dev/null && pwd) || die "payload dir not found: $1"
VERSION=$2
shift 2

OUT_DIR="$HERE/../../dist/macos"
SIGN=""
NOTARIZE_PROFILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT_DIR=${2:?--out needs a dir}; shift 2 ;;
    --sign) SIGN=${2:?--sign needs an identity}; shift 2 ;;
    --notarize-profile) NOTARIZE_PROFILE=${2:?--notarize-profile needs a profile}; shift 2 ;;
    *) usage ;;
  esac
done

[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "invalid version: $VERSION"
[ -x "$PAYLOAD/runtime/node" ] || die "missing executable $PAYLOAD/runtime/node"
[ -f "$PAYLOAD/app/agent.cjs" ] || die "missing $PAYLOAD/app/agent.cjs"
if [ -f "$PAYLOAD/VERSION" ] && [ "$(tr -d '[:space:]' <"$PAYLOAD/VERSION")" != "$VERSION" ]; then
  die "payload VERSION ($(cat "$PAYLOAD/VERSION")) does not match $VERSION"
fi
[ -z "$NOTARIZE_PROFILE" ] || [ -n "$SIGN" ] || die "--notarize-profile requires --sign"

# Installer refuses the pkg on a Mac whose CPU the bundled runtime cannot run on. file(1) rather
# than lipo, which needs the Xcode command line tools.
ARCHS=$(/usr/bin/file -b "$PAYLOAD/runtime/node" | head -1 | grep -oE 'x86_64|arm64' | sort -u | paste -sd, -)
case "$ARCHS" in
  arm64) SUFFIX=arm64 ;;
  x86_64) SUFFIX=x64 ;;
  arm64,x86_64) SUFFIX=universal ;;
  *) die "runtime/node is not a macOS arm64/x86_64 executable" ;;
esac
HOST_ARCHS=$ARCHS

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

ROOT="$WORK/root"
mkdir -p "$ROOT/$VERSION" "$WORK/scripts" "$WORK/packages"
chmod 755 "$ROOT"
/usr/bin/ditto "$PAYLOAD/runtime" "$ROOT/$VERSION/runtime"
/usr/bin/ditto "$PAYLOAD/app" "$ROOT/$VERSION/app"
printf '%s\n' "$VERSION" >"$ROOT/$VERSION/VERSION"
install -m 0755 "$HERE/uninstall.sh" "$ROOT/$VERSION/uninstall.sh"
ln -s "$VERSION" "$ROOT/current"
install -m 0755 "$HERE/scripts/postinstall" "$WORK/scripts/postinstall"

/usr/bin/pkgbuild \
  --root "$ROOT" \
  --install-location "$INSTALL_LOCATION" \
  --identifier "$IDENTIFIER" \
  --version "$VERSION" \
  --ownership recommended \
  --scripts "$WORK/scripts" \
  "$WORK/packages/6amAgent-component.pkg"

sed -e "s/@VERSION@/$VERSION/g" -e "s/@HOST_ARCHS@/$HOST_ARCHS/g" \
  "$HERE/distribution.xml" >"$WORK/distribution.xml"

mkdir -p "$OUT_DIR"
OUT="$(cd "$OUT_DIR" && pwd)/6amAgent-$VERSION-$SUFFIX.pkg"
SIGN_ARGS=()
[ -z "$SIGN" ] || SIGN_ARGS=(--sign "$SIGN")
/usr/bin/productbuild \
  --distribution "$WORK/distribution.xml" \
  --resources "$HERE/resources" \
  --package-path "$WORK/packages" \
  ${SIGN_ARGS[@]+"${SIGN_ARGS[@]}"} \
  "$OUT"

if [ -n "$SIGN" ]; then
  /usr/sbin/pkgutil --check-signature "$OUT"
fi
if [ -n "$NOTARIZE_PROFILE" ]; then
  /usr/bin/xcrun notarytool submit "$OUT" --keychain-profile "$NOTARIZE_PROFILE" --wait
  /usr/bin/xcrun stapler staple "$OUT"
fi

echo "$OUT"
