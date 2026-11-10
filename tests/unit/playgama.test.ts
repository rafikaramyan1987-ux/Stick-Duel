import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MidgameThrottle, MIDGAME_INTERVAL_MS } from '../../src/platform/ads';
import { AD_START_TIMEOUT_MS, BRIDGE_INIT_TIMEOUT, PlaygamaPlatform, PLAYGAMA_STORAGE_KEYS, type BridgeSdk } from '../../src/platform/playgama';
import { SAVE_KEY } from '../../src/game/progress';

/** a Playgama Bridge stand-in: `ad` decides what an ad does (it emits Bridge's ad states) */
type Emit = (event: string, value: unknown) => void;
async function setup(ad: (kind: 'interstitial' | 'rewarded', emit: Emit) => void, opts: { audio?: boolean; rewarded?: boolean; saved?: string | null; lang?: string } = {}) {
  const handlers: Record<string, ((v: unknown) => void)[]> = {};
  const emit: Emit = (n, v) => handlers[n]?.forEach((f) => f(v));
  const on = (n: string, f: (v: unknown) => void) => (handlers[n] ??= []).push(f);
  const docListeners: Record<string, (() => void)[]> = {};
  const doc = { hidden: false, addEventListener: (n: string, f: () => void) => (docListeners[n] ??= []).push(f), documentElement: { style: { setProperty: vi.fn() } } };
  const sent: string[] = [];
  const stored: Record<string, string> = {};
  const bridge = {
    initialize: vi.fn(async () => {}),
    EVENT_NAME: { INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed', REWARDED_STATE_CHANGED: 'rewarded_state_changed', AUDIO_STATE_CHANGED: 'audio_state_changed', PAUSE_STATE_CHANGED: 'pause_state_changed' },
    platform: { id: 'playgama', language: opts.lang ?? 'fr', isAudioEnabled: opts.audio ?? true, sendMessage: vi.fn((m: string) => sent.push(m)), on },
    advertisement: {
      isInterstitialSupported: true,
      isRewardedSupported: opts.rewarded ?? true,
      showInterstitial: vi.fn(() => ad('interstitial', emit)),
      showRewarded: vi.fn(() => ad('rewarded', emit)),
      on,
    },
    storage: {
      get: vi.fn(async (keys: string[]) => keys.map((k) => (k === SAVE_KEY ? (opts.saved ?? null) : null))),
      set: vi.fn(async (k: string, v: string) => void (stored[k] = v)),
    },
  };
  vi.stubGlobal('window', { bridge: bridge as unknown as BridgeSdk });
  vi.stubGlobal('document', doc);
  const log: string[] = [];
  const pg = new PlaygamaPlatform({ onAdPause: (p) => log.push(p ? 'pause' : 'resume') });
  pg.onPlatformMuteChange((m) => log.push(m ? 'sound-off' : 'sound-on'));
  await pg.init();
  const visibility = (hidden: boolean) => {
    doc.hidden = hidden;
    docListeners.visibilitychange?.forEach((f) => f());
  };
  return { pg, bridge, emit, log, sent, stored, visibility, doc, docListeners };
}
/** an ad that opens, plays and closes; `reward` emits the rewarded state first */
const watched =
  (reward: boolean) =>
  (kind: 'interstitial' | 'rewarded', emit: Emit) => {
    const ev = kind === 'rewarded' ? 'rewarded_state_changed' : 'interstitial_state_changed';
    emit(ev, 'loading');
    setTimeout(() => emit(ev, 'opened'), 100);
    if (reward) setTimeout(() => emit(ev, 'rewarded'), 900);
    setTimeout(() => emit(ev, 'closed'), 1000);
  };

describe('Playgama platform (Bridge)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('init: Bridge initialized, platform language, every save key read in one storage.get, writes to Bridge Storage', async () => {
    const { pg, bridge, stored } = await setup(watched(true), { saved: '{"version":1,"coins":7}' });
    expect(bridge.initialize).toHaveBeenCalledOnce();
    expect(pg.locale()).toBe('fr');
    expect(PLAYGAMA_STORAGE_KEYS).toEqual([SAVE_KEY]);
    expect(bridge.storage.get).toHaveBeenCalledOnce();
    expect(bridge.storage.get).toHaveBeenCalledWith([SAVE_KEY]);
    const st = pg.storage()!;
    expect(st.getItem(SAVE_KEY)).toBe('{"version":1,"coins":7}');
    st.setItem(SAVE_KEY, '{"version":1,"coins":9}');
    st.setItem(SAVE_KEY, '{"version":1,"coins":9}'); // unchanged: no second write
    await Promise.resolve();
    expect(bridge.storage.set).toHaveBeenCalledOnce();
    expect(stored[SAVE_KEY]).toBe('{"version":1,"coins":9}');
  });

  it('language: a language the game does not have, or none, is English (never the browser language)', async () => {
    expect((await setup(watched(true), { lang: 'de' })).pg.locale()).toBe('en');
    expect((await setup(watched(true), { lang: '' })).pg.locale()).toBe('en');
    expect((await setup(watched(true), { lang: 'fr-FR' })).pg.locale()).toBe('fr');
  });

  it('long press: the context menu is prevented, -webkit-touch-callout none', async () => {
    const { docListeners, doc } = await setup(watched(true));
    expect(docListeners.contextmenu).toHaveLength(1);
    expect(doc.documentElement.style.setProperty).toHaveBeenCalledWith('-webkit-touch-callout', 'none');
  });

  it('game_ready once; level_started once per level, level_completed / level_failed at its end', async () => {
    const { pg, sent } = await setup(watched(true));
    pg.gameReady!();
    pg.gameReady!();
    pg.gameplayStart();
    pg.gameplayStop();
    pg.gameplayStart(); // resume after a pause: same level
    pg.levelEnd!(true);
    pg.levelEnd!(true); // nothing running: nothing sent
    pg.gameplayStart();
    pg.levelEnd!(false);
    expect(sent).toEqual(['game_ready', 'level_started', 'level_completed', 'level_started', 'level_failed']);
  });

  it('rewarded: granted only after the `rewarded` state; paused + muted while the ad is open, back after', async () => {
    const { pg, log } = await setup(watched(true));
    expect(pg.adsUnavailable()).toBe(null);
    const p = pg.rewarded();
    await vi.advanceTimersByTimeAsync(500);
    expect(pg.muted).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toBe(true);
    expect(pg.muted).toBe(false);
    expect(log).toEqual(['pause', 'resume']);
  });

  it('rewarded: closed without the reward (cancelled) or failed → no reward', async () => {
    const { pg } = await setup(watched(false));
    const p = pg.rewarded();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe(false);
    const f = await setup((_kind, emit) => setTimeout(() => emit('rewarded_state_changed', 'failed'), 200));
    const q = f.pg.rewarded();
    await vi.advanceTimersByTimeAsync(300);
    expect(await q).toBe(false);
    expect(f.pg.muted).toBe(false);
  });

  it('settles exactly once: an ad that never opens gives up after AD_START_TIMEOUT_MS; late states are ignored', async () => {
    const { pg, emit } = await setup(() => {});
    const p = pg.rewarded();
    await vi.advanceTimersByTimeAsync(AD_START_TIMEOUT_MS + 10);
    expect(await p).toBe(false);
    emit('rewarded_state_changed', 'opened');
    emit('rewarded_state_changed', 'rewarded');
    emit('rewarded_state_changed', 'closed');
    expect(pg.muted).toBe(false);
  });

  it('no rewarded ads where Bridge has none: rewarded buttons hidden, rewarded() never asks Bridge', async () => {
    const { pg, bridge } = await setup(watched(true), { rewarded: false });
    expect(pg.adsUnavailable()).toBe('disabled');
    expect(await pg.rewarded()).toBe(false);
    expect(bridge.advertisement.showRewarded).not.toHaveBeenCalled();
  });

  it('interstitials: never in a level, no pre-roll; between levels at most one per MIDGAME_INTERVAL_MS (app.ts throttle)', async () => {
    const { pg, bridge } = await setup(watched(false));
    await pg.preroll();
    expect(bridge.advertisement.showInterstitial).not.toHaveBeenCalled();
    pg.gameplayStart();
    await pg.midgame(); // in a level
    expect(bridge.advertisement.showInterstitial).not.toHaveBeenCalled();
    pg.gameplayStop();
    const p = pg.midgame();
    await vi.advanceTimersByTimeAsync(1500);
    await p;
    expect(bridge.advertisement.showInterstitial).toHaveBeenCalledOnce();
    // the gap the result-screen buttons keep (app.ts breakThen)
    let now = 0;
    const th = new MidgameThrottle(() => now);
    expect(th.canShow()).toBe(false);
    now = MIDGAME_INTERVAL_MS;
    expect(th.canShow()).toBe(true);
    th.markShown();
    expect(th.canShow()).toBe(false);
  });

  it("platform audio off mutes without pausing; Bridge's pause and a hidden page pause + mute; restore only when nothing is left", async () => {
    const { pg, emit, log, visibility } = await setup(watched(true), { audio: false });
    expect(pg.platformMuted()).toBe(true);
    expect(pg.muted).toBe(true);
    emit('audio_state_changed', true);
    expect(pg.muted).toBe(false);
    emit('pause_state_changed', true);
    visibility(true);
    expect(pg.muted).toBe(true);
    emit('pause_state_changed', false);
    expect(pg.muted).toBe(true); // still hidden
    visibility(false);
    expect(pg.muted).toBe(false);
    emit('audio_state_changed', false);
    expect(pg.muted).toBe(true);
    expect(log).toEqual(['sound-on', 'pause', 'resume', 'sound-off']);
  });

  it('Bridge that never initializes does not block the boot longer than BRIDGE_INIT_TIMEOUT', async () => {
    const { bridge } = await setup(watched(true));
    bridge.initialize.mockImplementation(() => new Promise(() => {}));
    const pg = new PlaygamaPlatform({ onAdPause: () => {} });
    const p = pg.init();
    await vi.advanceTimersByTimeAsync(BRIDGE_INIT_TIMEOUT + 10);
    await p;
    expect(pg.adsUnavailable()).toBe('disabled');
    expect(pg.storage()).toBe(null);
  });

  it('without Bridge (script blocked) the game plays on: no ads, no SDK storage, English', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {} });
    const pg = new PlaygamaPlatform({ onAdPause: () => {} });
    await pg.init();
    expect(pg.adsUnavailable()).toBe('disabled');
    expect(pg.storage()).toBe(null);
    expect(pg.locale()).toBe('en');
    expect(await pg.rewarded()).toBe(false);
    await pg.midgame();
    pg.gameReady!();
  });
});
