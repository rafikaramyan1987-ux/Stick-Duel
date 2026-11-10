/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Target portal, fixed at build time by vite.config.ts: 'crazygames' | 'gd' | 'gamepix' | 'playgama' | 'web'. */
  readonly VITE_PLATFORM: 'crazygames' | 'gd' | 'gamepix' | 'playgama' | 'web';
}
