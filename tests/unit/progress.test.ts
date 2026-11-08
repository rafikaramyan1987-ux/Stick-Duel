import { beforeEach, describe, expect, it } from 'vitest';
import {
  buy,
  equip,
  furthestWorld,
  itemLocked,
  levelUnlocked,
  newSave,
  recordLevel,
  sanitize,
  SAVE_KEY,
  totalStars,
  worldUnlocked,
} from '../../src/game/progress';
import { loadSave, writeSave } from '../../src/game/save';
import { setStorageBackend } from '../../src/platform/storage';
import type { StorageLike } from '../../src/platform/ads';

class MemStore implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe('progress', () => {
  it('unlocks levels one by one and worlds after the boss', () => {
    const s = newSave();
    expect(levelUnlocked(s, 1, 1)).toBe(true);
    expect(levelUnlocked(s, 1, 2)).toBe(false);
    expect(worldUnlocked(s, 2)).toBe(false);
    recordLevel(s, 1, 1, 2, 30);
    expect(levelUnlocked(s, 1, 2)).toBe(true);
    for (let l = 2; l <= 9; l++) recordLevel(s, 1, l, 1, 10);
    expect(worldUnlocked(s, 2)).toBe(false);
    const r = recordLevel(s, 1, 10, 3, 100);
    expect(r.unlockedWorld).toBe(2);
    expect(worldUnlocked(s, 2)).toBe(true);
    expect(levelUnlocked(s, 2, 1)).toBe(true);
    expect(furthestWorld(s)).toBe(2);
  });

  it('keeps the best stars, always adds coins', () => {
    const s = newSave();
    recordLevel(s, 1, 1, 3, 40);
    const r = recordLevel(s, 1, 1, 1, 10);
    expect(s.stars['1-1']).toBe(3);
    expect(r.newBest).toBe(false);
    expect(s.coins).toBe(50);
    expect(totalStars(s)).toBe(3);
    recordLevel(s, 1, 2, 0, 3);
    expect(s.stars['1-2']).toBeUndefined();
  });

  it('shop: buy needs coins, weapons may need a world beaten', () => {
    const s = newSave();
    expect(buy(s, { type: 'weapon', id: 'axe' })).toBe(false);
    s.coins = 1000;
    expect(buy(s, { type: 'weapon', id: 'axe' })).toBe(true);
    expect(s.weapons).toContain('axe');
    expect(s.equipped.weapon).toBe('axe');
    expect(buy(s, { type: 'weapon', id: 'axe' })).toBe(false);
    expect(itemLocked(s, { type: 'weapon', id: 'staff' })).toBe(true);
    expect(buy(s, { type: 'weapon', id: 'staff' })).toBe(false);
    for (let w = 1; w <= 3; w++) recordLevel(s, w, 10, 1, 0);
    expect(itemLocked(s, { type: 'weapon', id: 'staff' })).toBe(false);
    expect(buy(s, { type: 'hat', id: 'crown' })).toBe(true);
    expect(equip(s, { type: 'hat', id: 'wizard' })).toBe(false);
    expect(equip(s, { type: 'weapon', id: 'bow' })).toBe(true);
  });

  it('sanitizes broken or hostile saves', () => {
    expect(sanitize(null)).toEqual(newSave());
    expect(sanitize({ version: 2 })).toEqual(newSave());
    const s = sanitize({
      version: 1,
      coins: -50,
      stars: { '1-1': 9, '7-1': 3, '1-11': 2, hack: 3, '2-3': 2 },
      weapons: ['bow', 'nuke', 'axe'],
      hats: ['crown'],
      equipped: { weapon: 'nuke', hat: 'crown', color: 'gold' },
      settings: { sound: false, lang: 'de' },
    });
    expect(s.coins).toBe(0);
    expect(s.stars).toEqual({ '1-1': 3, '2-3': 2 });
    expect(s.weapons).toEqual(['bow', 'axe']);
    expect(s.equipped).toEqual({ weapon: 'bow', hat: 'crown', color: 'blue' });
    expect(s.settings).toEqual({ sound: false, music: true, lang: 'auto' });
  });
});

describe('save/load', () => {
  let store: MemStore;
  beforeEach(() => {
    store = new MemStore();
    setStorageBackend(store);
  });

  it('round-trips through the platform storage (CrazyGames data module)', () => {
    const s = newSave();
    s.coins = 123;
    recordLevel(s, 1, 1, 2, 0);
    s.settings.lang = 'fr';
    writeSave(s);
    expect(store.getItem(SAVE_KEY)).toContain('"coins":123');
    const back = loadSave();
    expect(back).toEqual(s);
  });

  it('survives corrupt data and storage errors', () => {
    store.setItem(SAVE_KEY, '{not json');
    expect(loadSave()).toEqual(newSave());
    setStorageBackend({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    });
    const s = newSave();
    s.coins = 7;
    expect(() => writeSave(s)).not.toThrow();
    // falls back to the in-memory copy for this session
    expect(loadSave().coins).toBe(7);
  });
});

describe('shop content', () => {
  it('at least 12 hats including the classics, and new colours', async () => {
    const { HATS, COLORS } = await import('../../src/game/progress');
    const hats = HATS.filter((h) => h !== 'none');
    expect(hats.length).toBeGreaterThanOrEqual(12);
    for (const h of ['crown', 'pirate', 'chef', 'viking', 'cowboy', 'party', 'beanie', 'tophat', 'ninja', 'astronaut', 'wizard', 'flowercrown']) expect(hats).toContain(h);
    expect(COLORS.length).toBeGreaterThanOrEqual(12);
  });
});
