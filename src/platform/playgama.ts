import { SAVE_KEY } from '../game/progress';
import type { LangCode } from '../i18n';
import type { AdHooks, AdsUnavailable, Platform, StorageLike } from './ads';

/**
 * Playgama Bridge (https://github.com/Playgama/bridge) adapter. Only bundled in the `playgama` build
 * (VITE_PLATFORM=playgama, see vite.config.ts and main.ts): index.html loads Bridge from Playgama's CDN
 * (https://bridge.playgama.com/v2/stable/playgama-bridge.js) as its first script and initializes it before the game
 * bundle runs (scripts/playgama/boot.js); outside Playgama, Bridge runs its mock platform (no ads).
 * - init (awaited in main.ts before the save is read and the menu shows): `bridge.initialize()`'s outcome (initBridge;
 *   a failure is logged with console.error and the game plays on with no ads), then `platform.language` (the game falls back
 *   to English), the save through Bridge Storage (one `storage.get([...])` of every key, kept in memory; writes go to
 *   `storage.set`), `platform.isAudioEnabled`, and the AUDIO_STATE_CHANGED / PAUSE_STATE_CHANGED events
 * - `game_ready` once the boot screen is gone and the title menu takes input (`gameReady()`, from main.ts)
 * - the first gameplay start of a level → `level_started`; its result screen → `level_completed` / `level_failed`
 *   (Bridge has no gameplay start / stop)
 * - `game_ready` is always the first lifecycle message: gameplay messages sent before it are held (send)
 * - interstitials (`advertisement.showInterstitial()`) at every result-screen break between levels / rounds (app.ts
 *   breakThen), with no counter or timer of the game's own: how often one shows is Bridge's call,
 *   `minimumDelayBetweenInterstitial` in playgama-bridge-config.json; never during a level, no pre-roll
 * - rewarded (`advertisement.showRewarded()`) only from the labelled ad buttons; they are hidden (adsUnavailable)
 *   when Bridge is missing or `isRewardedSupported` is false. The reward is granted only when Bridge reports the
 *   `rewarded` state before `closed`; closed / failed without it: no reward (the button says no ad is available)
 * - every ad request settles exactly once (closed / failed, or not opened within AD_START_TIMEOUT_MS)
 * - an ad opening, Bridge's pause state and the page being hidden pause the game and mute all audio (AdHooks
 *   onAdPause); Bridge's audio state mutes without pausing (platformMuted). Audio comes back only when nothing keeps
 *   the game silent, and then through the player's own sound / music settings.
 */

/** every storage key the game uses (src/game/progress.ts SAVE_KEY), read in one `storage.get([...])` at startup */
export const PLAYGAMA_STORAGE_KEYS = [SAVE_KEY];

/**
 * Bridge after `bridge.initialize()`, or null when it failed (logged with console.error, never silent; the game then
 * plays on without the SDK). In the Playgama build index.html's boot script (scripts/playgama/boot.js) already called
 * initialize() and started the game only once it settled: its outcome is `window.__playgamaBridgeInit`. No timeout of
 * the game's own: Bridge settles the promise itself (Playgama: wait for initialization before anything else).
 */
export async function initBridge(): Promise<BridgeSdk | null> {
  if (typeof window === 'undefined') return null;
  const b = window.bridge;
  if (!b?.initialize) {
    console.error('[Playgama Bridge] window.bridge is missing: the game runs WITHOUT Playgama Bridge (no ads, no Bridge storage, no game_ready)');
    return null;
  }
  const booted = window.__playgamaBridgeInit;
  const err = booted
    ? await booted
    : await b.initialize().then(
        () => null,
        (e: unknown) => e ?? new Error('bridge.initialize() rejected'),
      );
  if (err) {
    // the boot script has logged it already
    if (!booted) console.error('[Playgama Bridge] bridge.initialize() failed; the game runs WITHOUT Playgama Bridge (no ads, no Bridge storage, no game_ready):', err);
    return null;
  }
  return b;
}
/** If the ad has not opened after this long, give up and continue (same as the other portals). */
export const AD_START_TIMEOUT_MS = 8000;

/** Languages the game has (type-checked against src/i18n). */
const GAME_LANGS: Record<LangCode, true> = { en: true, fr: true };

type Listener = (v: never) => void;
export interface BridgeSdk {
  initialize(): Promise<unknown>;
  EVENT_NAME: Record<'INTERSTITIAL_STATE_CHANGED' | 'REWARDED_STATE_CHANGED' | 'AUDIO_STATE_CHANGED' | 'PAUSE_STATE_CHANGED', string>;
  platform: {
    id: string;
    language: string;
    isAudioEnabled: boolean;
    sendMessage(message: string, options?: Record<string, unknown>): unknown;
    on(event: string, fn: Listener): void;
  };
  advertisement: {
    isInterstitialSupported: boolean;
    isRewardedSupported: boolean;
    showInterstitial(placement?: string): void;
    showRewarded(placement?: string): void;
    on(event: string, fn: Listener): void;
  };
  storage: {
    get(keys: string[]): Promise<unknown[]>;
    set(key: string, value: string): Promise<unknown>;
  };
}

declare global {
  interface Window {
    bridge?: BridgeSdk;
    /** the Playgama platform, for scripts/playgama/test.mjs */
    __playgama?: PlaygamaPlatform;
    /** set by the Playgama build's boot script: bridge.initialize()'s outcome (null = initialized, else the error) */
    __playgamaBridgeInit?: Promise<unknown>;
  }
}

type PauseReason = 'sdk' | 'hidden' | 'ad';
type AdType = 'interstitial' | 'rewarded';
interface Pending {
  type: AdType;
  opened: boolean;
  earned: boolean;
  finish: (ok: boolean) => void;
}

export class PlaygamaPlatform implements Platform {
  readonly name = 'playgama';
  private b: BridgeSdk | null = null;
  private playing = false;
  private levelOn = false;
  private readySent = false;
  /** gameplay messages waiting for game_ready (see send) */
  private held: string[] = [];
  private pausedBy = new Set<PauseReason>();
  /** last state given to AdHooks.onAdPause */
  paused = false;
  /** Bridge says the platform's audio is off (independent of pauses) */
  private soundOff = false;
  private muteListeners: Array<(muted: boolean) => void> = [];
  private lang: string | null = null;
  private store: StorageLike | null = null;
  private pending: Pending | null = null;
  /** what was sent to / received from Bridge (messages, ad states), for scripts/playgama/test.mjs */
  readonly log: string[] = [];

  constructor(private readonly hooks: AdHooks) {}

  async init(): Promise<void> {
    if (typeof window !== 'undefined') window.__playgama = this;
    this.b = await initBridge();
    const s = this.b;
    if (s) {
      try {
        this.lang = s.platform.language || null;
      } catch {
        this.lang = null;
      }
      await this.loadStore(s);
      try {
        const E = s.EVENT_NAME;
        this.soundOff = s.platform.isAudioEnabled === false;
        s.platform.on(E.AUDIO_STATE_CHANGED, ((on: boolean) => this.setSound(on !== false)) as Listener);
        s.platform.on(E.PAUSE_STATE_CHANGED, ((p: boolean) => this.setPaused('sdk', !!p)) as Listener);
        s.advertisement.on(E.INTERSTITIAL_STATE_CHANGED, ((st: string) => this.onAdState('interstitial', st)) as Listener);
        s.advertisement.on(E.REWARDED_STATE_CHANGED, ((st: string) => this.onAdState('rewarded', st)) as Listener);
      } catch {
        /* no events: play on */
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.setPaused('hidden', document.hidden === true));
      // Playgama 1.4.5: a long press on the game opens no context menu, callout or magnifier
      document.addEventListener('contextmenu', (e) => e.preventDefault());
      document.documentElement?.style?.setProperty('-webkit-touch-callout', 'none');
    }
  }

  /** every key in one `storage.get([...])`, kept in memory; writes go to Bridge Storage (its default storage type) */
  private async loadStore(s: BridgeSdk): Promise<void> {
    const mem = new Map<string, string>();
    try {
      const vals = await s.storage.get(PLAYGAMA_STORAGE_KEYS);
      PLAYGAMA_STORAGE_KEYS.forEach((k, i) => {
        const v = Array.isArray(vals) ? vals[i] : null;
        if (v !== null && v !== undefined) mem.set(k, typeof v === 'string' ? v : JSON.stringify(v));
      });
    } catch {
      /* nothing saved yet / storage unavailable: defaults */
    }
    this.store = {
      getItem: (k) => mem.get(k) ?? null,
      setItem: (k, v) => {
        if (mem.get(k) === v) return;
        mem.set(k, v);
        try {
          void Promise.resolve(s.storage.set(k, v)).catch(() => {});
        } catch {
          /* keep playing; the in-memory copy stays */
        }
      },
      removeItem: (k) => {
        mem.delete(k);
      },
    };
  }

  /** pause the game + mute; idempotent, reasons tracked separately */
  setPaused(reason: PauseReason, on: boolean): void {
    if (on === this.pausedBy.has(reason)) return;
    if (on) this.pausedBy.add(reason);
    else this.pausedBy.delete(reason);
    this.sync();
  }

  private sync(force = false): void {
    const p = this.pausedBy.size > 0;
    if (p === this.paused && !force) return;
    this.paused = p;
    try {
      this.hooks.onAdPause(p);
    } catch (err) {
      console.warn('[Playgama] onAdPause failed', err);
    }
  }

  /** Gives the current pause state to the game again (the game object did not exist before). */
  syncPause(): void {
    if (this.paused) this.sync(true);
  }

  /** the platform's audio state: off mutes (no pause), on restores only if nothing else keeps the game silent */
  setSound(on: boolean): void {
    if (this.soundOff === !on) return;
    this.soundOff = !on;
    for (const cb of this.muteListeners) cb(this.soundOff);
  }

  /** the game is muted for the platform: Bridge's audio state off, or paused (ad / Bridge pause / page hidden) */
  get muted(): boolean {
    return this.soundOff || this.paused;
  }

  private onAdState(type: AdType, state: string): void {
    this.log.push(`${type}:${state}`);
    const p = this.pending;
    if (!p || p.type !== type) return;
    if (state === 'opened') {
      p.opened = true;
      this.setPaused('ad', true);
    } else if (state === 'rewarded') p.earned = true;
    else if (state === 'closed') p.finish(type === 'rewarded' ? p.earned : true);
    else if (state === 'failed') p.finish(false);
  }

  /** Bridge's platform.language when the game has it, otherwise English (never the browser language) */
  locale(): string | null {
    const code = (this.lang ?? '').toLowerCase().slice(0, 2);
    return Object.prototype.hasOwnProperty.call(GAME_LANGS, code) ? code : 'en';
  }

  storage(): StorageLike | null {
    return this.store;
  }

  platformMuted(): boolean {
    return this.soundOff;
  }
  onPlatformMuteChange(cb: (muted: boolean) => void): void {
    this.muteListeners.push(cb);
  }

  loadingStart(): void {}
  loadingStop(): void {}

  /** the boot screen is gone and the title menu takes input: Bridge's `game_ready`, once */
  gameReady(): void {
    if (this.readySent || !this.b) return;
    this.readySent = true;
    this.send('game_ready');
    // gameplay messages from before game_ready follow it, in their order
    for (const m of this.held.splice(0)) this.send(m);
  }

  gameplayStart(): void {
    this.playing = true;
    if (this.levelOn) return;
    this.levelOn = true;
    this.send('level_started');
  }
  gameplayStop(): void {
    this.playing = false;
  }
  /** a level ended (result screen): the next gameplayStart is a new level */
  levelEnd(won: boolean): void {
    if (!this.levelOn) return;
    this.levelOn = false;
    this.send(won ? 'level_completed' : 'level_failed');
  }
  happytime(): void {}

  /**
   * Every Bridge message goes through here. Playgama: `game_ready` comes first, so any gameplay message (level_started,
   * level_completed, …) before it is held and sent right after it.
   */
  private send(m: string): void {
    if (!this.b) return;
    if (m !== 'game_ready' && !this.readySent) {
      this.held.push(m);
      return;
    }
    this.log.push(m);
    try {
      void Promise.resolve(this.b?.platform.sendMessage(m)).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  /** Show an ad and settle exactly once: closed / failed, or not opened within AD_START_TIMEOUT_MS. */
  private requestAd(type: AdType): Promise<boolean> {
    const s = this.b;
    if (!s || this.pending) return Promise.resolve(false);
    return new Promise<boolean>((res) => {
      let done = false;
      const pending: Pending = {
        type,
        opened: false,
        earned: false,
        finish: (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (this.pending === pending) this.pending = null;
          this.setPaused('ad', false);
          res(ok);
        },
      };
      this.pending = pending;
      const timer = setTimeout(() => {
        if (!pending.opened) pending.finish(false);
      }, AD_START_TIMEOUT_MS);
      try {
        if (type === 'rewarded') s.advertisement.showRewarded();
        else s.advertisement.showInterstitial();
      } catch {
        pending.finish(false);
      }
    });
  }

  /** No pre-roll on Playgama: Play on the title continues at once. */
  async preroll(): Promise<void> {}

  /** Interstitial between levels (app.ts calls it from the result-screen buttons only). Never during a level. */
  async midgame(): Promise<void> {
    if (this.playing || !this.b || this.pending) return;
    try {
      if (!this.b.advertisement.isInterstitialSupported) return;
    } catch {
      return;
    }
    await this.requestAd('interstitial');
  }

  /** Rewarded ad; true only when Bridge reported the `rewarded` state before the ad closed. */
  async rewarded(): Promise<boolean> {
    if (this.adsUnavailable()) return false;
    return this.requestAd('rewarded');
  }

  /** The rewarded buttons are hidden when Bridge is missing or has no rewarded ads (e.g. its mock platform). */
  adsUnavailable(): AdsUnavailable {
    try {
      return this.b && this.b.advertisement.isRewardedSupported === true ? null : 'disabled';
    } catch {
      return 'disabled';
    }
  }
}
