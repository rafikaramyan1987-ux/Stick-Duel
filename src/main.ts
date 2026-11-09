import '@fontsource/fredoka/latin-600.css';
import '@fontsource/fredoka/latin-700.css';
import '@fontsource/fredoka/latin-ext-700.css';
import './style.css';
import { loadSave } from './game/save';
import { NoopPlatform, type AdHooks, type Platform } from './platform/ads';
import { CrazyGamesPlatform } from './platform/crazygames';
import { GameDistributionPlatform } from './platform/gamedistribution';
import { setStorageBackend } from './platform/storage';
import { App } from './ui/app';

/**
 * VITE_PLATFORM is replaced at build time (vite.config.ts), so the branches for the other
 * portals — and their SDK adapters — are dropped from the bundle.
 */
function createPlatform(hooks: AdHooks): Platform {
  if (import.meta.env.VITE_PLATFORM === 'gd') return new GameDistributionPlatform(hooks);
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
  setStorageBackend(platform.storage());
  const save = loadSave();
  try {
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    await Promise.all([document.fonts.load('700 20px Fredoka'), document.fonts.load('600 20px Fredoka')]);
  } catch {
    /* fonts are optional */
  }
  app = new App(root, save, platform);
  app.title();
  platform.loadingStop();
}

void boot();
