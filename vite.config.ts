import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

const CRAZYGAMES_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const GAMEPIX_SDK = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';
const PLATFORMS = ['crazygames', 'gd', 'gamepix', 'web'] as const;
type PlatformId = (typeof PLATFORMS)[number];

/**
 * Build-time platform flag: VITE_PLATFORM=crazygames | gd | gamepix | web, or the build mode
 * (`vite build --mode crazygames` / `--mode gd` / `--mode gamepix`). Anything else is the web build.
 */
function platformFor(mode: string): PlatformId {
  const v = process.env.VITE_PLATFORM ?? mode;
  return (PLATFORMS as readonly string[]).includes(v) ? (v as PlatformId) : 'web';
}

/**
 * Only the `crazygames` build loads the CrazyGames SDK (in <head>, as the docs ask).
 * Only the `gamepix` build loads the GamePix SDK v3 (in <head>, before the game bundle, with the
 * manual lifecycle config the docs ask for; src/platform/gamepix.ts drives it).
 * The `gd` build injects the GameDistribution SDK from code while booting
 * (src/platform/gamedistribution.ts). The web build makes no external request at all.
 */
function platformSdk(platform: PlatformId): Plugin {
  return {
    name: 'platform-sdk',
    transformIndexHtml(html) {
      let tag = '';
      if (platform === 'crazygames') tag = `<script src="${CRAZYGAMES_SDK}"></script>`;
      if (platform === 'gamepix') tag = `<script>window.GamePixConfig = { lifecycle: 'manual' };</script>\n    <script src="${GAMEPIX_SDK}"></script>`;
      return html.replace('<!--platform-sdk-->', tag);
    },
  };
}

// Everything (code, CSS, fonts) is inlined into a single index.html:
// dist/ (web), dist-crazygames/, dist-gd/, dist-gamepix/.
export default defineConfig(({ mode }) => {
  const platform = platformFor(mode);
  return {
    base: './',
    plugins: [platformSdk(platform), viteSingleFile()],
    define: { 'import.meta.env.VITE_PLATFORM': JSON.stringify(platform) },
    build: {
      target: 'es2020',
      outDir: platform === 'web' ? 'dist' : `dist-${platform}`,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 4000,
    },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  };
});
