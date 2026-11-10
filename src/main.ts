import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/fredoka/latin-ext-700.css';
import './style.css';
import { loadSave } from './game/save';
import { NoopPlatform, type AdHooks, type Platform } from './platform/ads';
import { CrazyGamesPlatform } from './platform/crazygames';
import { GameDistributionPlatform } from './platform/gamedistribution';
import { GamePixPlatform } from './platform/gamepix';
import { setStorageBackend } from './platform/storage';
import { loadModels } from './render/assets';
import { App } from './ui/app';

/**
 * VITE_PLATFORM is replaced at build time (vite.config.ts), so the branches for the other
 * portals — and their SDK adapters — are dropped from the bundle.
 */
function createPlatform(hooks: AdHooks): Platform {
  if (import.meta.env.VITE_PLATFORM === 'gd') return new GameDistributionPlatform(hooks);
  if (import.meta.env.VITE_PLATFORM === 'gamepix') return new GamePixPlatform(hooks);
  if (import.meta.env.VITE_PLATFORM === 'crazygames') return window.CrazyGames?.SDK ? new CrazyGamesPlatform(hooks) : new NoopPlatform();
  return new NoopPlatform();
}

function progress(p: number): void {
  const bar = document.querySelector<HTMLElement>('.bootbar i');
  if (bar) bar.style.width = `${Math.round(p)}%`;
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
  progress(15);
  const fonts = Promise.race([
    Promise.all([document.fonts.load('700 20px Fredoka'), document.fonts.load('600 20px Fredoka')]).catch(() => undefined),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  await Promise.all([
    loadModels((done, total) => {
      const p = 15 + (done / total) * 75;
      progress(p);
      if (import.meta.env.VITE_PLATFORM === 'gamepix') platform.loadingProgress?.(Math.round(10 + (done / total) * 80));
    }),
    fonts,
  ]);
  progress(100);
  if (import.meta.env.VITE_PLATFORM === 'gamepix') {
    // GamePix: 100 %, then wait for lifecycle.loaded() before the game is shown
    platform.loadingProgress?.(90);
    await platform.loaded?.();
  }
  app = new App(root, save, platform);
  if (import.meta.env.VITE_PLATFORM === 'gamepix' && platform instanceof GamePixPlatform) platform.syncPause();
  platform.loadingStop();
  // First visit: straight into level 1 with the in-game tutorial. Returning players get the menu.
  if (!save.tutorial && Object.keys(save.levels).length === 0) app.play(0);
  else app.title();
}

void boot();
