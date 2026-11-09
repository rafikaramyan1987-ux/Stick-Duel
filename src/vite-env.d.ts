/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Target portal, fixed at build time by vite.config.ts: 'crazygames' | 'gd' | 'gamepix' | 'web'. */
  readonly VITE_PLATFORM: 'crazygames' | 'gd' | 'gamepix' | 'web';
}
