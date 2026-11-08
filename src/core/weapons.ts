export type WeaponId =
  | 'bow'
  | 'axe'
  | 'spear'
  | 'bomb'
  | 'boomerang'
  | 'staff'
  // boss specials
  | 'volley'
  | 'cannon'
  | 'greataxe'
  | 'twinrang'
  | 'snowball'
  | 'meteor';

export type WeaponLook = 'arrow' | 'axe' | 'spear' | 'bomb' | 'boomerang' | 'bolt' | 'snowball' | 'meteor';

export interface WeaponDef {
  id: WeaponId;
  look: WeaponLook;
  /** Launch speed at full power, m/s. */
  speedMax: number;
  /** Launch speed at the weakest pull, m/s. */
  speedMin: number;
  gravity: number;
  windScale: number;
  drag: number;
  /** Return acceleration for boomerangs (m/s²), 0 otherwise. */
  boomerang: number;
  damage: number;
  /** Impulse given to the part hit (scaled by ragdoll mass). */
  knockback: number;
  /** Visual spin, rad/s (0 = aligns with velocity). */
  spin: number;
  sticks: boolean;
  explode?: { radius: number; damage: number; impulse: number };
  /** Projectiles per shot and spread between them (rad). */
  count: number;
  spread: number;
  /** Size multiplier for drawing and hit radius. */
  size: number;
  /** Shop price in coins (0 = owned from the start, -1 = boss only). */
  price: number;
  /** World index (1-based) whose boss must be beaten before it can be bought. */
  requires: number;
  sound: 'twang' | 'whoosh' | 'magic';
}

const base = { drag: 0.012, boomerang: 0, spin: 0, sticks: false, count: 1, spread: 0, size: 1, requires: 0, sound: 'whoosh' as const };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  bow: { ...base, id: 'bow', look: 'arrow', speedMax: 22, speedMin: 6, gravity: 1, windScale: 1, damage: 24, knockback: 3.2, sticks: true, price: 0, sound: 'twang' },
  axe: { ...base, id: 'axe', look: 'axe', speedMax: 19, speedMin: 6, gravity: 1.1, windScale: 0.6, damage: 31, knockback: 5, spin: 15, sticks: true, price: 120 },
  spear: { ...base, id: 'spear', look: 'spear', speedMax: 23, speedMin: 8, gravity: 0.9, windScale: 0.25, drag: 0.004, damage: 36, knockback: 9, sticks: true, price: 260 },
  bomb: { ...base, id: 'bomb', look: 'bomb', speedMax: 18, speedMin: 5, gravity: 1, windScale: 0.8, damage: 12, knockback: 3, spin: 4, explode: { radius: 1.8, damage: 28, impulse: 7 }, price: 420 },
  boomerang: { ...base, id: 'boomerang', look: 'boomerang', speedMax: 21, speedMin: 8, gravity: 0.45, windScale: 0.5, boomerang: 5.5, damage: 25, knockback: 4, spin: 22, price: 600 },
  staff: { ...base, id: 'staff', look: 'bolt', speedMax: 19, speedMin: 7, gravity: 0.4, windScale: 0, drag: 0, damage: 28, knockback: 5, price: 900, requires: 3, sound: 'magic' },
  volley: { ...base, id: 'volley', look: 'arrow', speedMax: 22, speedMin: 6, gravity: 1, windScale: 1, damage: 13, knockback: 2.6, sticks: true, count: 3, spread: 0.07, price: -1, sound: 'twang' },
  cannon: { ...base, id: 'cannon', look: 'bomb', speedMax: 19, speedMin: 6, gravity: 1, windScale: 0.5, damage: 10, knockback: 4, spin: 3, explode: { radius: 2.3, damage: 26, impulse: 9 }, size: 1.5, price: -1 },
  greataxe: { ...base, id: 'greataxe', look: 'axe', speedMax: 19, speedMin: 6, gravity: 1.1, windScale: 0.4, damage: 25, knockback: 8, spin: 12, sticks: true, size: 1.5, price: -1 },
  twinrang: { ...base, id: 'twinrang', look: 'boomerang', speedMax: 21, speedMin: 8, gravity: 0.45, windScale: 0.5, boomerang: 5.5, damage: 17, knockback: 3.5, spin: 22, count: 2, spread: 0.09, price: -1 },
  snowball: { ...base, id: 'snowball', look: 'snowball', speedMax: 20, speedMin: 6, gravity: 1, windScale: 0.7, damage: 26, knockback: 4.5, spin: 6, size: 1.7, price: -1 },
  meteor: { ...base, id: 'meteor', look: 'meteor', speedMax: 19, speedMin: 6, gravity: 0.95, windScale: 0.3, damage: 10, knockback: 4, spin: 5, explode: { radius: 2.3, damage: 28, impulse: 9 }, size: 1.5, price: -1, sound: 'magic' },
};

/** Weapons a player can own and pick, in shop order. */
export const PLAYER_WEAPONS: WeaponId[] = ['bow', 'axe', 'spear', 'bomb', 'boomerang', 'staff'];

/** Hit radius of a projectile, metres. */
export const projectileRadius = (w: WeaponDef): number =>
  (w.look === 'arrow' || w.look === 'spear' ? 0.05 : w.look === 'bolt' ? 0.12 : 0.14) * w.size;
