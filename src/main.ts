import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/fredoka/latin-ext-700.css';
import './style.css';
import { loadSave } from './game/save';
import { NoopPlatform, type AdHooks, type AdsUnavailable, type Platform } from './platform/ads';
import { CrazyGamesPlatform } from './platform/crazygames';
import { GameDistributionPlatform } from './platform/gamedistribution';
import { GamePixPlatform } from './platform/gamepix';
import { PlaygamaPlatform } from './platform/playgama';
import { setStorageBackend } from './platform/storage';
import { App } from './ui/app';

/**
 * VITE_PLATFORM is replaced at build time (vite.config.ts), so the branches for the other
 * portals — and their SDK adapters — are dropped from the bundle.
 */
function createPlatform(hooks: AdHooks): Platform {
  // `vite build --mode web` (open portals): no ads at all, so the rewarded-ad offers (try a weapon, double coins,
  // revive) are not shown — instead of being granted for free like on the GitHub Pages / dev web build
  if (import.meta.env.MODE === 'web') return Object.assign(new NoopPlatform(), { adsUnavailable: (): AdsUnavailable => 'disabled', rewarded: async () => false });
  if (import.meta.env.VITE_PLATFORM === 'gd') return new GameDistributionPlatform(hooks);
  if (import.meta.env.VITE_PLATFORM === 'gamepix') return new GamePixPlatform(hooks);
  if (import.meta.env.VITE_PLATFORM === 'playgama') return new PlaygamaPlatform(hooks);
  if (import.meta.env.VITE_PLATFORM === 'crazygames') return window.CrazyGames?.SDK ? new CrazyGamesPlatform(hooks) : new NoopPlatform();
  return new NoopPlatform();
}

async function boot(): Promise<void> {
  const root = document.getElementById('app') as HTMLElement;
  let app: App | null = null;
  const hooks = { onAdPause: (paused: boolean) => app?.onAdPause(paused) };
  const platform = createPlatform(hooks);
  await platform.init();
  platform.loadingStart();
  if (import.meta.env.VITE_PLATFORM === 'gamepix') platform.loadingProgress?.(10);
  setStorageBackend(platform.storage());
  const save = loadSave();
  if (import.meta.env.VITE_PLATFORM === 'gamepix') platform.loadingProgress?.(40);
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    await Promise.all([document.fonts.load('700 20px Fredoka'), document.fonts.load('600 20px Fredoka')]);
  } catch {
    /* fonts are optional */
  }
  if (import.meta.env.VITE_PLATFORM === 'gamepix') {
    // GamePix: 100 %, then wait for lifecycle.loaded() before the menu is shown
    platform.loadingProgress?.(90);
    await platform.loaded?.();
  }
  app = new App(root, save, platform);
  if (import.meta.env.VITE_PLATFORM === 'gamepix' && platform instanceof GamePixPlatform) platform.syncPause();
  if (import.meta.env.VITE_PLATFORM === 'playgama' && platform instanceof PlaygamaPlatform) platform.syncPause();
  app.title();
  platform.loadingStop();
  // Playgama: game_ready once the boot screen is gone and the title menu takes input
  if (import.meta.env.VITE_PLATFORM === 'playgama') setTimeout(() => platform.gameReady?.(), 500);
}

void boot();
