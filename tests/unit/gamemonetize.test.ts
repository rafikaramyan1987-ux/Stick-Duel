import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AD_MAX_MS,
  AD_START_TIMEOUT_MS,
  GM_AD_GAP_MS,
  GM_GAME_ID,
  GM_SCRIPT_ID,
  GM_SDK_URL,
  GameMonetizePlatform,
  type GMEvent,
} from '../../src/platform/gamemonetize';

interface FakeScript {
  id: string;
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

/** Minimal window + document: enough for the adapter to inject its script tag (README loader). */
function fakeWindow() {
  const scripts: FakeScript[] = [];
  const doc = {
    getElementById: (id: string) => scripts.find((s) => s.id === id) ?? null,
    createElement: () => ({ id: '', src: '', onload: null, onerror: null }) as FakeScript,
    getElementsByTagName: () => [],
    head: { appendChild: (s: FakeScript) => scripts.push(s) },
  };
  const w: Record<string, unknown> = { document: doc };
  vi.stubGlobal('window', w);
  return { w, scripts };
}

let clock = 0;
async function setup(opts: { show?: () => unknown; ready?: boolean } = {}) {
  const env = fakeWindow();
  const pauses: boolean[] = [];
  const p = new GameMonetizePlatform({ onAdPause: (v) => pauses.push(v) }, GM_GAME_ID, () => clock);
  const init = p.init();
  env.scripts[0]?.onload?.();
  await init;
  const emit = (name: string) => (env.w.SDK_OPTIONS as { onEvent: (e: GMEvent) => void }).onEvent({ name });
  let shown = 0;
  env.w.sdk = {
    showBanner: () => {
      shown++;
      return opts.show?.();
    },
  };
  if (opts.ready !== false) emit('SDK_READY');
  return { ...env, p, pauses, emit, shown: () => shown };
}

/** Settled state of a promise without awaiting it forever. */
async function state<T>(pr: Promise<T>): Promise<boolean> {
  let done = false;
  void pr.then(() => (done = true));
  await vi.advanceTimersByTimeAsync(0);
  return done;
}

beforeEach(() => {
  clock = 1_000_000;
  vi.useFakeTimers();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GameMonetize SDK loading', () => {
  it('sets SDK_OPTIONS { gameId, onEvent } before injecting sdk.js once (id gamemonetize-sdk)', async () => {
    const { w, scripts, p } = await setup();
    expect(GM_GAME_ID).toBe('qgdkibss7nawv209v2pfh8txf4p94eas');
    expect((w.SDK_OPTIONS as { gameId: string }).gameId).toBe(GM_GAME_ID);
    expect(typeof (w.SDK_OPTIONS as { onEvent: unknown }).onEvent).toBe('function');
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ id: GM_SCRIPT_ID, src: GM_SDK_URL });
    await p.init();
    expect(scripts).toHaveLength(1);
  });

  it('SDK blocked: init resolves, no ads, everything continues', async () => {
    const env = fakeWindow();
    const p = new GameMonetizePlatform({ onAdPause: () => {} });
    const init = p.init();
    env.scripts[0]!.onerror?.();
    await expect(init).resolves.toBeUndefined();
    await expect(p.preroll()).resolves.toBeUndefined();
    await expect(p.midgame()).resolves.toBeUndefined();
    await expect(p.rewarded()).resolves.toBe(false);
    expect(p.storage()).toBeNull(); // localStorage
  });

  it('a slow SDK does not hold the boot for more than the wait', async () => {
    fakeWindow();
    const p = new GameMonetizePlatform({ onAdPause: () => {} });
    const init = p.init(3000);
    expect(await state(init)).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await state(init)).toBe(true);
  });
});

describe('GameMonetize ads', () => {
  it('no rewarded API: rewarded buttons hidden, rewarded() never calls showBanner', async () => {
    const { p, shown } = await setup();
    expect(p.adsUnavailable()).toBe('disabled');
    await expect(p.rewarded()).resolves.toBe(false);
    expect(shown()).toBe(0);
  });

  it('nothing before SDK_READY', async () => {
    const { p, shown } = await setup({ ready: false });
    await p.preroll();
    expect(shown()).toBe(0);
  });

  it('SDK_GAME_PAUSE pauses + mutes, SDK_GAME_START resumes and settles the request', async () => {
    const { p, emit, pauses, shown } = await setup();
    const r = p.preroll();
    expect(shown()).toBe(1);
    emit('SDK_GAME_PAUSE');
    expect(pauses).toEqual([true]);
    await vi.advanceTimersByTimeAsync(30_000); // a long ad: no timeout once started
    expect(await state(r)).toBe(false);
    emit('SDK_GAME_START');
    expect(await state(r)).toBe(true);
    expect(pauses).toEqual([true, false]);
    emit('SDK_GAME_START'); // a duplicate changes nothing
    expect(pauses).toEqual([true, false]);
  });

  it('an ad that never starts settles after 8 s, the game was never paused', async () => {
    const { p, pauses } = await setup();
    const r = p.preroll();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS - 1);
    expect(await state(r)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await state(r)).toBe(true);
    expect(pauses).toEqual([]);
  });

  it('a started ad that never ends is given up, the game resumes', async () => {
    const { p, emit, pauses } = await setup();
    const r = p.preroll();
    emit('SDK_GAME_PAUSE');
    await vi.advanceTimersByTimeAsync(AD_MAX_MS);
    expect(await state(r)).toBe(true);
    expect(pauses).toEqual([true, false]);
  });

  it('showBanner throwing settles at once', async () => {
    const { p } = await setup({
      show: () => {
        throw new Error('boom');
      },
    });
    expect(await state(p.preroll())).toBe(true);
  });

  it('pre-roll once; then at most one ad per ~2 minutes, pre-roll included', async () => {
    const { p, emit, shown } = await setup();
    const a = p.preroll();
    emit('SDK_GAME_START');
    await a;
    await p.preroll(); // second Play: nothing
    expect(shown()).toBe(1);
    clock += GM_AD_GAP_MS - 1000;
    await p.midgame();
    expect(shown()).toBe(1);
    clock += 1000;
    const b = p.midgame();
    expect(shown()).toBe(2);
    emit('SDK_GAME_START');
    await b;
  });

  it('never during gameplay, one request at a time', async () => {
    const { p, emit, shown } = await setup();
    p.gameplayStart();
    await p.preroll();
    expect(shown()).toBe(0);
    p.gameplayStop();
    clock += GM_AD_GAP_MS;
    const a = p.midgame();
    const b = p.midgame();
    expect(await state(b)).toBe(true);
    expect(shown()).toBe(1);
    emit('SDK_GAME_START');
    await a;
  });

  it('an ad the SDK shows by itself still pauses and resumes the game', async () => {
    const { emit, pauses } = await setup();
    emit('SDK_GAME_PAUSE');
    emit('SDK_GAME_START');
    expect(pauses).toEqual([true, false]);
  });
});
