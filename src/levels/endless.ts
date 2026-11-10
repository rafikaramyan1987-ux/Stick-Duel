import { Rng } from '../core/rng';
import { bunker, crate, drop, level, log, parts, pendulum, rock, tnt, type Part } from './kit';
import type { AmmoId, LevelDef, WorldId } from './types';

/**
 * Endless mode: random arenas built from hazard modules that always work, one rival after another.
 * The rival gets tougher and smarter with every wave; your HP carries over (with a small heal).
 */
const WORLDS: WorldId[] = ['forest', 'castle', 'mountains', 'desert', 'frozen', 'volcano'];
const WALLS = { forest: 'post', castle: 'castleWall', mountains: 'stoneBlock', desert: 'sandstone', frozen: 'iceBlock', volcano: 'stoneBlock' } as const;

type Module = (r: Rng, w: WorldId) => { part: Part; ammo: Partial<Record<AmmoId, number>> };

const MODULES: Module[] = [
  // a rock over the rival
  (r) => ({ part: drop('rope', 11.6 + r.range(-0.3, 0.3), r.range(1.8, 2.6), rock('rock', r.range(0.9, 1.1), r.range(0.8, 1)), 13.4), ammo: {} }),
  // a swinging log
  (r) => ({ part: pendulum('ram', { x: 10.3, y: -7.6 }, 5, r.range(0.85, 1), 5.2), ammo: {} }),
  // a barrel next to the rival
  (r) => ({ part: { objects: [tnt(12.6 + r.range(-0.2, 0.3), 0, 'tnt')], ropes: [] }, ammo: { fire: 1 } }),
  // a falling log
  (r) => ({ part: drop('rope', 11.6, r.range(1.6, 2.4), log('log', 0, 0, 0.6), 13.4), ammo: {} }),
  // a roof that burns, with a rock above
  (r, w) => ({ part: parts(bunker(10.3, 12.9, -3.1, 'wood', WALLS[w]), drop('rope', 11.6, r.range(2.2, 2.6), rock('rock', 1, 1), 13.6)), ammo: { fire: 2 } }),
];

export function endlessLevel(wave: number, seed: number): LevelDef {
  const r = new Rng(seed * 2654435761 + wave * 97);
  const world = WORLDS[(wave - 1 + Math.floor(r.next() * 2)) % WORLDS.length]!;
  const mod = r.pick(MODULES.slice(0, wave < 3 ? 4 : MODULES.length))(r, world);
  const extra: Part = r.chance(0.5) ? drop('crateP', 1.4, 1.2, crate(0, 0, 0.8), -0.4) : { objects: [], ropes: [] };
  const ammo: Partial<Record<AmmoId, number>> = { arrow: 4, ...mod.ammo };
  if (wave > 4 && r.chance(0.4)) ammo.heavy = 1;
  const l = level(world, 1, {
    par: 1,
    ammo,
    ...parts(mod.part, extra),
    rivalTargets: extra.objects.length ? ['crateP'] : [],
    rivalSkill: Math.min(0.85, 0.3 + wave * 0.05),
  });
  return { ...l, id: `endless-${wave}`, rival: { ...l.rival, hp: Math.min(120, 60 + wave * 6) } };
}
