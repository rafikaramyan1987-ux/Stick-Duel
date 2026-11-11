import type { AdHooks, AdsUnavailable, Platform, StorageLike } from './ads';

/**
 * GameMonetize.com HTML5 SDK adapter (https://github.com/GameMonetize/GameMonetize.com-SDK).
 * Only bundled in the `gamemonetize` build (VITE_PLATFORM=gamemonetize, see vite.config.ts and main.ts).
 *
 * - `window.SDK_OPTIONS = { gameId, onEvent }` is set, then https://api.gamemonetize.com/sdk.js is injected once from
 *   init(), i.e. while the game boots, never from a click: a `<script id="gamemonetize-sdk">` before the first script
 *   of the page, as the README's loader does, only if no element with that id exists yet.
 * - SDK_GAME_PAUSE: the game pauses and all audio is muted (AdHooks.onAdPause(true)); SDK_GAME_START: the game resumes
 *   and audio comes back through the player's own settings (onAdPause(false)); SDK_READY: interstitials allowed.
 * - Interstitials (`sdk.showBanner()`) only at the GD build's natural breaks: the first Play of the title (pre-roll)
 *   and the result-screen buttons (App.breakThen, MidgameThrottle). The adapter adds its own gap so that at most one
 *   ad is shown per ~2 minutes in all (pre-roll included). Never during gameplay, never on a timer.
 * - Every request settles exactly once: SDK_GAME_START, showBanner() throwing / no SDK, or not started within 8 s.
 * - No rewarded API in the GameMonetize SDK: adsUnavailable() is 'disabled', so the game hides every "watch an ad"
 *   button, and rewarded() never shows anything (showBanner() is never used as a fake rewarded ad).
 * - Saves stay in localStorage. If the SDK fails to load (ad blocker, offline) the game plays on without ads.
 */
export const GM_GAME_ID = 'qgdkibss7nawv209v2pfh8txf4p94eas';
export const GM_SDK_URL = 'https://api.gamemonetize.com/sdk.js';
export const GM_SCRIPT_ID = 'gamemonetize-sdk';
/** If no SDK_GAME_PAUSE has come this long after showBanner(), the request is given up (the game continues). */
export const AD_START_TIMEOUT_MS = 8000;
/** A started ad that never sends SDK_GAME_START is given up after this long, so the game cannot stay paused. */
export const AD_MAX_MS = 120_000;
/** At most one interstitial per this long (pre-roll included). */
export const GM_AD_GAP_MS = 2 * 60 * 1000;
/** init() waits at most this long for the SDK script before the game starts without it. */
export const GM_LOAD_WAIT_MS = 3000;

export interface GMEvent {
  name: string;
}
interface GMSdk {
  showBanner(): unknown;
}
declare global {
  interface Window {
    SDK_OPTIONS?: { gameId: string; onEvent: (event: GMEvent) => void };
    sdk?: GMSdk;
  }
}

interface Pending {
  started: boolean;
  finish(why: string): void;
}

export class GameMonetizePlatform implements Platform {
  readonly name = 'gamemonetize';
  private sdkReady = false;
  private playing = false;
  private adPaused = false;
  private pending: Pending | null = null;
  private prerollDone = false;
  /** time of the last interstitial request (none yet: -Infinity, so the pre-roll may run) */
  private lastAd = -Infinity;

  constructor(
    private readonly hooks: AdHooks,
    private readonly gameId = GM_GAME_ID,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** README loader: SDK_OPTIONS first, then sdk.js once. Waits for the script (load / error) at most `waitMs`. */
  async init(waitMs = GM_LOAD_WAIT_MS): Promise<void> {
    try {
      window.SDK_OPTIONS = { gameId: this.gameId, onEvent: (e) => this.onEvent(e) };
      const doc = window.document;
      if (!doc || doc.getElementById(GM_SCRIPT_ID)) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(done, waitMs);
        const s = doc.createElement('script');
        s.id = GM_SCRIPT_ID;
        s.src = GM_SDK_URL;
        s.onload = done;
        s.onerror = () => {
          console.info('[GameMonetize] SDK failed to load: playing without ads');
          done();
        };
        const first = doc.getElementsByTagName('script')[0];
        if (first?.parentNode) first.parentNode.insertBefore(s, first);
        else (doc.head ?? doc.body).appendChild(s);
      });
    } catch (err) {
      console.warn('[GameMonetize] init failed', err);
    }
  }

  /** SDK event bus (SDK_OPTIONS.onEvent), also for ads the SDK shows by itself. Never throws. */
  onEvent(event: GMEvent): void {
    try {
      switch (event?.name) {
        case 'SDK_READY':
          this.sdkReady = true;
          break;
        case 'SDK_GAME_PAUSE':
          if (this.pending) this.pending.started = true;
          this.setAdPaused(true);
          break;
        case 'SDK_GAME_START':
          this.setAdPaused(false);
          this.pending?.finish('finished');
          break;
      }
    } catch (err) {
      console.warn('[GameMonetize] onEvent failed', err);
    }
  }

  /** SDK_READY seen and sdk.showBanner() present */
  get adsReady(): boolean {
    return this.sdkReady && typeof window.sdk?.showBanner === 'function';
  }

  private setAdPaused(paused: boolean): void {
    if (this.adPaused === paused) return;
    this.adPaused = paused;
    try {
      this.hooks.onAdPause(paused);
    } catch (err) {
      console.warn('[GameMonetize] onAdPause failed', err);
    }
  }

  /** showBanner(), settled exactly once: SDK_GAME_START, a throw, nothing started in 8 s, or AD_MAX_MS in all. */
  private request(): Promise<void> {
    const sdk = window.sdk;
    // never during gameplay (the game only asks at breaks; this is a second guard)
    if (!this.adsReady || !sdk || this.pending || this.playing) return Promise.resolve();
    this.lastAd = this.now();
    return new Promise<void>((resolve) => {
      let settled = false;
      const p: Pending = {
        started: false,
        finish: (why) => {
          if (settled) return;
          settled = true;
          clearTimeout(startTimer);
          clearTimeout(capTimer);
          if (this.pending === p) this.pending = null;
          if (why !== 'finished') console.info(`[GameMonetize] ad not shown: ${why}`);
          this.setAdPaused(false);
          resolve();
        },
      };
      this.pending = p;
      const startTimer = setTimeout(() => {
        if (!p.started) p.finish('timeout');
      }, AD_START_TIMEOUT_MS);
      const capTimer = setTimeout(() => p.finish('never ended'), AD_MAX_MS);
      try {
        sdk.showBanner();
      } catch (err) {
        console.warn('[GameMonetize] showBanner threw', err);
        p.finish('exception');
      }
    });
  }

  /** Pre-roll: one interstitial on the first Play click of the session. */
  async preroll(): Promise<void> {
    if (this.prerollDone) return;
    this.prerollDone = true;
    await this.request();
  }

  /** Result-screen break: an interstitial unless one was shown less than ~2 minutes ago. */
  async midgame(): Promise<void> {
    if (this.now() - this.lastAd < GM_AD_GAP_MS) return;
    await this.request();
  }

  /** No rewarded API in the GameMonetize SDK: never shows an ad, never grants a reward. */
  async rewarded(): Promise<boolean> {
    return false;
  }

  /** Always 'disabled': every "watch an ad" button is hidden in this build. */
  adsUnavailable(): AdsUnavailable {
    return 'disabled';
  }

  loadingStart(): void {}
  loadingStop(): void {}
  gameplayStart(): void {
    this.playing = true;
  }
  gameplayStop(): void {
    this.playing = false;
  }
  happytime(): void {}
  locale(): string | null {
    return null;
  }
  /** Saves stay in localStorage (with the in-memory fallback of storage.ts). */
  storage(): StorageLike | null {
    return null;
  }
  platformMuted(): boolean {
    return false;
  }
  onPlatformMuteChange(): void {}
}
