import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

const CRAZYGAMES_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const PLATFORMS = ['crazygames', 'gd', 'web'] as const;
type PlatformId = (typeof PLATFORMS)[number];

/**
 * Build-time platform flag: VITE_PLATFORM=crazygames | gd | web, or the build mode
 * (`vite build --mode crazygames` / `--mode gd`). Anything else is the web build.
 */
function platformFor(mode: string): PlatformId {
  const v = process.env.VITE_PLATFORM ?? mode;
  return (PLATFORMS as readonly string[]).includes(v) ? (v as PlatformId) : 'web';
}

/**
 * Only the `crazygames` build loads the CrazyGames SDK (in <head>, as the docs ask).
 * The `gd` build injects the GameDistribution SDK from code while booting
 * (src/platform/gamedistribution.ts). The web build makes no external request at all.
 */
function crazyGamesSdk(platform: PlatformId): Plugin {
  return {
    name: 'crazygames-sdk',
    transformIndexHtml(html) {
      const tag = platform === 'crazygames' ? `<script src="${CRAZYGAMES_SDK}"></script>` : '';
      return html.replace('<!--crazygames-sdk-->', tag);
    },
  };
}

// Everything (code, CSS, fonts) is inlined into a single index.html:
// dist/ (web), dist-crazygames/, dist-gd/.
export default defineConfig(({ mode }) => {
  const platform = platformFor(mode);
  return {
    base: './',
    plugins: [crazyGamesSdk(platform), viteSingleFile()],
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
