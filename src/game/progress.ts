import { PLAYER_WEAPONS, WEAPONS, type WeaponId } from '../core/weapons';
import { newDaily, sanitizeDaily, type DailyState } from './daily';
import { LEVELS_PER_WORLD, WORLDS } from './worlds';

export const SAVE_KEY = 'stick-duel.save.v1';

export const HATS = ['none', 'cap', 'headband', 'beanie', 'party', 'chef', 'tophat', 'cowboy', 'pirate', 'ninja', 'flowercrown', 'wizard', 'viking', 'propeller', 'astronaut', 'crown'] as const;
export type HatId = (typeof HATS)[number];
export const HAT_PRICE: Record<HatId, number> = {
  none: 0,
  cap: 40,
  headband: 60,
  beanie: 70,
  party: 90,
  chef: 110,
  tophat: 120,
  cowboy: 140,
  pirate: 160,
  ninja: 180,
  flowercrown: 200,
  wizard: 220,
  viking: 260,
  propeller: 320,
  astronaut: 380,
  crown: 400,
};

export const COLORS = ['blue', 'red', 'green', 'purple', 'orange', 'pink', 'teal', 'lime', 'navy', 'black', 'gold', 'rainbow'] as const;
export type ColorId = (typeof COLORS)[number];
export const COLOR_PRICE: Record<ColorId, number> = { blue: 0, red: 30, green: 30, purple: 60, orange: 60, pink: 80, teal: 80, lime: 90, navy: 100, black: 120, gold: 350, rainbow: 500 };

export type Lang = 'auto' | 'en' | 'fr';

export const TIPS = ['none', 'head', 'wind', 'weapons', 'bonus'] as const;
export type TipId = (typeof TIPS)[number];

export interface SaveData {
  version: 1;
  coins: number;
  /** Best stars per level, key "world-level". */
  stars: Record<string, number>;
  weapons: WeaponId[];
  hats: HatId[];
  colors: ColorId[];
  equipped: { weapon: WeaponId; hat: HatId; color: ColorId };
  settings: { sound: boolean; music: boolean; lang: Lang };
  endlessBest: number;
  /** The last world shown on the map. */
  lastWorld: number;
  /** First-time tutorial (level 1-1) done or skipped. */
  tutorial: boolean;
  /** One-time tips already shown. */
  tips: TipId[];
  daily: DailyState;
}

export function newSave(): SaveData {
  return {
    version: 1,
    coins: 0,
    stars: {},
    weapons: ['bow'],
    hats: ['none'],
    colors: ['blue'],
    equipped: { weapon: 'bow', hat: 'none', color: 'blue' },
    settings: { sound: true, music: true, lang: 'auto' },
    endlessBest: 0,
    lastWorld: 1,
    tutorial: false,
    tips: [],
    daily: newDaily(),
  };
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const int = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : fallback;
function list<T extends string>(v: unknown, allowed: readonly T[], always: T): T[] {
  const arr = Array.isArray(v) ? v.filter((x): x is T => typeof x === 'string' && (allowed as readonly string[]).includes(x)) : [];
  return [...new Set([always, ...arr])];
}

/** Turns anything read from storage into a valid save (unknown ids dropped, numbers clamped). */
export function sanitize(raw: unknown): SaveData {
  const base = newSave();
  const d = obj(raw);
  if (d.version !== 1) return base;
  const stars: Record<string, number> = {};
  for (const [k, val] of Object.entries(obj(d.stars))) {
    const m = /^(\d)-(\d{1,2})$/.exec(k);
    if (!m) continue;
    const w = Number(m[1]);
    const l = Number(m[2]);
    if (w < 1 || w > WORLDS.length || l < 1 || l > LEVELS_PER_WORLD) continue;
    const s = int(val, 0, 0, 3);
    if (s > 0) stars[k] = s;
  }
  const weapons = list(d.weapons, PLAYER_WEAPONS, 'bow');
  const hats = list(d.hats, HATS, 'none');
  const colors = list(d.colors, COLORS, 'blue');
  const eq = obj(d.equipped);
  const se = obj(d.settings);
  const weapon = weapons.includes(eq.weapon as WeaponId) ? (eq.weapon as WeaponId) : 'bow';
  const hat = hats.includes(eq.hat as HatId) ? (eq.hat as HatId) : 'none';
  const color = colors.includes(eq.color as ColorId) ? (eq.color as ColorId) : 'blue';
  return {
    version: 1,
    coins: int(d.coins, 0, 0, 1e9),
    stars,
    weapons,
    hats,
    colors,
    equipped: { weapon, hat, color },
    settings: {
      sound: se.sound !== false,
      music: se.music !== false,
      lang: se.lang === 'en' || se.lang === 'fr' ? se.lang : 'auto',
    },
    endlessBest: int(d.endlessBest, 0, 0, 1e6),
    lastWorld: int(d.lastWorld, 1, 1, WORLDS.length),
    tutorial: d.tutorial === true,
    tips: list(d.tips, TIPS, 'none').filter((x) => x !== 'none'),
    daily: sanitizeDaily(d.daily),
  };
}

export const levelKey = (world: number, level: number): string => `${world}-${level}`;
export const starsOf = (s: SaveData, world: number, level: number): number => s.stars[levelKey(world, level)] ?? 0;

/** A world is open once the previous world's boss is beaten. */
export const worldUnlocked = (s: SaveData, world: number): boolean => world === 1 || starsOf(s, world - 1, LEVELS_PER_WORLD) > 0;

/** A level is open once the previous one is won. */
export const levelUnlocked = (s: SaveData, world: number, level: number): boolean =>
  worldUnlocked(s, world) && (level === 1 || starsOf(s, world, level - 1) > 0);

export const worldStars = (s: SaveData, world: number): number => {
  let n = 0;
  for (let l = 1; l <= LEVELS_PER_WORLD; l++) n += starsOf(s, world, l);
  return n;
};
export const totalStars = (s: SaveData): number => WORLDS.reduce((n, w) => n + worldStars(s, w.index), 0);

/** Highest world the player can play. */
export const furthestWorld = (s: SaveData): number => {
  let w = 1;
  while (w < WORLDS.length && worldUnlocked(s, w + 1)) w++;
  return w;
};

export interface LevelResult {
  stars: number;
  coins: number;
  firstClear: boolean;
  newBest: boolean;
  unlockedWorld: number | null;
}

/** Records a finished level: best stars kept, coins added. */
export function recordLevel(s: SaveData, world: number, level: number, stars: number, coins: number): LevelResult {
  const key = levelKey(world, level);
  const before = s.stars[key] ?? 0;
  const wasUnlocked = worldUnlocked(s, world + 1);
  if (stars > before) s.stars[key] = stars;
  s.coins += coins;
  const unlocked = !wasUnlocked && world < WORLDS.length && worldUnlocked(s, world + 1) ? world + 1 : null;
  return { stars, coins, firstClear: before === 0 && stars > 0, newBest: stars > before, unlockedWorld: unlocked };
}

export type ShopItem = { type: 'weapon'; id: WeaponId } | { type: 'hat'; id: HatId } | { type: 'color'; id: ColorId };

export function priceOf(item: ShopItem): number {
  if (item.type === 'weapon') return WEAPONS[item.id].price;
  if (item.type === 'hat') return HAT_PRICE[item.id];
  return COLOR_PRICE[item.id];
}

export function owns(s: SaveData, item: ShopItem): boolean {
  if (item.type === 'weapon') return s.weapons.includes(item.id);
  if (item.type === 'hat') return s.hats.includes(item.id);
  return s.colors.includes(item.id);
}

/** Weapons need the boss of their required world beaten first. */
export function itemLocked(s: SaveData, item: ShopItem): boolean {
  if (item.type !== 'weapon') return false;
  const req = WEAPONS[item.id].requires;
  return req > 0 && !worldUnlocked(s, req + 1);
}

export function buy(s: SaveData, item: ShopItem): boolean {
  const price = priceOf(item);
  if (owns(s, item) || itemLocked(s, item) || price < 0 || s.coins < price) return false;
  s.coins -= price;
  if (item.type === 'weapon') s.weapons.push(item.id);
  else if (item.type === 'hat') s.hats.push(item.id);
  else s.colors.push(item.id);
  equip(s, item);
  return true;
}

export function equip(s: SaveData, item: ShopItem): boolean {
  if (!owns(s, item)) return false;
  if (item.type === 'weapon') s.equipped.weapon = item.id;
  else if (item.type === 'hat') s.equipped.hat = item.id;
  else s.equipped.color = item.id;
  return true;
}
