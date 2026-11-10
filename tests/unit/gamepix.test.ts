import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_START_TIMEOUT_MS, GamePixPlatform, LOADED_TIMEOUT_MS, type GPXAdResult } from '../../src/platform/gamepix';

/**
 * GamePix SDK v3 adapter with a fake SDK. Ad behaviours follow the real SDK's local simulator:
 * 'pause' before the ad, 'resume' after it, then the promise resolves with { success }.
 */
type AdBehaviour = 'success' | 'fail' | 'throw' | 'reject' | 'never' | 'stuck' | 'noPauseSuccess';

function fakeSdk(opts: { ad?: AdBehaviour; reward?: AdBehaviour; lang?: string; loaded?: 'ok' | 'never' } = {}) {
  const calls: string[] = [];
  const handlers: Record<string, Array<() => void>> = { pause: [], resume: [], soundOff: [], soundOn: [] };
  const docListeners: Array<() => void> = [];
  const doc = {
    hidden: false,
    addEventListener: (name: string, fn: () => void) => {
      if (name === 'visibilitychange') docListeners.push(fn);
    },
    querySelector: () => null,
  };
  const emit = (name: 'pause' | 'resume' | 'soundOff' | 'soundOn') => handlers[name]!.forEach((fn) => fn());
  const run = (kind: string, b: AdBehaviour): Promise<GPXAdResult> => {
    calls.push(`ad:${kind}`);
    if (b === 'throw') throw new Error('sdk exploded');
    if (b === 'reject') return Promise.reject(new Error('nope'));
    if (b === 'never') return new Promise(() => undefined);
    if (b === 'noPauseSuccess') return Promise.resolve({ success: true });
    emit('pause');
    if (b === 'stuck') return new Promise(() => undefined); // paused, never answers
    return new Promise((r) =>
      setTimeout(() => {
        emit('resume');
        r(b === 'success' ? { success: true } : { success: false, message: 'No ad available' });
      }, 100),
    );
  };
  const sdk = {
    lifecycle: {
      loading: (n: number) => calls.push(`loading:${n}`),
      loaded: () => (calls.push('loaded'), opts.loaded === 'never' ? new Promise(() => undefined) : Promise.resolve({})),
      gameStart: () => calls.push('gameStart'),
    },
    events: { on: (name: string, fn: () => void) => handlers[name]!.push(fn) },
    ads: { interstitial: () => run('interstitial', opts.ad ?? 'success'), reward: () => run('reward', opts.reward ?? 'success') },
    happyMoment: (n: string) => calls.push(`happy:${n}`),
    sadMoment: (n: string) => calls.push(`sad:${n}`),
    lang: () => opts.lang ?? 'en',
  };
  (globalThis as unknown as { window: unknown }).window = { GamePix: sdk, document: doc };
  const setHidden = (h: boolean) => {
    doc.hidden = h;
    docListeners.forEach((fn) => fn());
  };
  return { sdk, calls, emit, setHidden };
}

async function ready(hooks: { onAdPause: (p: boolean) => void } = { onAdPause: () => {} }) {
  const p = new GamePixPlatform(hooks);
  await p.init();
  await p.loaded();
  return p;
}

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

describe('GamePix SDK v3 adapter', () => {
  it('lifecycle: integer, only-increasing loading, loaded(), gameStart once', async () => {
    const { calls } = fakeSdk();
    const p = new GamePixPlatform({ onAdPause: () => {} });
    await p.init();
    p.loadingProgress(0);
    p.loadingProgress(20.4);
    p.loadingProgress(10); // never goes back
    p.loadingProgress(20);
    await p.loaded();
    p.gameplayStart();
    p.gameplayStop();
    p.gameplayStart();
    expect(calls).toEqual(['loading:0', 'loading:20', 'loading:100', 'loaded', 'gameStart']);
  });

  it('loaded() never blocks the game', async () => {
    vi.useFakeTimers();
    fakeSdk({ loaded: 'never' });
    const p = new GamePixPlatform({ onAdPause: () => {} });
    await p.init();
    let done = false;
    void p.loaded().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(LOADED_TIMEOUT_MS + 1);
    expect(done).toBe(true);
    // not loaded: no ad is requested, the game continues
    expect(await p.rewarded()).toBe(false);
  });

  it('interstitial: pause + mute during the ad, resume after; always resolves', async () => {
    vi.useFakeTimers();
    const pauses: boolean[] = [];
    fakeSdk({ ad: 'success' });
    const p = await ready({ onAdPause: (v) => pauses.push(v) });
    const m = p.midgame();
    expect(pauses).toEqual([true]);
    await vi.advanceTimersByTimeAsync(200);
    await m;
    expect(pauses).toEqual([true, false]);
  });

  it('reward only when success === true', async () => {
    vi.useFakeTimers();
    for (const [b, want] of [['success', true], ['fail', false], ['reject', false], ['throw', false]] as const) {
      fakeSdk({ reward: b });
      const pauses: boolean[] = [];
      const p = await ready({ onAdPause: (v) => pauses.push(v) });
      const r = p.rewarded();
      await vi.advanceTimersByTimeAsync(200);
      expect(await r).toBe(want);
      expect(pauses.at(-1) ?? false).toBe(false); // never left paused
    }
  });

  it('nothing within 8 s: gives up (false); a late answer is ignored; one ad at a time', async () => {
    vi.useFakeTimers();
    const { calls } = fakeSdk({ reward: 'never' });
    const p = await ready();
    let res: boolean | null = null;
    void p.rewarded().then((v) => (res = v));
    expect(await p.rewarded()).toBe(false); // second request while the first is outstanding
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
    expect(res).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(res).toBe(false);
    expect(calls.filter((c) => c === 'ad:reward')).toHaveLength(1);
  });

  it('an ad that paused the game but never answers: started, so no timeout; still pauses', async () => {
    vi.useFakeTimers();
    const pauses: boolean[] = [];
    const { emit } = fakeSdk({ ad: 'stuck' });
    const p = await ready({ onAdPause: (v) => pauses.push(v) });
    let done = false;
    void p.midgame().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS * 2);
    expect(done).toBe(false);
    expect(pauses).toEqual([true]);
    emit('resume');
    expect(pauses).toEqual([true, false]);
  });

  it('pause / resume events and visibility are idempotent; window blur is not used', async () => {
    const pauses: boolean[] = [];
    const { emit, setHidden } = fakeSdk();
    await ready({ onAdPause: (v) => pauses.push(v) });
    emit('pause');
    emit('pause');
    emit('resume');
    emit('resume');
    expect(pauses).toEqual([true, false]);
    setHidden(true);
    setHidden(true);
    emit('resume'); // still hidden: stays paused
    expect(pauses).toEqual([true, false, true]);
    setHidden(false);
    expect(pauses).toEqual([true, false, true, false]);
  });

  it('moments after loaded(), happytime = boss_defeated, locale from GamePix.lang()', async () => {
    const { calls } = fakeSdk({ lang: 'fr' });
    const p = new GamePixPlatform({ onAdPause: () => {} });
    await p.init();
    p.sadMoment('game_over'); // before loaded(): not sent
    await p.loaded();
    p.happytime();
    p.happyMoment('level_complete');
    p.sadMoment('level_failed');
    expect(calls.filter((c) => /happy|sad/.test(c))).toEqual(['happy:boss_defeated', 'happy:level_complete', 'sad:level_failed']);
    expect(p.locale()).toBe('fr');
    fakeSdk({ lang: 'de' });
    expect((await ready()).locale()).toBe('de');
    fakeSdk({ lang: 'ja' });
    const q = await ready();
    expect(q.locale()).toBe('en'); // not translated: English
    expect(q.storage()).toBeNull();
    expect(q.platformMuted()).toBe(false);
    await q.preroll(); // no pre-roll on GamePix
  });

  it('without the SDK (script blocked): no ads, reward buttons hidden, nothing throws', async () => {
    (globalThis as unknown as { window: unknown }).window = { document: { hidden: false, addEventListener: () => {}, querySelector: () => null } };
    const p = new GamePixPlatform({ onAdPause: () => {} });
    await p.init();
    p.loadingProgress(50);
    await p.loaded();
    p.gameplayStart();
    p.happytime();
    await p.midgame();
    expect(await p.rewarded()).toBe(false);
    expect(p.adsUnavailable()).toBe('disabled');
    expect(p.locale()).toBeNull();
  });

  it('soundOff / soundOn (events): idempotent, independent of pause, overlapping with an ad', async () => {
    const { emit } = fakeSdk({ ad: 'success' });
    const pauses: boolean[] = [];
    const p = await ready({ onAdPause: (x) => pauses.push(x) });
    const mutes: boolean[] = [];
    p.onPlatformMuteChange((m) => mutes.push(m));
    expect(p.platformMuted()).toBe(false);
    emit('soundOff');
    emit('soundOff');
    expect(p.platformMuted()).toBe(true);
    expect(mutes).toEqual([true]); // only one change for two calls
    // a pause (ad) while the sound is off: the game pauses, and stays muted after the resume
    vi.useFakeTimers();
    const ad = p.midgame();
    await vi.advanceTimersByTimeAsync(200);
    await ad;
    expect(pauses).toEqual([true, false]);
    expect(p.platformMuted()).toBe(true);
    // pause again, sound back on during the pause: unmute is reported, the pause still holds
    emit('pause');
    emit('soundOn');
    emit('soundOn');
    expect(mutes).toEqual([true, false]);
    expect(pauses.at(-1)).toBe(true);
    emit('resume');
    expect(pauses.at(-1)).toBe(false);
    expect(p.platformMuted()).toBe(false);
  });

  it('legacy GamePix.soundOff() / GamePix.soundOn() callbacks work too', async () => {
    const { sdk } = fakeSdk();
    const p = await ready();
    const legacy = sdk as unknown as { soundOff?: () => void; soundOn?: () => void };
    expect(typeof legacy.soundOff).toBe('function');
    legacy.soundOff!();
    expect(p.platformMuted()).toBe(true);
    legacy.soundOff!();
    legacy.soundOn!();
    expect(p.platformMuted()).toBe(false);
  });

  it('overlapping pause sources: SDK pause and hidden page; the game resumes only when both are over', async () => {
    const { emit, setHidden } = fakeSdk();
    const pauses: boolean[] = [];
    await ready({ onAdPause: (x) => pauses.push(x) });
    emit('pause');
    setHidden(true);
    emit('pause');
    emit('resume'); // still hidden
    expect(pauses).toEqual([true]);
    setHidden(false);
    expect(pauses).toEqual([true, false]);
  });
});
