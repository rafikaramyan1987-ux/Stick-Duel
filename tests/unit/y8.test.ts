import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_MAX_MS, AD_START_TIMEOUT_MS, Y8_APP_ID, Y8_GAME_ID, Y8Platform, type Y8ShowAdOptions } from '../../src/platform/y8';

type Handler = () => void;
type Behave = (o: Y8ShowAdOptions) => Promise<unknown> | unknown;

/** minimal window / document with event listeners, a `y8` global and a recordable showAd */
function env(behave: Behave = () => new Promise(() => {}), opts: { sdk?: boolean; loadedEarly?: boolean } = {}) {
  const on: Record<string, { fn: Handler; once?: boolean }[]> = {};
  const target = () => ({
    addEventListener: (t: string, fn: Handler, o?: { once?: boolean }) => (on[t] ??= []).push({ fn, once: o?.once }),
  });
  const fire = (t: string) => {
    const hs = on[t] ?? [];
    on[t] = hs.filter((h) => !h.once);
    hs.forEach((h) => h.fn());
  };
  const calls: string[] = [];
  const sdk = {
    init: vi.fn((_app: unknown, ad: { onReady: () => void }) => {
      calls.push('init');
      ad.onReady();
    }),
    onAuth: vi.fn(),
    showAd: vi.fn((o: Y8ShowAdOptions) => {
      calls.push(`showAd:${o.type}`);
      return behave(o);
    }),
  };
  const win = {
    ...target(),
    y8: opts.sdk === false ? undefined : { sdk: () => sdk, emitReadyEvent: () => opts.loadedEarly && fire('y8sdk.ready') },
  };
  const doc = { ...target(), hidden: false };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  const log: string[] = [];
  const y8 = new Y8Platform({ onAdPause: (p) => log.push(p ? 'pause' : 'resume') });
  return { y8, sdk, calls, log, fire, doc };
}

async function ready(e: ReturnType<typeof env>) {
  const p = e.y8.init(1000);
  e.fire('y8sdk.ready');
  await p;
}

/** a break that plays the documented callbacks: beforeAd → (reward: adViewed / adDismissed) → afterAd → adBreakDone */
const plays =
  (result: 'viewed' | 'dismissed' = 'viewed'): Behave =>
  (o) =>
    new Promise<void>((res) => {
      const play = () => {
        o.beforeAd?.();
        setTimeout(() => {
          if (o.type === 'reward') (result === 'viewed' ? o.adViewed : o.adDismissed)?.();
          o.afterAd?.();
          o.adBreakDone?.({ breakStatus: result });
          res();
        }, 1000);
      };
      if (o.type === 'reward') o.beforeReward?.(play);
      else play();
    });

async function settled<T>(pr: Promise<T>): Promise<{ done: boolean; value?: T }> {
  let out: { done: boolean; value?: T } = { done: false };
  void pr.then((value) => (out = { done: true, value }));
  await vi.advanceTimersByTimeAsync(0);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Y8 SDK init', () => {
  it('portal snippet: y8sdk.ready → y8.sdk(), init({ appId, autoLogin }, { gameId, preloadAdBreaks, sound, onReady }), onAuth', async () => {
    const e = env();
    await ready(e);
    expect(Y8_APP_ID).toBe('6af4b1f4ca1c6869a74e0a2f');
    expect(Y8_GAME_ID).toBe('292551');
    expect(e.sdk.init).toHaveBeenCalledTimes(1);
    const [app, ad] = e.sdk.init.mock.calls[0]!;
    expect(app).toEqual({ appId: Y8_APP_ID, autoLogin: true });
    expect(ad).toMatchObject({ gameId: Y8_GAME_ID, preloadAdBreaks: 'on', sound: 'on' });
    expect(typeof (ad as { onReady: unknown }).onReady).toBe('function');
    expect(e.sdk.onAuth).toHaveBeenCalledTimes(1);
    expect(e.y8.initialized && e.y8.ready).toBe(true);
    expect(e.y8.adsUnavailable()).toBeNull();
    e.fire('y8sdk.ready'); // listener was { once: true }
    expect(e.sdk.init).toHaveBeenCalledTimes(1);
  });

  it('SDK loaded before the listener: emitReadyEvent() makes it announce itself', async () => {
    const e = env(undefined, { loadedEarly: true });
    await e.y8.init(1000);
    expect(e.calls).toEqual(['init']);
  });

  it('ad blocker (no SDK): init gives up after the wait, no ad call, rewarded hidden, game continues', async () => {
    const e = env(undefined, { sdk: false });
    const p = e.y8.init(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(e.y8.adsUnavailable()).toBe('disabled');
    await e.y8.preroll();
    await e.y8.midgame();
    await expect(e.y8.rewarded()).resolves.toBe(false);
    expect(e.calls).toEqual([]);
    expect(e.y8.storage()).toBeNull();
  });

  it('no ad call before init', async () => {
    const e = env();
    const p = e.y8.init(1000);
    await e.y8.preroll();
    await e.y8.midgame();
    expect(e.calls).toEqual([]);
    e.fire('y8sdk.ready');
    await p;
    expect(e.calls).toEqual(['init']);
  });
});

describe('Y8 interstitials', () => {
  it("'start' once on the first Play, 'next' at every break (no cap of our own); paused in beforeAd, resumed in afterAd", async () => {
    const e = env(plays());
    await ready(e);
    const a = e.y8.preroll();
    expect(e.log).toEqual(['pause']);
    await vi.advanceTimersByTimeAsync(1000);
    await a;
    expect(e.log).toEqual(['pause', 'resume']);
    await e.y8.preroll(); // second Play: nothing
    for (let i = 0; i < 3; i++) {
      const n = e.y8.midgame();
      await vi.advanceTimersByTimeAsync(1000);
      await n;
    }
    expect(e.calls).toEqual(['init', 'showAd:start', 'showAd:next', 'showAd:next', 'showAd:next']);
    const opts = e.sdk.showAd.mock.calls[1]![0];
    expect(opts.beforeReward).toBeUndefined();
  });

  it('no ad (adBreakDone only): continues at once, never paused', async () => {
    const e = env((o) => o.adBreakDone?.({ breakStatus: 'frequencyCapped' }));
    await ready(e);
    expect((await settled(e.y8.midgame())).done).toBe(true);
    expect(e.log).toEqual([]);
  });

  it('a rejected showAd() settles, the game resumes', async () => {
    const e = env((o) => {
      o.beforeAd?.();
      return Promise.reject(new Error('no fill'));
    });
    await ready(e);
    expect((await settled(e.y8.midgame())).done).toBe(true);
    expect(e.log).toEqual(['pause', 'resume']);
  });

  it('nothing happens at all: settles after 8 s; a started break that never ends after AD_MAX_MS', async () => {
    const e = env();
    await ready(e);
    const a = e.y8.midgame();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
    expect((await settled(a)).done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await settled(a)).done).toBe(true);

    const e2 = env((o) => {
      o.beforeAd?.();
      return new Promise(() => {});
    });
    await ready(e2);
    const b = e2.y8.midgame();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS);
    expect((await settled(b)).done).toBe(false);
    await vi.advanceTimersByTimeAsync(AD_MAX_MS);
    expect((await settled(b)).done).toBe(true);
    expect(e2.log).toEqual(['pause', 'resume']);
  });

  it('settles exactly once: adBreakDone + rejection + timeouts', async () => {
    const e = env((o) => {
      o.beforeAd?.();
      o.afterAd?.();
      o.adBreakDone?.({ breakStatus: 'viewed' });
      o.adBreakDone?.({ breakStatus: 'viewed' });
      return Promise.reject(new Error('late'));
    });
    await ready(e);
    await e.y8.midgame();
    await vi.advanceTimersByTimeAsync(AD_MAX_MS);
    expect(e.log).toEqual(['pause', 'resume']);
  });

  it('never during gameplay', async () => {
    const e = env(plays());
    await ready(e);
    e.y8.gameplayStart();
    await e.y8.midgame();
    expect(e.calls).toEqual(['init']);
  });
});

describe('Y8 rewarded', () => {
  it('beforeReward calls showAdFn; reward only after adViewed', async () => {
    const e = env(plays('viewed'));
    await ready(e);
    const r = e.y8.rewarded();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(r).resolves.toBe(true);
    expect(e.calls).toEqual(['init', 'showAd:reward']);
    expect(e.log).toEqual(['pause', 'resume']);
  });

  it('adDismissed: no reward', async () => {
    const e = env(plays('dismissed'));
    await ready(e);
    const r = e.y8.rewarded();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(r).resolves.toBe(false);
  });

  it('no ad (beforeReward never called): no reward, at once', async () => {
    const e = env((o) => o.adBreakDone?.({ breakStatus: 'noAdPreloaded' }));
    await ready(e);
    expect(await settled(e.y8.rewarded())).toEqual({ done: true, value: false });
  });
});

describe('Y8 focus / visibility', () => {
  it('pauses + mutes when hidden or blurred, resumes when both are back; nested with an ad', async () => {
    const e = env(plays());
    await ready(e);
    e.doc.hidden = true;
    e.fire('visibilitychange');
    e.fire('blur');
    expect(e.log).toEqual(['pause']);
    e.doc.hidden = false;
    e.fire('visibilitychange');
    expect(e.log).toEqual(['pause']);
    e.fire('focus');
    expect(e.log).toEqual(['pause', 'resume']);
    // during an ad the game stays paused until the ad and the blur are both over
    const a = e.y8.midgame();
    e.fire('blur');
    await vi.advanceTimersByTimeAsync(1000);
    await a;
    expect(e.log).toEqual(['pause', 'resume', 'pause']);
    e.fire('focus');
    expect(e.log).toEqual(['pause', 'resume', 'pause', 'resume']);
  });
});
