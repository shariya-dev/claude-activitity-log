#!/bin/sh
# Builds the Linux packages from one per-target build payload.
# Usage: build-packages.sh <payload-dir> <version> <arch>
#   payload-dir  build output for one target, e.g. dist/linux-x64 (runtime/node, app/agent.cjs,
#                app/build-config.json, VERSION; see docs/architecture/agent.md §1)
#   version      package version, e.g. 1.0.0
#   arch         x64 | arm64
# Output (OUT_DIR, default dist/packages):
#   6am-agent_<version>_<deb-arch>.deb, 6am-agent-<version>-1.<rpm-arch>.rpm (nfpm naming),
#   6am-agent-<version>-linux-<arch>.tar.gz
# Needs nfpm (https://nfpm.goreleaser.com) on PATH for the .deb and .rpm.
set -eu

die() {
  echo "build-packages.sh: $*" >&2
  exit 1
}

[ $# -eq 3 ] || die "usage: build-packages.sh <payload-dir> <version> <arch>"
[ -d "$1" ] || die "payload dir not found: $1"
payload=$(cd "$1" && pwd)
version=$2
arch=$3

case "$arch" in
  x64) nfpm_arch=amd64 ;;
  arm64) nfpm_arch=arm64 ;;
  *) die "unsupported arch: $arch (expected x64 or arm64)" ;;
esac

for f in runtime/node app/agent.cjs VERSION; do
  [ -f "$payload/$f" ] || die "payload is missing $f"
done
command -v nfpm >/dev/null 2>&1 || die "nfpm not found on PATH"

here=$(cd "$(dirname "$0")" && pwd)
out=${OUT_DIR:-$here/../../dist/packages}
mkdir -p "$out"
out=$(cd "$out" && pwd)

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

mkdir -p "$stage/root/bin" "$stage/scripts"
cp -R "$payload/runtime" "$payload/app" "$payload/VERSION" "$stage/root/"
cp "$here/bin/6am-agent" "$stage/root/bin/"
cp "$here/scripts/postinstall.sh" "$here/scripts/preremove.sh" "$stage/scripts/"
chmod 0755 "$stage/root/runtime/node" "$stage/root/bin/6am-agent" "$stage/scripts/"*.sh

tar_name="6am-agent-$version-linux-$arch"
mkdir "$stage/$tar_name"
cp -R "$stage/root/." "$stage/$tar_name/"
cp "$here/tarball/install.sh" "$here/tarball/uninstall.sh" "$stage/$tar_name/"
chmod 0755 "$stage/$tar_name/install.sh" "$stage/$tar_name/uninstall.sh"
tar -C "$stage" -czf "$out/$tar_name.tar.gz" "$tar_name"
echo "$out/$tar_name.tar.gz"

for packager in deb rpm; do
  (cd "$stage" && VERSION="$version" NFPM_ARCH="$nfpm_arch" \
    nfpm package --config "$here/nfpm.yaml" --packager "$packager" --target "$out/")
done
