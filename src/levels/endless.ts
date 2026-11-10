import { Rng } from '../core/rng';
import { crate, crateStack, drop, level, log, parts, pendulum, rock, shield, stoneWall, tnt, woodWall, type Part } from './kit';
import type { AmmoId, LevelDef, WorldId } from './types';

/**
 * Endless mode: random arenas built from proven modules (cover for both, a trap or two), one rival
 * after another. The rival gets tougher and sharper with every wave; your HP carries over (small heal).
 */
const WORLDS: WorldId[] = ['forest', 'castle', 'mountains', 'desert', 'frozen', 'volcano'];

type Module = (r: Rng) => { part: Part; ammo: Partial<Record<AmmoId, number>> };

const TRAPS: Module[] = [
  // a rock over the rival
  (r) => ({ part: drop('rope', 11.6 + r.range(-0.3, 0.3), r.range(1.2, 1.8), rock('rock', r.range(0.8, 1), r.range(0.7, 0.9)), 13.4), ammo: {} }),
  // a swinging log
  () => ({ part: pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), ammo: {} }),
  // a barrel next to the rival
  (r) => ({ part: { objects: [tnt(12.8 + r.range(-0.2, 0.3), 0, 'tnt')], ropes: [] }, ammo: { fire: 1 } }),
  // a falling log
  (r) => ({ part: drop('rope', 11.6, r.range(1.2, 1.8), log('log', 0, 0, 0.6), 13.4), ammo: {} }),
];

const COVERS: Array<(r: Rng) => Part> = [
  () => ({ objects: [woodWall(10.1, 1.7)], ropes: [] }),
  () => ({ objects: stoneWall(10.1, 2), ropes: [] }),
  () => ({ objects: [...shield(10.3), woodWall(9.7, 1.4)], ropes: [] }),
  () => ({ objects: crateStack(10.1, 2), ropes: [] }),
];

export function endlessLevel(wave: number, seed: number): LevelDef {
  const r = new Rng(seed * 2654435761 + wave * 97);
  const world = WORLDS[(wave - 1 + Math.floor(r.next() * 2)) % WORLDS.length]!;
  const trap = r.pick(TRAPS)(r);
  const cov = r.pick(COVERS)(r);
  const extra: Part = wave > 1 && r.chance(0.5) ? drop('crateP', 1.2, 1.3, crate(0, 0, 0.8), -0.9) : { objects: [], ropes: [] };
  const ammo: Partial<Record<AmmoId, number>> = { ...trap.ammo };
  if (wave > 3 && r.chance(0.4)) ammo.heavy = 1;
  const l = level(world, 1, {
    ammo,
    ...parts(trap.part, cov, { objects: crateStack(2.7, 2, 0, 'pc'), ropes: [] }, extra),
    rivalTargets: extra.objects.length ? ['crateP'] : [],
    rivalSkill: Math.min(0.75, 0.2 + wave * 0.05),
  });
  return { ...l, id: `endless-${wave}`, rival: { ...l.rival, hp: Math.min(150, 80 + wave * 8) } };
}
