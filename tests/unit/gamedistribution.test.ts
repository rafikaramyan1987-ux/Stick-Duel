import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AD_END_GRACE_MS,
  AD_START_TIMEOUT_MS,
  GD_GAME_ID,
  GD_SCRIPT_ID,
  GD_SDK_URL,
  GameDistributionPlatform,
  RESUME_FALLBACK_MS,
  type GDEvent,
} from '../../src/platform/gamedistribution';

interface FakeScript {
  id: string;
  src: string;
  async: boolean;
  onerror: (() => void) | null;
}

/** Minimal window + document: enough for the adapter to inject its script tag. */
function fakeWindow() {
  const scripts: FakeScript[] = [];
  const doc = {
    getElementById: (id: string) => scripts.find((s) => s.id === id) ?? null,
    createElement: () => ({ id: '', src: '', async: false, onerror: null }) as FakeScript,
    getElementsByTagName: () => [],
    head: { appendChild: (s: FakeScript) => scripts.push(s) },
  };
  const w: Record<string, unknown> = { document: doc };
  (globalThis as unknown as { window: unknown }).window = w;
  return { w, scripts };
}

type Show = (type?: string) => Promise<unknown> | void;

async function setup(show?: Show) {
  const env = fakeWindow();
  const pauses: boolean[] = [];
  const p = new GameDistributionPlatform({ onAdPause: (v) => pauses.push(v) });
  await p.init();
  const calls: Array<string | undefined> = [];
  if (show) {
    env.w.gdsdk = {
      showAd: (type?: string) => {
        calls.push(type);
        return show(type);
      },
    };
  }
  const emit = (name: string) => (env.w.GD_OPTIONS as { onEvent: (e: GDEvent) => void }).onEvent({ name, message: name, status: 'success' });
  return { ...env, p, pauses, calls, emit };
}

/** A promise we resolve / reject from the test (like gdsdk.showAd()). */
function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Settled state of a promise without awaiting it forever. */
async function state<T>(pr: Promise<T>): Promise<{ done: boolean; value?: T }> {
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
  delete (globalThis as { window?: unknown }).window;
});

describe('GameDistribution SDK loading', () => {
  it('sets GD_OPTIONS with the game id and injects main.min.js once', async () => {
    const { w, scripts, p } = await setup();
    expect((w.GD_OPTIONS as { gameId: string }).gameId).toBe(GD_GAME_ID);
    expect(GD_GAME_ID).toBe('f09f3bd24a744eefb2580b8c8f977edc');
    expect(typeof (w.GD_OPTIONS as { onEvent: unknown }).onEvent).toBe('function');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ id: GD_SCRIPT_ID, src: GD_SDK_URL, async: true });
    await p.init();
    expect(scripts).toHaveLength(1);
  });

  it('SDK failed to load: no ads, rewarded offers hidden, everything resolves', async () => {
    const { scripts, p } = await setup();
    expect(p.adsUnavailable()).toBeNull();
    scripts[0]!.onerror?.();
    expect(p.adsUnavailable()).toBe('disabled');
    await expect(p.midgame()).resolves.toBeUndefined();
    await expect(p.preroll()).resolves.toBeUndefined();
    await expect(p.rewarded()).resolves.toBe(false);
    expect(p.storage()).toBeNull(); // localStorage
    expect(p.platformMuted()).toBe(false);
  });

  it('no gdsdk yet: requests settle false right away', async () => {
    const { p, pauses } = await setup();
    await expect(p.rewarded()).resolves.toBe(false);
    expect(pauses).toEqual([]);
  });
});

describe('GameDistribution ads', () => {
  it('SDK_GAME_PAUSE pauses/mutes, SDK_GAME_START resumes (once each)', async () => {
    const { emit, pauses } = await setup(() => undefined);
    emit('SDK_GAME_PAUSE');
    emit('SDK_GAME_PAUSE');
    expect(pauses).toEqual([true]);
    emit('SDK_GAME_START');
    emit('SDK_GAME_START');
    expect(pauses).toEqual([true, false]);
  });

  it('rewarded completion: granted only after SDK_REWARDED_WATCH_COMPLETE, game resumes on SDK_GAME_START', async () => {
    const d = deferred();
    const { p, emit, pauses, calls } = await setup(() => d.promise);
    const r = p.rewarded();
    expect(calls).toEqual(['rewarded']);
    emit('SDK_GAME_PAUSE');
    expect(pauses).toEqual([true]);
    await vi.advanceTimersByTimeAsync(30_000); // a long video: no timeout once started
    expect((await state(r)).done).toBe(false);
    emit('SDK_REWARDED_WATCH_COMPLETE');
    expect(await state(r)).toEqual({ done: true, value: true });
    expect(pauses).toEqual([true]); // still covered by the ad
    emit('SDK_GAME_START');
    d.resolve();
    expect(pauses).toEqual([true, false]);
  });

  it('rewarded closed before the end: no reward', async () => {
    const d = deferred();
    const { p, emit, pauses } = await setup(() => d.promise);
    const r = p.rewarded();
    emit('SDK_GAME_PAUSE');
    emit('SDK_GAME_START');
    d.resolve();
    await vi.advanceTimersByTimeAsync(AD_END_GRACE_MS + 1);
    await expect(r).resolves.toBe(false);
    expect(pauses).toEqual([true, false]);
  });

  it('rewarded: a WATCH_COMPLETE arriving just after SDK_GAME_START still counts', async () => {
    const { p, emit } = await setup(() => new Promise(() => {}));
    const r = p.rewarded();
    emit('SDK_GAME_PAUSE');
    emit('SDK_GAME_START');
    await vi.advanceTimersByTimeAsync(AD_END_GRACE_MS / 2);
    emit('SDK_REWARDED_WATCH_COMPLETE');
    await expect(r).resolves.toBe(true);
  });

  it.each(['AD_ERROR', 'AD_SDK_CANCELED'])('%s settles false and resumes', async (name) => {
    const { p, emit, pauses } = await setup(() => new Promise(() => {}));
    const r = p.rewarded();
    emit(name);
    await expect(r).resolves.toBe(false);
    expect(pauses).toEqual([]); // never paused: nothing to resume
  });

  it('showAd rejection settles false', async () => {
    const { p } = await setup(() => Promise.reject(new Error('No ad')));
    await expect(p.rewarded()).resolves.toBe(false);
  });

  it('showAd throwing settles false', async () => {
    const { p } = await setup(() => {
      throw new Error('boom');
    });
    await expect(p.rewarded()).resolves.toBe(false);
  });

  it('nothing starts within 8 s: gives up, later callbacks ignored', async () => {
    const { p, emit, pauses } = await setup(() => new Promise(() => {}));
    const r = p.rewarded();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 100);
    expect((await state(r)).done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(await state(r)).toEqual({ done: true, value: false });
    // the ad shows up late: it is not rewarded, but the game still pauses and resumes with it
    emit('SDK_REWARDED_WATCH_COMPLETE');
    emit('SDK_GAME_PAUSE');
    emit('SDK_GAME_START');
    expect(pauses).toEqual([true, false]);
    await expect(r).resolves.toBe(false);
  });

  it('double callbacks are ignored: settles exactly once', async () => {
    const d = deferred();
    const { p, emit } = await setup(() => d.promise);
    const settled: boolean[] = [];
    const r = p.rewarded().then((v) => (settled.push(v), v));
    emit('SDK_GAME_PAUSE');
    emit('SDK_REWARDED_WATCH_COMPLETE');
    emit('SDK_REWARDED_WATCH_COMPLETE');
    emit('AD_ERROR');
    d.reject(new Error('late'));
    emit('SDK_GAME_START');
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS + AD_END_GRACE_MS + RESUME_FALLBACK_MS);
    await r;
    expect(settled).toEqual([true]);
    // the next request works normally
    const next = p.rewarded();
    emit('AD_ERROR');
    await expect(next).resolves.toBe(false);
  });

  it('one ad at a time: a second request while one is pending settles false', async () => {
    const { p, emit, calls } = await setup(() => new Promise(() => {}));
    const a = p.rewarded();
    await expect(p.rewarded()).resolves.toBe(false);
    expect(calls).toHaveLength(1);
    emit('SDK_REWARDED_WATCH_COMPLETE');
    await expect(a).resolves.toBe(true);
  });

  it('interstitial: showAd() without type, resolves when the SDK hands the game back', async () => {
    const d = deferred();
    const { p, emit, pauses, calls } = await setup(() => d.promise);
    const r = p.midgame();
    expect(calls).toEqual([undefined]);
    emit('SDK_GAME_PAUSE');
    expect((await state(r)).done).toBe(false);
    emit('SDK_GAME_START');
    expect((await state(r)).done).toBe(true);
    expect(pauses).toEqual([true, false]);
  });

  it('interstitial that never starts resumes after 8 s', async () => {
    const { p } = await setup(() => new Promise(() => {}));
    const r = p.midgame();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS + 1);
    expect((await state(r)).done).toBe(true);
  });

  it('pre-roll is requested once per session', async () => {
    const { p, calls } = await setup(() => Promise.resolve());
    await p.preroll();
    await p.preroll();
    expect(calls).toEqual([undefined]);
  });

  it('settled while the SDK still holds the game: resumes on SDK_GAME_START or after the fallback', async () => {
    const { p, emit, pauses } = await setup(() => new Promise(() => {}));
    const r = p.rewarded();
    emit('SDK_GAME_PAUSE');
    emit('AD_ERROR');
    await expect(r).resolves.toBe(false);
    expect(pauses).toEqual([true]);
    await vi.advanceTimersByTimeAsync(RESUME_FALLBACK_MS + 1); // SDK_GAME_START never came
    expect(pauses).toEqual([true, false]);
  });

  it('a throwing onAdPause hook never breaks the SDK callbacks', async () => {
    fakeWindow();
    const p = new GameDistributionPlatform({
      onAdPause: () => {
        throw new Error('hook');
      },
    });
    await p.init();
    const w = (globalThis as unknown as { window: Record<string, unknown> }).window;
    w.gdsdk = { showAd: () => new Promise(() => {}) };
    const r = p.rewarded();
    const onEvent = (w.GD_OPTIONS as { onEvent: (e: GDEvent) => void }).onEvent;
    expect(() => onEvent({ name: 'SDK_GAME_PAUSE' })).not.toThrow();
    onEvent({ name: 'SDK_REWARDED_WATCH_COMPLETE' });
    await expect(r).resolves.toBe(true);
  });
});
