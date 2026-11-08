import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_START_TIMEOUT_MS, CrazyGamesPlatform, adErrorCode } from '../../src/platform/crazygames';
import { NoopPlatform } from '../../src/platform/ads';
import { readJSON, setStorageBackend, writeJSON } from '../../src/platform/storage';
import { GameplayTracker, MidgameThrottle } from '../../src/platform/ads';

type Callbacks = { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void };

type AdBehaviour = 'finish' | { code: string } | 'throw' | 'never' | 'stuck' | ((cb: Callbacks) => void);
function fakeSdk(opts: { adResult?: AdBehaviour; adblock?: boolean; muteAudio?: boolean } = {}) {
  const calls: string[] = [];
  const data = new Map<string, string>();
  let settingsCb: ((s: { muteAudio?: boolean }) => void) | null = null;
  const sdk = {
    environment: 'crazygames' as const,
    init: async () => void calls.push('init'),
    game: {
      loadingStart: () => calls.push('loadingStart'),
      loadingStop: () => calls.push('loadingStop'),
      gameplayStart: () => calls.push('gameplayStart'),
      gameplayStop: () => calls.push('gameplayStop'),
      happytime: () => calls.push('happytime'),
      settings: { muteAudio: opts.muteAudio ?? false },
      addSettingsChangeListener: (cb: (s: { muteAudio?: boolean }) => void) => (settingsCb = cb),
    },
    ad: {
      requestAd: (type: string, cb: Callbacks) => {
        calls.push(`ad:${type}`);
        const r = opts.adResult;
        if (typeof r === 'function') return r(cb);
        if (r === 'throw') throw new Error('sdk exploded');
        if (r === 'never') return; // no callback at all
        if (r === 'stuck') return void cb.adStarted?.(); // starts, never ends
        if (r === 'finish') {
          cb.adStarted?.();
          cb.adFinished?.();
        } else cb.adError?.(r ?? { code: 'unfilled' });
      },
      hasAdblock: async () => opts.adblock ?? false,
    },
    data: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) },
    user: { systemInfo: { locale: 'fr-FR' } },
  };
  (globalThis as unknown as { window: unknown }).window = { CrazyGames: { SDK: sdk } };
  return { sdk, calls, data, changeSettings: (s: { muteAudio?: boolean }) => settingsCb?.(s) };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  setStorageBackend(null);
});

describe('CrazyGames SDK v3 adapter', () => {
  it('forwards loading / gameplay / happytime events', async () => {
    const { calls } = fakeSdk();
    const p = new CrazyGamesPlatform({ onAdPause: () => {} });
    await p.init();
    p.loadingStart();
    p.loadingStop();
    p.gameplayStart();
    p.gameplayStop();
    p.happytime();
    expect(calls).toEqual(['init', 'loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop', 'happytime']);
  });
  it('rewarded: reward only on adFinished; audio muted only while the ad plays', async () => {
    const hooks: string[] = [];
    fakeSdk({ adResult: 'finish' });
    const p = new CrazyGamesPlatform({ onAdPause: (p) => hooks.push(p ? 'mute' : 'unmute') });
    await p.init();
    expect(await p.rewarded()).toBe(true);
    expect(hooks).toEqual(['mute', 'unmute']);
  });
  it('adError: no reward; adblock / adsDisabled hide the video offers', async () => {
    for (const [code, state] of [['adblock', 'adblock'], ['adsDisabled', 'disabled'], ['unfilled', null]] as const) {
      const hooks: string[] = [];
      fakeSdk({ adResult: { code } });
      const p = new CrazyGamesPlatform({ onAdPause: (p) => hooks.push(p ? 'mute' : 'unmute') });
      await p.init();
      expect(await p.rewarded()).toBe(false);
      expect(hooks).toEqual(['unmute']); // never muted, but always released
      expect(p.adsUnavailable()).toBe(state);
      await p.midgame(); // always resolves, the game continues
    }
  });
  it('detects an ad blocker at start', async () => {
    fakeSdk({ adblock: true });
    const p = new CrazyGamesPlatform({ onAdPause: () => {} });
    await p.init();
    await Promise.resolve();
    await Promise.resolve();
    expect(p.adsUnavailable()).toBe('adblock');
  });
  it('muteAudio setting, data module and locale', async () => {
    const f = fakeSdk({ muteAudio: true });
    const p = new CrazyGamesPlatform({ onAdPause: () => {} });
    await p.init();
    expect(p.platformMuted()).toBe(true);
    const seen: boolean[] = [];
    p.onPlatformMuteChange((m) => seen.push(m));
    f.changeSettings({ muteAudio: false });
    expect(seen).toEqual([false]);
    expect(p.locale()).toBe('fr-FR');
    // progress goes through the data module
    setStorageBackend(p.storage());
    writeJSON('k', { a: 1 });
    expect(f.data.get('k')).toBe('{"a":1}');
    expect(readJSON('k', null)).toEqual({ a: 1 });
  });
  it('without the SDK (GitHub Pages / blocked script) everything is a no-op', async () => {
    (globalThis as unknown as { window: unknown }).window = {};
    const p = new CrazyGamesPlatform({ onAdPause: () => {} });
    await p.init();
    p.gameplayStart();
    expect(p.storage()).toBeNull();
    expect(p.adsUnavailable()).toBeNull();
    await expect(p.midgame()).resolves.toBeUndefined();
    const n = new NoopPlatform();
    expect(n.locale()).toBeNull();
    expect(n.platformMuted()).toBe(false);
  });
  it('reads adError codes', () => {
    expect(adErrorCode({ code: 'adblock' })).toBe('adblock');
    expect(adErrorCode('unfilled')).toBe('unfilled');
    expect(adErrorCode(undefined)).toBe('');
  });
});

describe('ads never hang', () => {
  afterEach(() => vi.useRealTimers());

  const make = async (adResult: AdBehaviour) => {
    vi.useFakeTimers();
    fakeSdk({ adResult });
    const hooks: boolean[] = [];
    const p = new CrazyGamesPlatform({ onAdPause: (x) => hooks.push(x) });
    await p.init();
    return { p, hooks };
  };
  const settled = <T>(promise: Promise<T>) => {
    const box: { done: boolean; value?: T } = { done: false };
    void promise.then((v) => {
      box.done = true;
      box.value = v;
    });
    return box;
  };

  it('requestAd throwing: resolves false at once, releases the pause', async () => {
    const { p, hooks } = await make('throw');
    expect(await p.rewarded()).toBe(false);
    await expect(p.midgame()).resolves.toBeUndefined();
    expect(hooks).toEqual([false, false]);
  });

  it('no adStarted within 8 s: gives up (false), the game continues', async () => {
    const { p, hooks } = await make('never');
    const r = settled(p.rewarded());
    const m = settled(p.midgame());
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
    expect(r.done).toBe(false);
    expect(m.done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(r).toEqual({ done: true, value: false });
    expect(m.done).toBe(true);
    expect(hooks).toEqual([false, false]);
  });

  it('settles exactly once: late or duplicate callbacks are ignored', async () => {
    let saved: Callbacks = {};
    const { p, hooks } = await make((cb) => {
      saved = cb;
    });
    const r = settled(p.rewarded());
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS + 10);
    expect(r).toEqual({ done: true, value: false });
    // the SDK wakes up afterwards: nothing changes, no extra pause/unpause
    saved.adStarted?.();
    saved.adFinished?.();
    saved.adError?.({ code: 'other' });
    await vi.advanceTimersByTimeAsync(10);
    expect(r.value).toBe(false);
    expect(hooks).toEqual([false]);
    // double finish on a normal ad: one result, one release
    const { p: p2, hooks: h2 } = await make((cb) => {
      cb.adStarted?.();
      cb.adFinished?.();
      cb.adFinished?.();
      cb.adError?.({ code: 'other' });
    });
    expect(await p2.rewarded()).toBe(true);
    expect(h2).toEqual([true, false]);
  });

  it('an ad that started is not cut off by the timeout', async () => {
    let saved: Callbacks = {};
    const { p, hooks } = await make((cb) => {
      saved = cb;
      cb.adStarted?.();
    });
    const r = settled(p.rewarded());
    await vi.advanceTimersByTimeAsync(30_000); // a long video
    expect(r.done).toBe(false);
    expect(hooks).toEqual([true]);
    saved.adFinished?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(r).toEqual({ done: true, value: true });
    expect(hooks).toEqual([true, false]);
  });
});

describe('ad pacing helpers', () => {
  it('midgame ads are throttled from session start', () => {
    let now = 0;
    const th = new MidgameThrottle(() => now, 120_000);
    expect(th.canShow()).toBe(false);
    now = 121_000;
    expect(th.canShow()).toBe(true);
    th.markShown();
    expect(th.canShow()).toBe(false);
  });
  it('gameplayStart/Stop are never duplicated', () => {
    const calls: string[] = [];
    const p = new NoopPlatform();
    p.gameplayStart = () => void calls.push('start');
    p.gameplayStop = () => void calls.push('stop');
    const tr = new GameplayTracker(p);
    tr.start();
    tr.start();
    tr.stop();
    tr.stop();
    tr.start();
    expect(calls).toEqual(['start', 'stop', 'start']);
  });
});
