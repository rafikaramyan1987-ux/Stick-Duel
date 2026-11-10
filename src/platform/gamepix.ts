import type { LangCode } from '../i18n';
import type { AdHooks, AdsUnavailable, Platform, StorageLike } from './ads';

/**
 * GamePix JS SDK v3 adapter. Only bundled in the `gamepix` build (VITE_PLATFORM=gamepix, see
 * vite.config.ts and main.ts). index.html loads the SDK from GAMEPIX_SDK_URL in <head>, before the
 * game bundle, with `window.GamePixConfig = { lifecycle: 'manual' }`.
 *
 * - Lifecycle: loadingProgress() → GamePix.lifecycle.loading(0..100, integer, only increasing),
 *   loaded() → await GamePix.lifecycle.loaded() before the menu is shown, the first
 *   gameplayStart() → GamePix.lifecycle.gameStart() (sent once).
 * - GamePix.events 'pause' / 'resume' and document visibilitychange (hidden / visible) pause the
 *   game and mute all audio through AdHooks.onAdPause; both are idempotent. Window blur is ignored.
 * - GamePix.events 'soundOff' / 'soundOn' mute / unmute (platformMuted()). The same four handlers
 *   are also assigned to the legacy properties GamePix.soundOff / soundOn / pause / resume (the
 *   GamePix player checks that they are declared), before loaded(). Every handler is idempotent, so
 *   the event and the property both firing for one change (in any order) count once.
 * - Ads only after loaded() completed, one at a time: interstitial → midgame(), reward → rewarded()
 *   (true only when the SDK answers { success: true }). Every request settles exactly once, and is
 *   abandoned (game continues, no reward) if nothing happened within AD_START_TIMEOUT_MS.
 * - happyMoment / sadMoment signals after loaded(). Saves stay in plain localStorage (the SDK syncs
 *   it); the locale is GamePix.lang(), read once in init() (before loaded()) and cached, English
 *   when the game does not have that language. A language picked in Settings wins.
 */
export const GAMEPIX_SDK_URL = 'https://integration.gamepix.com/sdk/v3/gamepix.sdk.js';

/** If neither the ad started (SDK 'pause') nor the SDK answered after this long, give up and continue. */
export const AD_START_TIMEOUT_MS = 8000;
/** lifecycle.loaded() "never blocks"; if it still has not resolved after this long, show the game anyway. */
export const LOADED_TIMEOUT_MS = 10000;

export interface GPXAdResult {
  success: boolean;
  message?: string;
}
export interface GPXSDK {
  lifecycle: {
    loading(progress: number): void;
    loaded(): Promise<unknown>;
    gameStart(): void;
  };
  events: { on(name: 'pause' | 'resume' | 'soundOff' | 'soundOn', fn: () => void): void };
  /** Legacy SDK callbacks: the game defines them and the SDK / player calls them. */
  soundOff?: () => void;
  soundOn?: () => void;
  pause?: () => void;
  resume?: () => void;
  ads: {
    interstitial(): Promise<GPXAdResult>;
    reward(): Promise<GPXAdResult>;
  };
  happyMoment?(name: string): void;
  sadMoment?(name: string): void;
  lang?(): string;
}
declare global {
  interface Window {
    GamePix?: GPXSDK;
  }
}

type AdKind = 'interstitial' | 'reward';

/**
 * Languages the game has (type-checked against src/i18n DICTS). A type-only import, so this module
 * does not change the module order of the other builds.
 */
const GAME_LANGS: Record<LangCode, true> = { en: true, fr: true, de: true, it: true, es: true, pt: true, nl: true, pl: true, tr: true, ru: true };

export class GamePixPlatform implements Platform {
  readonly name = 'gamepix';
  private sdk: GPXSDK | null = null;
  private progress = -1;
  /** lifecycle.loaded() has completed: ads and moments may be sent. */
  private ready = false;
  private started = false;
  /** Paused by the SDK ('pause' … 'resume'). */
  private sdkPaused = false;
  /** The page is hidden (visibilitychange). */
  private hidden = false;
  /** Last state given to AdHooks.onAdPause. */
  private paused = false;
  /** An SDK ad promise is outstanding (never two ads at once). */
  private busy = false;
  /** The SDK asked for silence (soundOff … soundOn): independent of pause, the game stays muted. */
  private soundOff = false;
  private muteListeners: Array<(muted: boolean) => void> = [];
  /** The request being waited for: set to started when the SDK pauses the game for it. */
  private pending: { started: boolean } | null = null;
  /** GamePix.lang() as read once in init(), or null. */
  private sdkLang: string | null = null;

  constructor(private readonly hooks: AdHooks) {}

  async init(): Promise<void> {
    try {
      const doc = window.document;
      if (doc) {
        this.hidden = doc.hidden === true;
        doc.addEventListener('visibilitychange', () => {
          this.hidden = doc.hidden === true;
          this.sync();
        });
      }
    } catch (err) {
      console.warn('[GamePix] visibility listener failed', err);
    }
    this.restoreTouchScrolling();
    const sdk = window.GamePix;
    if (!sdk || !sdk.lifecycle || !sdk.ads || !sdk.events) {
      console.info('[GamePix] SDK not loaded: playing without ads');
      return;
    }
    this.sdk = sdk;
    // one handler per signal, shared by the events and the legacy properties; each is idempotent
    const pause = () => this.setSdkPaused(true);
    const resume = () => this.setSdkPaused(false);
    const soundOff = () => this.setSoundOff(true);
    const soundOn = () => this.setSoundOff(false);
    try {
      sdk.events.on('pause', pause);
      sdk.events.on('resume', resume);
    } catch (err) {
      console.warn('[GamePix] events.on failed', err);
    }
    try {
      sdk.events.on('soundOff', soundOff);
      sdk.events.on('soundOn', soundOn);
    } catch (err) {
      console.warn('[GamePix] sound events not supported', err);
    }
    // the legacy GamePix.soundOff / soundOn / pause / resume the player checks for, written out on
    // window.GamePix so the minified bundle keeps the literal names (checked in CI)
    try {
      window.GamePix!.soundOff = soundOff;
      window.GamePix!.soundOn = soundOn;
      window.GamePix!.pause = pause;
      window.GamePix!.resume = resume;
    } catch {
      /* read-only SDK object */
    }
    // GamePix.lang(): once, while booting (before loaded()); locale() returns the cached value
    try {
      const l = typeof window.GamePix!.lang === 'function' ? window.GamePix!.lang() : null;
      this.sdkLang = typeof l === 'string' && l ? l : null;
    } catch (err) {
      console.warn('[GamePix] lang() failed', err);
    }
  }

  /**
   * The SDK injects `* { touch-action: none }`, which stops touch scrolling in the menus that can
   * scroll (intro card on a landscape phone, shop, settings). `body *` (specificity 0,0,2) puts back
   * the browser default under <body> only: html/body keep `touch-action: none`, and the game's own
   * rules (#game none, .btn / .wbtn manipulation) still win, exactly as in the other builds.
   */
  private restoreTouchScrolling(): void {
    try {
      const doc = window.document;
      if (!doc?.head || doc.getElementById('gpx-touch')) return;
      const style = doc.createElement('style');
      style.id = 'gpx-touch';
      style.textContent = 'body *{touch-action:auto}';
      doc.head.appendChild(style);
    } catch {
      /* cosmetic */
    }
  }

  /** Idempotent: a repeated 'pause' / 'resume' (event + legacy property) changes nothing. */
  private setSdkPaused(paused: boolean): void {
    if (paused && this.pending) this.pending.started = true;
    if (paused === this.sdkPaused) return;
    this.sdkPaused = paused;
    this.sync();
  }

  /** Pauses + mutes while the SDK holds the game or the page is hidden; resumes otherwise. Idempotent. */
  private sync(force = false): void {
    const want = this.sdkPaused || this.hidden;
    if (want === this.paused && !force) return;
    this.paused = want;
    try {
      this.hooks.onAdPause(want);
    } catch (err) {
      console.warn('[GamePix] onAdPause failed', err);
    }
  }

  /** Gives the current pause state to the game again (the game object did not exist before). */
  syncPause(): void {
    if (this.paused) this.sync(true);
  }

  private safe(fn: (sdk: GPXSDK) => void): void {
    if (!this.sdk) return;
    try {
      fn(this.sdk);
    } catch (err) {
      console.warn('[GamePix] call failed', err);
    }
  }

  loadingProgress(percent: number): void {
    const n = Math.max(0, Math.min(100, Math.round(percent)));
    if (n <= this.progress) return; // integer, only increasing
    this.progress = n;
    this.safe((s) => s.lifecycle.loading(n));
    try {
      // the boot screen bar shows the real progress
      const bar = window.document?.querySelector<HTMLElement>('.bootbar i');
      if (bar) {
        bar.style.animation = 'none';
        bar.style.width = `${n}%`;
      }
    } catch {
      /* cosmetic */
    }
  }

  /** await GamePix.lifecycle.loaded(): resolves even without a Player; never blocks the game. */
  async loaded(): Promise<void> {
    this.loadingProgress(100);
    const sdk = this.sdk;
    if (!sdk) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const done = Promise.resolve(sdk.lifecycle.loaded()).then(() => {
        this.ready = true;
      });
      await Promise.race([done, new Promise<void>((r) => (timer = setTimeout(r, LOADED_TIMEOUT_MS)))]);
    } catch (err) {
      console.warn('[GamePix] lifecycle.loaded failed', err);
    } finally {
      clearTimeout(timer);
    }
  }

  loadingStart(): void {}
  loadingStop(): void {}

  /** The first real gameplay (first fight) sends lifecycle.gameStart() once. */
  gameplayStart(): void {
    if (this.started || !this.sdk) return;
    this.started = true;
    this.safe((s) => s.lifecycle.gameStart());
  }
  gameplayStop(): void {}

  /**
   * Requests an ad and always settles exactly once:
   * - true only when the SDK answers { success: true }
   * - { success: false }, rejection, a throw, no SDK, not loaded yet, another ad in progress, or
   *   neither 'pause' nor an answer within AD_START_TIMEOUT_MS → false. A late answer is ignored.
   * The game is never left paused by the ad: on exit the SDK pause it caused is released.
   */
  private request(kind: AdKind): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk || !this.ready || this.busy) return Promise.resolve(false);
    this.busy = true;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const p = { started: false };
      this.pending = p;
      const finish = (ok: boolean, why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.pending === p) this.pending = null;
        if (!ok) console.info(`[GamePix] ${kind} ad: no ${kind === 'reward' ? 'reward' : 'ad'} (${why})`);
        // the ad is over: if the SDK paused the game for it and did not resume, resume now
        if (p.started && this.sdkPaused) this.sdkPaused = false;
        this.sync();
        resolve(ok);
      };
      const timer = setTimeout(() => {
        if (!p.started) finish(false, 'timeout');
      }, AD_START_TIMEOUT_MS);
      let r: Promise<GPXAdResult>;
      try {
        r = kind === 'reward' ? sdk.ads.reward() : sdk.ads.interstitial();
      } catch (err) {
        console.warn('[GamePix] ad call threw', err);
        this.busy = false;
        finish(false, 'exception');
        return;
      }
      Promise.resolve(r)
        .then(
          (res) => finish(res?.success === true, res?.message ?? 'success: false'),
          (err: unknown) => finish(false, `rejected (${String((err as { message?: unknown })?.message ?? err)})`),
        )
        .finally(() => {
          this.busy = false;
        });
    });
  }

  /** GamePix has no pre-roll. */
  async preroll(): Promise<void> {}

  async midgame(): Promise<void> {
    await this.request('interstitial');
  }

  rewarded(): Promise<boolean> {
    return this.request('reward');
  }

  happytime(): void {
    this.happyMoment('boss_defeated');
  }

  happyMoment(name: 'level_complete' | 'high_score' | 'boss_defeated'): void {
    if (this.ready) this.safe((s) => s.happyMoment?.(name));
  }

  sadMoment(name: 'game_over' | 'level_failed'): void {
    if (this.ready) this.safe((s) => s.sadMoment?.(name));
  }

  /**
   * GamePix.lang() ('en', 'fr', 'de', …) as read once in init(); a language the game does not have
   * falls back to English.
   */
  locale(): string | null {
    if (!this.sdk) return null;
    const code = this.sdkLang ? this.sdkLang.toLowerCase().slice(0, 2) : '';
    return Object.prototype.hasOwnProperty.call(GAME_LANGS, code) ? code : 'en';
  }

  /** Rewarded buttons are hidden when the SDK could not be loaded. */
  adsUnavailable(): AdsUnavailable {
    return this.sdk ? null : 'disabled';
  }

  /** Plain localStorage (synchronised by the SDK), with the in-memory fallback of storage.ts. */
  storage(): StorageLike | null {
    return null;
  }
  /** Idempotent: repeated soundOff / soundOn calls change nothing. */
  private setSoundOff(off: boolean): void {
    if (this.soundOff === off) return;
    this.soundOff = off;
    for (const cb of this.muteListeners) {
      try {
        cb(off);
      } catch (err) {
        console.warn('[GamePix] mute listener failed', err);
      }
    }
  }

  /** Muted by the GamePix sound setting (pauses and ads mute through onAdPause on top of this). */
  platformMuted(): boolean {
    return this.soundOff;
  }
  onPlatformMuteChange(cb: (muted: boolean) => void): void {
    this.muteListeners.push(cb);
  }
}
