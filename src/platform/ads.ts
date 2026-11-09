/**
 * Platform adapter. The game only talks to this interface. The build-time flag
 * VITE_PLATFORM picks the implementation (see main.ts): crazygames.ts, gamedistribution.ts,
 * or NoopPlatform for the web build (GitHub Pages, local dev): no network, no ads.
 */
export interface Platform {
  readonly name: string;
  init(): Promise<void>;
  loadingStart(): void;
  loadingStop(): void;
  gameplayStart(): void;
  gameplayStop(): void;
  /** Pre-roll ad on the first Play click (GameDistribution); resolves when the game can continue. */
  preroll(): Promise<void>;
  /** Shows a midgame ad; resolves when the game can continue (always resolves). */
  midgame(): Promise<void>;
  /** Shows a rewarded ad; resolves true if the reward must be granted. */
  rewarded(): Promise<boolean>;
  /** Celebration moment (a boss beaten). */
  happytime(): void;
  /** Player locale from the platform (e.g. "fr-FR"), or null. */
  locale(): string | null;
  /** Why rewarded videos can't be offered right now ('adblock' / 'disabled'), or null when they can. */
  adsUnavailable(): AdsUnavailable;
  /** Platform save storage (CrazyGames data module), or null to use localStorage. */
  storage(): StorageLike | null;
  /** Platform audio setting (CrazyGames muteAudio); it wins over the in-game toggle. */
  platformMuted(): boolean;
  onPlatformMuteChange(cb: (muted: boolean) => void): void;
  /**
   * GamePix only (optional: the other portals do not implement these, and every call site is behind
   * `import.meta.env.VITE_PLATFORM === 'gamepix'`, so it is compiled out of the other builds):
   * loading progress 0..100, a promise that settles when the game can be shown, and moment signals.
   */
  loadingProgress?(percent: number): void;
  loaded?(): Promise<void>;
  happyMoment?(name: 'level_complete' | 'high_score' | 'boss_defeated'): void;
  sadMoment?(name: 'game_over' | 'level_failed'): void;
}

export type AdsUnavailable = 'adblock' | 'disabled' | null;

/** Same API as localStorage (the CrazyGames data module mirrors it). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AdHooks {
  /**
   * true right before an ad plays (mute audio, pause the game); false on every exit
   * (finished, error, requestAd threw, or the ad never started) — always called once at the end.
   */
  onAdPause(paused: boolean): void;
}

export class NoopPlatform implements Platform {
  readonly name = 'none';
  async init(): Promise<void> {}
  loadingStart(): void {}
  loadingStop(): void {}
  gameplayStart(): void {}
  gameplayStop(): void {}
  async preroll(): Promise<void> {}
  async midgame(): Promise<void> {}
  /** No ads outside CrazyGames: the reward is granted directly so the feature can be tested. */
  async rewarded(): Promise<boolean> {
    return true;
  }
  happytime(): void {}
  locale(): string | null {
    return null;
  }
  adsUnavailable(): AdsUnavailable {
    return null;
  }
  storage(): StorageLike | null {
    return null;
  }
  platformMuted(): boolean {
    return false;
  }
  onPlatformMuteChange(): void {}
}

export const MIDGAME_INTERVAL_MS = 2 * 60 * 1000;

/** Enforces "at most one midgame ad every 2 minutes" (CrazyGames also enforces its own cooldown). */
export class MidgameThrottle {
  private last: number;
  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly interval = MIDGAME_INTERVAL_MS,
  ) {
    // Count from session start so the very first levels never start with an ad.
    this.last = now();
  }
  canShow(): boolean {
    return this.now() - this.last >= this.interval;
  }
  markShown(): void {
    this.last = this.now();
  }
}

/** Keeps gameplayStart/gameplayStop balanced (CrazyGames requires no duplicates). */
export class GameplayTracker {
  private playing = false;
  constructor(private readonly platform: Platform) {}
  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.platform.gameplayStart();
  }
  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    this.platform.gameplayStop();
  }
  get isPlaying(): boolean {
    return this.playing;
  }
}

