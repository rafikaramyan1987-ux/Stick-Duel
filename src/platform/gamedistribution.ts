import type { AdHooks, AdsUnavailable, Platform, StorageLike } from './ads';

/**
 * GameDistribution HTML5 SDK adapter.
 * Docs: https://github.com/GameDistribution/GD-HTML5/wiki/SDK-Implementation
 * Only bundled in the `gd` build (VITE_PLATFORM=gd, see vite.config.ts and main.ts).
 *
 * - window.GD_OPTIONS is set and main.min.js injected once (id "gamedistribution-jssdk")
 *   from init(), i.e. while the game boots — never from a click.
 * - SDK_GAME_PAUSE / SDK_GAME_START pause/mute and resume the game (AdHooks.onAdPause).
 * - Interstitials (gdsdk.showAd()) are only requested from menu/result buttons, rewarded
 *   ads (gdsdk.showAd('rewarded')) only grant after SDK_REWARDED_WATCH_COMPLETE.
 * - Every request settles exactly once (completion, rejection / AD_ERROR / AD_SDK_CANCELED,
 *   or nothing started within AD_START_TIMEOUT_MS). Saves use localStorage.
 */
export const GD_GAME_ID = 'f09f3bd24a744eefb2580b8c8f977edc';
export const GD_SDK_URL = 'https://html5.api.gamedistribution.com/main.min.js';
export const GD_SCRIPT_ID = 'gamedistribution-jssdk';

/** If nothing has started after this long, the request is abandoned (the game continues). */
export const AD_START_TIMEOUT_MS = 8000;
/**
 * After the SDK hands the game back (SDK_GAME_START) or showAd() resolves, wait this long for
 * a late SDK_REWARDED_WATCH_COMPLETE before deciding the rewarded ad was not completed.
 */
export const AD_END_GRACE_MS = 400;
/** If a request settled while the SDK still holds the game paused, resume anyway after this long. */
export const RESUME_FALLBACK_MS = 5000;

export interface GDEvent {
  name: string;
  message?: string;
  status?: string;
}
interface GDSDK {
  showAd(type?: string): Promise<unknown> | void;
}
export interface GDOptions {
  gameId: string;
  onEvent: (event: GDEvent) => void;
}
declare global {
  interface Window {
    GD_OPTIONS?: GDOptions;
    gdsdk?: GDSDK;
  }
}

/** Events meaning the ad is on screen (no more start timeout). */
const STARTED = new Set(['SDK_GAME_PAUSE', 'STARTED', 'AD_IMPRESSION', 'CONTENT_PAUSE_REQUESTED']);
/** Events meaning the request failed. */
const FAILED = new Set(['AD_ERROR', 'AD_SDK_CANCELED']);

type AdKind = 'interstitial' | 'rewarded';
interface Pending {
  kind: AdKind;
  started: boolean;
  completed: boolean;
  settle(ok: boolean, why: string): void;
  /** The SDK gave control back: settle soon with the completion state. */
  ended(): void;
}

export class GameDistributionPlatform implements Platform {
  readonly name = 'gamedistribution';
  private pending: Pending | null = null;
  /** true between SDK_GAME_PAUSE and SDK_GAME_START. */
  private sdkPaused = false;
  private failedToLoad = false;
  private adPausedByUs = false;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private prerollDone = false;

  constructor(
    private readonly hooks: AdHooks,
    private readonly gameId = GD_GAME_ID,
  ) {}

  async init(): Promise<void> {
    try {
      window.GD_OPTIONS = { gameId: this.gameId, onEvent: (e) => this.onEvent(e) };
      const doc = window.document;
      if (!doc || doc.getElementById(GD_SCRIPT_ID)) return;
      const s = doc.createElement('script');
      s.id = GD_SCRIPT_ID;
      s.src = GD_SDK_URL;
      s.async = true;
      s.onerror = () => {
        this.failedToLoad = true;
        console.info('[GD] SDK failed to load: playing without ads');
      };
      const first = doc.getElementsByTagName('script')[0];
      if (first?.parentNode) first.parentNode.insertBefore(s, first);
      else (doc.head ?? doc.body).appendChild(s);
    } catch (err) {
      this.failedToLoad = true;
      console.warn('[GD] init failed', err);
    }
  }

  /** SDK event bus (GD_OPTIONS.onEvent). Never throws. */
  onEvent(event: GDEvent): void {
    try {
      const name = event?.name ?? '';
      if (name === 'SDK_GAME_PAUSE') this.pauseGame();
      const p = this.pending;
      if (p) {
        if (STARTED.has(name)) p.started = true;
        if (name === 'SDK_REWARDED_WATCH_COMPLETE') {
          p.completed = true;
          if (p.kind === 'rewarded') p.settle(true, 'completed');
        }
        if (FAILED.has(name)) p.settle(false, name);
      }
      if (name === 'SDK_GAME_START') {
        this.resumeGame();
        this.pending?.ended();
      }
    } catch (err) {
      console.warn('[GD] onEvent failed', err);
    }
  }

  private callPause(paused: boolean): void {
    if (this.adPausedByUs === paused) return;
    this.adPausedByUs = paused;
    try {
      this.hooks.onAdPause(paused);
    } catch (err) {
      console.warn('[GD] onAdPause failed', err);
    }
  }

  private pauseGame(): void {
    this.sdkPaused = true;
    clearTimeout(this.resumeTimer);
    this.callPause(true);
  }

  private resumeGame(): void {
    this.sdkPaused = false;
    clearTimeout(this.resumeTimer);
    this.callPause(false);
  }

  private sdk(): GDSDK | null {
    const s = window.gdsdk;
    return s && typeof s.showAd === 'function' ? s : null;
  }

  /**
   * Requests an ad and always settles exactly once:
   * - rewarded: true as soon as SDK_REWARDED_WATCH_COMPLETE arrives (closed earlier → false);
   *   interstitial: true when it ended (SDK_GAME_START or showAd() resolved)
   * - rejection, AD_ERROR, AD_SDK_CANCELED, showAd throwing, no SDK, or nothing started within
   *   AD_START_TIMEOUT_MS → false. Anything arriving after it settled is ignored.
   * The game is resumed on every exit (right away, or on SDK_GAME_START if the SDK still holds it).
   */
  private request(kind: AdKind): Promise<boolean> {
    const sdk = this.sdk();
    if (!sdk) return Promise.resolve(false);
    if (this.pending) return Promise.resolve(false); // one ad at a time
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let endTimer: ReturnType<typeof setTimeout> | undefined;
      const p: Pending = {
        kind,
        started: false,
        completed: false,
        settle: (ok, why) => {
          if (settled) return;
          settled = true;
          clearTimeout(startTimer);
          clearTimeout(endTimer);
          if (this.pending === p) this.pending = null;
          if (!ok) console.info(`[GD] ${kind} ad not shown: ${why}`);
          if (this.sdkPaused) {
            // the ad overlay may still be up: SDK_GAME_START resumes; never stay paused forever
            clearTimeout(this.resumeTimer);
            this.resumeTimer = setTimeout(() => this.resumeGame(), RESUME_FALLBACK_MS);
          } else this.callPause(false);
          resolve(ok);
        },
        ended: () => {
          if (settled) return;
          if (kind === 'interstitial') return p.settle(true, 'finished');
          // rewarded: a late SDK_REWARDED_WATCH_COMPLETE still wins during the grace period
          clearTimeout(endTimer);
          endTimer = setTimeout(() => p.settle(false, 'closed before the end'), AD_END_GRACE_MS);
        },
      };
      this.pending = p;
      const startTimer = setTimeout(() => {
        if (!p.started) p.settle(false, 'timeout');
      }, AD_START_TIMEOUT_MS);
      try {
        const r = kind === 'rewarded' ? sdk.showAd('rewarded') : sdk.showAd();
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          (r as Promise<unknown>).then(
            () => p.ended(),
            (err: unknown) => p.settle(false, `rejected (${String((err as { message?: unknown })?.message ?? err)})`),
          );
        }
      } catch (err) {
        console.warn('[GD] showAd threw', err);
        p.settle(false, 'exception');
      }
    });
  }

  /** Pre-roll: one interstitial on the first Play click of the session. */
  async preroll(): Promise<void> {
    if (this.prerollDone) return;
    this.prerollDone = true;
    await this.request('interstitial');
  }

  async midgame(): Promise<void> {
    await this.request('interstitial');
  }

  async rewarded(): Promise<boolean> {
    return this.request('rewarded');
  }

  /** Rewarded buttons are hidden when the SDK could not be loaded. */
  adsUnavailable(): AdsUnavailable {
    return this.failedToLoad ? 'disabled' : null;
  }

  loadingStart(): void {}
  loadingStop(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
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
