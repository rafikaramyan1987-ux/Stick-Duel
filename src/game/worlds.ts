import type { WeaponId } from '../core/weapons';

export type WorldId = 'forest' | 'castle' | 'mountains' | 'desert' | 'snow' | 'volcano';
export type EnemyKind = 'ranger' | 'knight' | 'viking' | 'nomad' | 'yeti' | 'golem';

export interface BossDef {
  /** i18n key suffix: boss.<id>.name / boss.<id>.intro */
  id: string;
  weapon: WeaponId;
  scale: number;
}

export interface WorldDef {
  id: WorldId;
  /** 1-based. */
  index: number;
  enemy: EnemyKind;
  /** Weapons regular enemies of this world may use. */
  enemyWeapons: WeaponId[];
  boss: BossDef;
  /** Wind strength range (m/s²) over the 10 levels, and how much it changes each turn. */
  wind: { from: number; to: number; gust: number };
  /** Friction of platform surfaces (ice is slippery). */
  friction: number;
}

export const LEVELS_PER_WORLD = 10;

export const WORLDS: WorldDef[] = [
  { id: 'forest', index: 1, enemy: 'ranger', enemyWeapons: ['bow'], boss: { id: 'oakheart', weapon: 'volley', scale: 1.3 }, wind: { from: 0, to: 0.6, gust: 0 }, friction: 0.9 },
  { id: 'castle', index: 2, enemy: 'knight', enemyWeapons: ['bow', 'spear'], boss: { id: 'ironclad', weapon: 'cannon', scale: 1.35 }, wind: { from: 0, to: 1.2, gust: 0.3 }, friction: 0.8 },
  { id: 'mountains', index: 3, enemy: 'viking', enemyWeapons: ['axe', 'bow', 'spear'], boss: { id: 'stormbeard', weapon: 'greataxe', scale: 1.4 }, wind: { from: 0.8, to: 2.4, gust: 1.2 }, friction: 0.85 },
  { id: 'desert', index: 4, enemy: 'nomad', enemyWeapons: ['boomerang', 'bow', 'spear'], boss: { id: 'sandking', weapon: 'twinrang', scale: 1.35 }, wind: { from: 1, to: 2.6, gust: 1.6 }, friction: 0.7 },
  { id: 'snow', index: 5, enemy: 'yeti', enemyWeapons: ['axe', 'spear', 'bomb'], boss: { id: 'frostfang', weapon: 'snowball', scale: 1.5 }, wind: { from: 0.4, to: 2, gust: 1 }, friction: 0.04 },
  { id: 'volcano', index: 6, enemy: 'golem', enemyWeapons: ['bomb', 'axe', 'staff', 'spear'], boss: { id: 'magmor', weapon: 'meteor', scale: 1.55 }, wind: { from: 0.6, to: 2, gust: 1 }, friction: 0.8 },
];

export const worldById = (id: WorldId): WorldDef => WORLDS.find((w) => w.id === id) as WorldDef;
export const worldByIndex = (i: number): WorldDef => WORLDS[Math.max(0, Math.min(WORLDS.length - 1, i - 1))] as WorldDef;
