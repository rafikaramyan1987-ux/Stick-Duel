# Playgama Bridge 2.4.1 (standalone `playgama` build)

`playgama-bridge.js` is the official Playgama Bridge SDK, **version 2.4.1**, built from the official repository
without changes:

- source: https://github.com/Playgama/bridge, tag `v2.4.1` (commit `71eadef799fa38f19a22aba332fc36bb91af7a95`)
- build: `npm ci && npx ts-node scripts/build-dist.ts --type=standalone --platform=playgama`
  (the repository's own build script; output `dist/publish/standalone/playgama/playgama-bridge.js`)
- sha256: `b016a8d62eeb3a5c3704f392d0ac9d4504eb6b02338042cd539e2da6a73adc25` (checked in CI; the build is reproducible)
- licence: LGPL-3.0 (`LICENSE`, from the same tag)

Why the standalone `playgama` build and not the CDN (`https://bridge.playgama.com/v2/stable/playgama-bridge.js`) or
the npm all-platform runtime: the CDN path is not pinned to a version (`v2/stable` moves), and the all-platform runtime
carries every portal's adapter (CrazyGames, GameDistribution… SDK URLs). The standalone build has only Bridge's
`playgama` adapter plus its `standalone` / `playgama_sandbox` companions (Bridge's own `PLATFORM_BUNDLE_EXTRAS`), is
self-contained, and ships inside the zip beside `index.html` (`<script src="./playgama-bridge.js">`, the first script
in `<head>`, loaded normally). Outside Playgama (e.g. localhost) Bridge runs its mock platform.

Rebuild / verify: `bash scripts/playgama/build-bridge.sh` (clones the tag, builds, compares the sha256).
