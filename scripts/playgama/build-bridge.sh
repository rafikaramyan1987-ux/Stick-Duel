#!/usr/bin/env bash
# Rebuilds vendor/playgama-bridge/playgama-bridge.js from the official Playgama Bridge repository (tag v2.4.1,
# standalone build for the `playgama` platform) and checks it is byte-identical to the vendored copy.
set -euo pipefail
TAG=v2.4.1
SHA=b016a8d62eeb3a5c3704f392d0ac9d4504eb6b02338042cd539e2da6a73adc25
here=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
git clone -q --depth 1 --branch "$TAG" https://github.com/Playgama/bridge "$tmp/bridge"
(cd "$tmp/bridge" && npm ci --no-audit --no-fund >/dev/null && npx ts-node scripts/build-dist.ts --type=standalone --platform=playgama >/dev/null)
out="$tmp/bridge/dist/publish/standalone/playgama/playgama-bridge.js"
echo "$SHA  $out" | sha256sum -c -
cmp "$out" "$here/vendor/playgama-bridge/playgama-bridge.js" && echo "vendored Bridge $TAG matches the official build"
rm -rf "$tmp"
