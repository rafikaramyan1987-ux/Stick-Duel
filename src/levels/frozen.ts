import { box, bunker, crate, drop, hut, level, log, parts, pendulum, pool, rock, type Part } from './kit';
import type { LevelDef, ObjDef, RopeDef } from './types';

/**
 * Frozen Lake: water you can freeze into a bridge with ice arrows, slippery blocks (an ice arrow
 * makes a body slide). Falling into the lake is a splash-out.
 */
const W = 'snow' as const;
const WALL = 'iceBlock' as const;

/** A snow ramp on the left with a log tied at the top; it rolls right, but a pond is in the way. */
function rampPond(withPond = true): Part & { water: ReturnType<typeof pool>[] } {
  const pts = withPond
    ? [{ x: -10, y: 0 }, { x: 3.8, y: 0 }, { x: 3.8, y: -2.6 }, { x: 5.2, y: -2.6 }, { x: 8.4, y: 0 }, { x: 8.4, y: 1.6 }, { x: 10.2, y: 1.6 }, { x: 10.2, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }]
    : [{ x: -10, y: 0 }, { x: 3.8, y: 0 }, { x: 3.8, y: -2.6 }, { x: 5.2, y: -2.6 }, { x: 8.4, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }];
  const objects: ObjDef[] = [log('log', 6.2, -1.95, 0.7), box(4.8, -3.2, 0.3, 1.2, 'wood', 'post', { fixed: true, depth: 0.4 })];
  const ropes: RopeDef[] = [{ id: 'rope', anchor: { x: 4.8, y: -3.7 }, body: 'log' }];
  return { terrain: [{ surface: W, points: pts }], objects, ropes, water: withPond ? [pool(8.4, 10.2, 0.15, 1.45)] : [] };
}

/** A shelf high on the right with a stone block that slides off when frozen. */
function iceShelf(id: string, y: number): Part {
  return {
    terrain: [{ surface: W, points: [{ x: 16.5, y }, { x: 12.1, y: y + 1.5 }, { x: 12.5, y: 0.3 }, { x: 16.5, y: 0.3 }] }],
    objects: [box(13.4, y + 1.06 - 0.6, 1.1, 1.1, 'stone', 'stoneBlock', { id, angle: Math.atan2(1.5, -4.4) })],
    ropes: [],
  };
}

// freeze the pond so the log can roll across, then cut its rope
const z1 = level('frozen', 1, { par: 2, ammo: { arrow: 3, ice: 2 }, ...parts(rampPond()), playerX: 1.2, hintTarget: 'rope' });

const z2 = level('frozen', 2, { par: 2, ammo: { arrow: 2, ice: 2, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), iceShelf('block', -5.4)), hintTarget: 'roof' });

const z3 = level('frozen', 3, { par: 2, ammo: { arrow: 3, ice: 1, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.2, 'wood', WALL), drop('rope', 11.6, 2.4, rock('rock', 1, 1), 13.6)) });

// tricky: the rope is cut but the log stops at the water… unless it is ice
const z4 = level('frozen', 4, { par: 2, ammo: { arrow: 2, ice: 1, heavy: 1 }, ...parts(rampPond()) });

const z5 = level('frozen', 5, { par: 2, ammo: { arrow: 3, ice: 1, fire: 1 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.95, 5), hut(10.6, 13.2, -3.2, 'wood', WALL)), rivalX: 11.9 });

const z6 = level('frozen', 6, { par: 3, ammo: { arrow: 2, ice: 2, heavy: 3 }, ...parts(bunker(10.3, 12.9, -3.1, 'stone', WALL), iceShelf('block', -5.6)) });

const z7 = level('frozen', 7, { par: 2, ammo: { arrow: 3, ice: 2, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.2, 'wood', WALL), drop('rope', 11.6, 2.6, rock('rock', 1.1, 1), 13.6)) });

// tricky: burn the roof, freeze the block, cut the crate
const z8 = level('frozen', 8, { par: 3, ammo: { arrow: 3, ice: 2, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), iceShelf('block', -5.4), drop('crate', 9.2, 0.8, crate(0, 0, 0.7), 7.8)) });

// boss: Frostfang's ice palace
const zBoss = level('frozen', 9, {
  boss: true,
  par: 3,
  ammo: { arrow: 3, ice: 2, fire: 2, heavy: 1 },
  ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), iceShelf('block', -5.5), pendulum('ram', { x: 8.8, y: -7.6 }, 4.6, 0.9, 4.2)),
  rivalLook: 'frozenBoss',
});

export const FROZEN: LevelDef[] = [z1, z2, z3, z4, z5, z6, z7, z8, zBoss];
