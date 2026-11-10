import { beam, boulder, box, bunker, crate, drop, hut, level, ledge, parts, pendulum, pool, rock, type Part } from './kit';
import type { LevelDef, TerrainDef } from './types';

/** Volcano: lava (touch it and you are out), falling rocks, everything burns. */
const D = 'dark' as const;
const WALL = 'stoneBlock' as const;

/** Ground with a lava pit from x0 to x1. */
function lavaPit(x0: number, x1: number): Part {
  const t: TerrainDef = {
    surface: D,
    points: [{ x: -10, y: 0 }, { x: x0, y: 0 }, { x: x0, y: 1.8 }, { x: x1, y: 1.8 }, { x: x1, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }],
  };
  return { terrain: [t], objects: [], ropes: [], lava: [pool(x0, x1, 0.6, 1.2)] };
}

/**
 * The rival's stone slab over lava, on three wooden legs (fixed, but each burns or snaps). Fire cannot
 * spread across the stone, so one burnt leg is not enough: the slab tips once two are gone.
 */
function stilts(x: number, w: number, legH: number): Part {
  const leg = (lx: number, id: string) => ({ ...beam(lx, 1.8, legH + 1.8, id, 0.32), fixed: true });
  return { objects: [leg(x - w / 2 + 0.3, 'legL'), leg(x, 'legM'), leg(x + w / 2 - 0.3, 'legR'), box(x, -legH - 0.2, w, 0.4, 'stone', 'stoneBlock', { id: 'platform', depth: 1.6 })], ropes: [] };
}

const v1 = level('volcano', 1, { par: 2, ammo: { arrow: 3, fire: 2, heavy: 1 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), drop('rope', 11.6, 2.4, rock('rock', 1, 1), 13.6), lavaPit(14.3, 17)), hintTarget: 'roof' });

// the rival stands on stilts over the lava: two legs must go
const v2 = level('volcano', 2, { par: 2, rivalY: -2.2, ammo: { arrow: 3, fire: 2 }, ...parts(lavaPit(9.6, 14), stilts(11.8, 3.6, 2.2)) });

const v3 = level('volcano', 3, { par: 3, ammo: { arrow: 2, heavy: 3, bomb: 1 }, ...parts(bunker(10.3, 12.9, -3.1, 'stone', WALL), ledge('boulder', 15, 12.2, -5.4, 0.5, 'boulder', D)) });

// tricky: stilts again, and the fire arrows are few
const v4 = level('volcano', 4, { par: 2, rivalY: -2.6, ammo: { arrow: 3, fire: 2, ice: 1 }, ...parts(lavaPit(9.4, 14.2), stilts(11.8, 4.2, 2.6)) });

const v5 = level('volcano', 5, { par: 2, ammo: { arrow: 4, fire: 1 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.95, 5), hut(10.6, 13.2, -3.2, 'wood', WALL), lavaPit(14.3, 17)), rivalX: 11.9 });

const v6 = level('volcano', 6, { par: 3, ammo: { arrow: 2, heavy: 3, ice: 1 }, ...parts(bunker(10.3, 12.9, -3.2, 'stone', WALL), drop('rope', 11.6, 2.4, boulder('b', 0, 0, 0.6), 13.6)) });

const v7 = level('volcano', 7, { par: 2, ammo: { arrow: 3, fire: 2, ice: 1 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', D), lavaPit(-6, -2.6)) });

// tricky: stilts with a crate above for good measure
const v8 = level('volcano', 8, { par: 3, rivalY: -2.2, ammo: { arrow: 3, fire: 3 }, ...parts(lavaPit(9.6, 14), stilts(11.8, 3.6, 2.2), drop('crate', 11.8, 1.2, crate(0, 0, 0.8), 14.6, -2.2)) });

// boss: Magmor's obsidian keep
const vBoss = level('volcano', 9, {
  boss: true,
  par: 3,
  ammo: { arrow: 3, fire: 2, heavy: 2, bomb: 1 },
  ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), ledge('boulder', 15.2, 12.2, -5.4, 0.5, 'boulder', D), pendulum('ram', { x: 8.8, y: -7.6 }, 4.6, 0.9, 4.2), lavaPit(14.4, 17.4)),
  rivalLook: 'volcanoBoss',
});

export const VOLCANO: LevelDef[] = [v1, v2, v3, v4, v5, v6, v7, v8, vBoss];
