import type { AdHooks, AdsUnavailable, Platform, StorageLike } from './ads';

/**
 * Y8 SDK adapter (https://docs.y8.com/sdk/advertising/, /sdk/ad-placement-guidelines/, /studio/game-requirements/).
 * Only bundled in the `y8` build (VITE_PLATFORM=y8, see vite.config.ts and main.ts).
 *
 * - The SDK comes only from Y8's CDN: `<script src="https://cdn.y8.com/minimal-sdk/2-0/y8.min.js" async>` in <head>
 *   (vite.config.ts, Y8 build only), never bundled.
 * - Initialized once, exactly as the portal snippet: a `y8sdk.ready` listener ({ once: true }) that runs
 *   `y8Sdk = y8.sdk()`, `y8Sdk.init({ appId, autoLogin: true }, { gameId, preloadAdBreaks: 'on', sound: 'on', onReady })`
 *   and `y8Sdk.onAuth(...)`, then `window.y8.emitReadyEvent()` in case the SDK had already loaded. Guest play always
 *   works: onAuth only logs, nothing waits for a login. No ad call before init.
 * - Interstitials, only from a click outside gameplay: type 'start' on the first Play of the title (App.prerollThen),
 *   type 'next' on Next / Retry / Menu of a result screen (App.breakThen, with no throttle of the game's own in this
 *   build: the SDK paces them). A break that shows no ad continues at once.
 * - Pause + mute in beforeAd, resume + restore audio (the player's settings) in afterAd. Every request settles
 *   exactly once: adBreakDone, .catch() / a throw, nothing started within 8 s, or AD_MAX_MS in all.
 * - Rewarded (type 'reward'): beforeReward(showAdFn) calls showAdFn(); the reward only after adViewed; adDismissed or
 *   no ad = no reward (the button then says "No ad available right now, try later" and the game goes on).
 * - Y8 requirement: pause and mute while the page is hidden (visibilitychange) or the window has lost focus (blur),
 *   resume on return (focus / visible again).
 * - Saves stay in localStorage. With an ad blocker (no SDK) the game plays on without ads and hides rewarded buttons.
 */
export const Y8_APP_ID = '6af4b1f4ca1c6869a74e0a2f';
export const Y8_GAME_ID = '292551';
export const Y8_SDK_URL = 'https://cdn.y8.com/minimal-sdk/2-0/y8.min.js';
/** If an ad break has neither started nor ended this long after showAd(), the request is given up. */
export const AD_START_TIMEOUT_MS = 8000;
/** A started ad whose break never ends is given up after this long, so the game cannot stay paused. */
export const AD_MAX_MS = 120_000;
/** init() waits at most this long for `y8sdk.ready` before the game starts (a late SDK still initializes). */
export const Y8_READY_WAIT_MS = 3000;

export type Y8AdType = 'start' | 'next' | 'reward';
export interface Y8AdBreakInfo {
  breakStatus?: string;
}
export interface Y8ShowAdOptions {
  type: Y8AdType;
  name: string;
  beforeAd?: () => void;
  afterAd?: () => void;
  beforeReward?: (showAdFn: () => void) => void;
  adViewed?: () => void;
  adDismissed?: () => void;
  adBreakDone?: (info?: Y8AdBreakInfo) => void;
}
export interface Y8AppConfig {
  appId: string;
  autoLogin: boolean;
}
export interface Y8AdConfig {
  gameId: string;
  preloadAdBreaks: 'on' | 'off';
  sound: 'on' | 'off';
  onReady: () => void;
}
export interface Y8Sdk {
  init(appConfig: Y8AppConfig, adConfig: Y8AdConfig): unknown;
  onAuth(cb: (user: unknown, error: unknown) => void): unknown;
  showAd(opts: Y8ShowAdOptions): Promise<unknown> | unknown;
}
declare global {
  interface Window {
    y8?: { sdk(): Y8Sdk; emitReadyEvent?: () => void };
  }
}

type PauseReason = 'ad' | 'hidden' | 'blur';

export class Y8Platform implements Platform {
  readonly name = 'y8';
  /** the SDK instance, set only once init() has been called on it */
  private y8Sdk: Y8Sdk | null = null;
  private adSystemReady = false;
  private playing = false;
  private startShown = false;
  private busy = false;
  private pausedBy = new Set<PauseReason>();
  private listening = false;

  constructor(
    private readonly hooks: AdHooks,
    private readonly appId = Y8_APP_ID,
    private readonly gameId = Y8_GAME_ID,
  ) {}

  /** The portal snippet; waits for `y8sdk.ready` at most `waitMs` (with an ad blocker it never comes). */
  async init(waitMs = Y8_READY_WAIT_MS): Promise<void> {
    if (!this.listening) {
      this.listening = true;
      try {
        document.addEventListener('visibilitychange', () => this.setPaused('hidden', document.hidden));
        window.addEventListener('blur', () => this.setPaused('blur', true));
        window.addEventListener('focus', () => this.setPaused('blur', false));
      } catch {
        /* no DOM */
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, waitMs);
      try {
        window.addEventListener(
          'y8sdk.ready',
          () => {
            this.initSdk();
            clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        // the SDK may have loaded before this listener: ask it to announce itself again
        if (window.y8 && typeof window.y8.emitReadyEvent === 'function') window.y8.emitReadyEvent();
      } catch (err) {
        console.warn('[Y8] init failed, playing without ads', err);
        clearTimeout(timer);
        resolve();
      }
    });
  }

  private initSdk(): void {
    if (this.y8Sdk) return;
    try {
      const y8Sdk = window.y8!.sdk();
      const appConfig: Y8AppConfig = { appId: this.appId, autoLogin: true };
      const adConfig: Y8AdConfig = { gameId: this.gameId, preloadAdBreaks: 'on', sound: 'on', onReady: () => (this.adSystemReady = true) };
      y8Sdk.init(appConfig, adConfig);
      // guest play needs nothing: a signed-in player is only recognised
      y8Sdk.onAuth((_user, error) => {
        if (error) console.info('[Y8] playing as a guest', error);
      });
      this.y8Sdk = y8Sdk;
    } catch (err) {
      console.warn('[Y8] SDK init failed, playing without ads', err);
    }
  }

  /** the SDK is initialized (it is not with an ad blocker) */
  get initialized(): boolean {
    return this.y8Sdk !== null;
  }
  /** the ad system reported ready (adConfig.onReady) */
  get ready(): boolean {
    return this.adSystemReady;
  }

  /** ad, hidden page or lost focus: the game pauses and is silent while any of them holds */
  setPaused(reason: PauseReason, on: boolean): void {
    if (on === this.pausedBy.has(reason)) return;
    const was = this.pausedBy.size > 0;
    if (on) this.pausedBy.add(reason);
    else this.pausedBy.delete(reason);
    const now = this.pausedBy.size > 0;
    if (now === was) return;
    try {
      this.hooks.onAdPause(now);
    } catch (err) {
      console.warn('[Y8] onAdPause failed', err);
    }
  }

  /** One showAd() call, settled exactly once. Resolves true only for a reward break whose ad was viewed. */
  private showAd(type: Y8AdType, name: string): Promise<boolean> {
    const sdk = this.y8Sdk;
    if (!sdk || this.busy || (type !== 'reward' && this.playing)) return Promise.resolve(false);
    this.busy = true;
    return new Promise<boolean>((resolve) => {
      let done = false;
      let started = false;
      let viewed = false;
      const settle = () => {
        if (done) return;
        done = true;
        clearTimeout(startTimer);
        clearTimeout(capTimer);
        this.busy = false;
        this.setPaused('ad', false);
        resolve(type === 'reward' && viewed);
      };
      const startTimer = setTimeout(() => {
        if (!started) settle();
      }, AD_START_TIMEOUT_MS);
      const capTimer = setTimeout(settle, AD_MAX_MS);
      const opts: Y8ShowAdOptions = {
        type,
        name,
        beforeAd: () => {
          if (done) return;
          started = true;
          this.setPaused('ad', true);
        },
        afterAd: () => this.setPaused('ad', false),
        adBreakDone: () => settle(),
      };
      if (type === 'reward') {
        opts.beforeReward = (showAdFn) => {
          if (done) return;
          started = true;
          try {
            showAdFn();
          } catch {
            settle();
          }
        };
        opts.adViewed = () => {
          if (!done) viewed = true;
        };
        opts.adDismissed = () => {
          /* closed before the end: no reward */
        };
      }
      try {
        const r = sdk.showAd(opts);
        if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch(() => settle());
      } catch (err) {
        console.warn('[Y8] showAd threw', err);
        settle();
      }
    });
  }

  /** 'start' on the first Play click of the session. */
  async preroll(): Promise<void> {
    if (!this.y8Sdk || this.startShown) return;
    this.startShown = true;
    await this.showAd('start', 'start-game');
  }

  /** 'next' on a result screen's Next / Retry / Menu; the SDK alone paces them. */
  async midgame(): Promise<void> {
    await this.showAd('next', 'next-level');
  }

  /** Rewarded: true only after adViewed. */
  async rewarded(): Promise<boolean> {
    return this.showAd('reward', 'reward');
  }

  /** Rewarded buttons are hidden when the SDK is not there (ad blocker) or did not initialize. */
  adsUnavailable(): AdsUnavailable {
    return this.y8Sdk ? null : 'disabled';
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
