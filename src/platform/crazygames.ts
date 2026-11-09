import type { AdHooks, AdsUnavailable, Platform, StorageLike } from './ads';

/**
 * CrazyGames HTML5 SDK v3 adapter.
 * Docs: https://docs.crazygames.com/sdk/intro/ (game, video-ads, data, user modules)
 * The SDK script (https://sdk.crazygames.com/crazygames-sdk-v3.js) is only
 * injected into index.html for the `crazygames` build mode (see vite.config.ts).
 */
interface CGAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown) => void;
}
interface CGSDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  game: {
    loadingStart(): void;
    loadingStop(): void;
    gameplayStart(): void;
    gameplayStop(): void;
    happytime?(): void;
    settings?: { muteAudio?: boolean; disableChat?: boolean };
    addSettingsChangeListener?(cb: (s: { muteAudio?: boolean }) => void): void;
  };
  ad: {
    requestAd(type: 'midgame' | 'rewarded', callbacks: CGAdCallbacks): void;
    hasAdblock?(): Promise<boolean>;
  };
  data?: StorageLike;
  user?: { systemInfo?: { locale?: string } };
}

/** If adStarted has not been called after this long, the request is abandoned (the game continues). */
export const AD_START_TIMEOUT_MS = 8000;

/** adError gives an error code: adsDisabled, unfilled, adblock, adCooldown, other. */
export function adErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return String(error ?? '');
}
declare global {
  interface Window {
    CrazyGames?: { SDK: CGSDK };
  }
}

export class CrazyGamesPlatform implements Platform {
  readonly name = 'crazygames';
  private sdk: CGSDK | null = null;
  private adblock = false;
  private adsDisabled = false;
  private muted = false;
  private muteListeners: Array<(m: boolean) => void> = [];
  constructor(private readonly hooks: AdHooks) {}

  async init(): Promise<void> {
    const sdk = window.CrazyGames?.SDK;
    if (!sdk) return; // script blocked or not loaded: behave as no-op
    try {
      await sdk.init();
      if (sdk.environment === 'disabled') return;
      this.sdk = sdk;
      this.muted = sdk.game.settings?.muteAudio === true;
      sdk.game.addSettingsChangeListener?.((st) => {
        this.muted = st.muteAudio === true;
        for (const cb of this.muteListeners) cb(this.muted);
      });
      void sdk.ad
        .hasAdblock?.()
        .then((v) => (this.adblock = v === true))
        .catch(() => undefined);
    } catch (err) {
      console.warn('[CrazyGames] init failed', err);
    }
  }

  locale(): string | null {
    return this.sdk?.user?.systemInfo?.locale ?? null;
  }

  adsUnavailable(): AdsUnavailable {
    if (!this.sdk) return null;
    if (this.adsDisabled) return 'disabled';
    return this.adblock ? 'adblock' : null;
  }

  /** Progress is saved with the data module (synced to the CrazyGames account). */
  storage(): StorageLike | null {
    return this.sdk?.data ?? null;
  }

  platformMuted(): boolean {
    return this.muted;
  }

  onPlatformMuteChange(cb: (muted: boolean) => void): void {
    this.muteListeners.push(cb);
  }

  private safe(fn: (sdk: CGSDK) => void): void {
    if (!this.sdk) return;
    try {
      fn(this.sdk);
    } catch (err) {
      console.warn('[CrazyGames] call failed', err);
    }
  }

  loadingStart(): void { this.safe((s) => s.game.loadingStart()); }
  loadingStop(): void { this.safe((s) => s.game.loadingStop()); }
  gameplayStart(): void { this.safe((s) => s.game.gameplayStart()); }
  gameplayStop(): void { this.safe((s) => s.game.gameplayStop()); }
  happytime(): void { this.safe((s) => s.game.happytime?.()); }

  /**
   * Requests an ad and always settles exactly once:
   * - adFinished → true (reward granted for rewarded ads)
   * - adError, requestAd throwing, or adStarted not called within AD_START_TIMEOUT_MS → false
   * Callbacks arriving after it settled are ignored. onAdPause(false) is called on every exit.
   */
  private request(type: 'midgame' | 'rewarded'): Promise<boolean> {
    const sdk = this.sdk;
    if (!sdk) return Promise.resolve(type === 'midgame');
    return new Promise((resolve) => {
      let settled = false;
      let started = false;
      const finish = (ok: boolean, why: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (!ok) console.info(`[CrazyGames] ${type} ad not shown: ${why}`);
        try {
          this.hooks.onAdPause(false);
        } catch (err) {
          console.warn('[CrazyGames] onAdPause failed', err);
        }
        resolve(ok);
      };
      // if the ad never starts (no fill, blocked, slow network), give up and continue
      const timer = setTimeout(() => {
        if (!started) finish(false, 'timeout');
      }, AD_START_TIMEOUT_MS);
      try {
        sdk.ad.requestAd(type, {
          adStarted: () => {
            if (settled || started) return;
            started = true;
            clearTimeout(timer);
            try {
              this.hooks.onAdPause(true);
            } catch (err) {
              console.warn('[CrazyGames] onAdPause failed', err);
            }
          },
          adFinished: () => finish(true, 'finished'),
          adError: (error) => {
            const code = adErrorCode(error);
            if (code === 'adblock') this.adblock = true;
            if (code === 'adsDisabled') this.adsDisabled = true;
            finish(false, code || 'error');
          },
        });
      } catch (err) {
        console.warn('[CrazyGames] requestAd threw', err);
        finish(false, 'exception');
      }
    });
  }

  /** CrazyGames runs its own pre-roll: none from the game. */
  async preroll(): Promise<void> {}

  async midgame(): Promise<void> {
    await this.request('midgame');
  }

  rewarded(): Promise<boolean> {
    return this.request('rewarded');
  }
}
