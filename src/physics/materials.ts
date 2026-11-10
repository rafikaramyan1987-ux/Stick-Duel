/**
 * Physical materials. Density is per square metre (2D), so the mass of a body is
 * density × area. Values are tuned for gameplay, not realism.
 */
export type MaterialId = 'wood' | 'stone' | 'rock' | 'metal' | 'glass' | 'ice' | 'barrel' | 'sand' | 'ground' | 'crate';

export interface Material {
  density: number;
  friction: number;
  restitution: number;
  /** Hit points of a breakable body (undefined = unbreakable). */
  hp?: number;
  /** Impulse (N·s) below which an impact does not hurt the body at all. */
  toughness: number;
  /** Fire arrows and flames set it alight. */
  flammable: boolean;
  /** Explodes when ignited or hit hard enough. */
  explosive: boolean;
  /** How it sounds and what particles it makes (render layer). */
  sound: 'wood' | 'stone' | 'metal' | 'glass' | 'soft';
}

export const MATERIALS: Record<MaterialId, Material> = {
  wood: { density: 5, friction: 0.7, restitution: 0.05, hp: 34, toughness: 9, flammable: true, explosive: false, sound: 'wood' },
  crate: { density: 4, friction: 0.7, restitution: 0.05, hp: 26, toughness: 8, flammable: true, explosive: false, sound: 'wood' },
  stone: { density: 14, friction: 0.8, restitution: 0.02, hp: 120, toughness: 40, flammable: false, explosive: false, sound: 'stone' },
  rock: { density: 16, friction: 0.9, restitution: 0.04, toughness: 1e9, flammable: false, explosive: false, sound: 'stone' },
  metal: { density: 18, friction: 0.5, restitution: 0.08, toughness: 1e9, flammable: false, explosive: false, sound: 'metal' },
  glass: { density: 6, friction: 0.3, restitution: 0.05, hp: 6, toughness: 2, flammable: false, explosive: false, sound: 'glass' },
  ice: { density: 7, friction: 0.03, restitution: 0.05, hp: 24, toughness: 10, flammable: false, explosive: false, sound: 'glass' },
  barrel: { density: 5, friction: 0.6, restitution: 0.1, hp: 999, toughness: 40, flammable: true, explosive: true, sound: 'wood' },
  sand: { density: 9, friction: 1, restitution: 0, hp: 30, toughness: 14, flammable: false, explosive: false, sound: 'soft' },
  ground: { density: 0, friction: 0.9, restitution: 0.02, toughness: 1e9, flammable: false, explosive: false, sound: 'soft' },
};
