import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

const CRAZYGAMES_SDK = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const GAMEPIX_SDK = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';
const PLATFORMS = ['crazygames', 'gd', 'gamepix', 'playgama', 'web'] as const;
type PlatformId = (typeof PLATFORMS)[number];

/**
 * Build-time platform flag: VITE_PLATFORM=crazygames | gd | gamepix | playgama | web, or the build mode
 * (`vite build --mode crazygames` / `--mode gd` / `--mode gamepix` / `--mode playgama`). Anything else is the web build.
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

/**
 * Playgama build, as Playgama's docs set it up for plain JS (wiki.playgama.com/playgama/bridge-sdk/setup and
 * bridge-sdk/api "Required steps"):
 * - Bridge from Playgama's CDN, `https://bridge.playgama.com/v2/stable/playgama-bridge.js` (the recommended option: it
 *   loads the adapter of the platform the game runs on, the QA Tool's `qa_tool` one included), the first script in
 *   <head>, loaded normally (not async / defer / module);
 * - right after it, scripts/playgama/boot.js inlined: `bridge.initialize()`, and the game bundle starts only once that
 *   has settled (the module script is held as a text/plain script until then);
 * - `playgama-bridge-config.json` beside index.html (Bridge loads it from `./playgama-bridge-config.json`).
 */
export const PLAYGAMA_BRIDGE_CDN = 'https://bridge.playgama.com/v2/stable/playgama-bridge.js';
/** scripts/playgama/boot.js without its comment lines (they name the tags it handles) */
const playgamaBoot = () =>
  readFileSync('scripts/playgama/boot.js', 'utf8')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')
    .trim();
function playgamaBridge(): Plugin {
  return {
    name: 'playgama-bridge',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        { tag: 'script', attrs: { src: PLAYGAMA_BRIDGE_CDN }, injectTo: 'head-prepend' },
        { tag: 'script', children: playgamaBoot(), injectTo: 'head-prepend' },
      ],
    },
    // after vite-plugin-singlefile has inlined the bundle: hold every game module script until boot.js starts it
    generateBundle: {
      order: 'post',
      handler(_o, bundle) {
        this.emitFile({ type: 'asset', fileName: 'playgama-bridge-config.json', source: readFileSync('scripts/playgama/playgama-bridge-config.json') });
        const html = Object.values(bundle).find((a) => a.type === 'asset' && a.fileName.endsWith('.html'));
        if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
        let held = 0;
        html.source = html.source.replace(/<script type="module"([^>]*)>/g, (_m, attrs: string) => {
          held++;
          const src = attrs.match(/\ssrc="([^"]+)"/)?.[1];
          return `<script type="text/plain" data-playgama-game${src ? ` data-src="${src}"` : ''}>`;
        });
        if (!held) throw new Error('playgama build: no game module script to hold until bridge.initialize()');
      },
    },
  };
}

// Everything (code, CSS, fonts) is inlined into a single index.html:
// dist/ (web), dist-crazygames/, dist-gd/, dist-gamepix/, dist-playgama/ (+ the Bridge config; Bridge from Playgama's CDN), and dist-web/ for `--mode web`: the ad-free build for
// open portals (itch.io, Newgrounds, Y8, Playgama), the web platform without the rewarded-ad offers (src/main.ts).
export default defineConfig(({ mode }) => {
  const platform = platformFor(mode);
  return {
    base: './',
    plugins: [platformSdk(platform), viteSingleFile(), ...(platform === 'playgama' ? [playgamaBridge()] : [])],
    define: { 'import.meta.env.VITE_PLATFORM': JSON.stringify(platform) },
    build: {
      target: 'es2020',
      outDir: mode === 'web' ? 'dist-web' : platform === 'web' ? 'dist' : `dist-${platform}`,
      reportCompressedSize: true,
      chunkSizeWarningLimit: 4000,
    },
    test: {
      include: ['tests/unit/**/*.test.ts'],
      environment: 'node',
    },
  };
});
