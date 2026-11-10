import { board, box, boulder, cover, crate, drop, icePillar, level, log, parts, pendulum, playerCrates, playerDrop, playerTnt, pool, rock, shield, stoneWall, swinger, gallows, woodWall, type Part } from './kit';
import type { LevelDef, ObjDef, RopeDef } from './types';

/**
 * Frozen Lake: ice arrows unlock (they freeze water into a bridge and make bodies slide), heavy
 * things stand on ice pillars that shatter, and a fighter knocked into the lake loses HP.
 */
const W = 'snow' as const;
const pCrate = playerDrop(crate(0, 0, 0.8));

/** The lake behind the rival: a heavy bolt or a falling block knocks the rival in. */
function lakeBehind(x0 = 12.9, x1 = 16): Part {
  return {
    terrain: [{ surface: W, points: [{ x: -10, y: 0 }, { x: x0, y: 0 }, { x: x0, y: 1.6 }, { x: x1, y: 1.6 }, { x: x1, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }] }],
    objects: [],
    ropes: [],
    water: [pool(x0, x1, 0.15, 1.45)],
  };
}

/** A snow ramp on the left of the rival with a log tied at the top; a pond in the way until frozen. */
function rampPond(): Part {
  const pts = [{ x: -10, y: 0 }, { x: 4.6, y: 0 }, { x: 4.6, y: -2.6 }, { x: 6, y: -2.6 }, { x: 8.6, y: 0 }, { x: 8.6, y: 1.6 }, { x: 9.8, y: 1.6 }, { x: 9.8, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }];
  const objects: ObjDef[] = [log('log', 6.9, -1.95, 0.65), box(5.5, -3.2, 0.3, 1.2, 'wood', 'post', { fixed: true, depth: 0.4 })];
  const ropes: RopeDef[] = [{ id: 'rope', anchor: { x: 5.5, y: -3.7 }, body: 'log' }];
  return { terrain: [{ surface: W, points: pts }], objects, ropes, water: [pool(8.6, 9.8, 0.15, 1.45)] };
}

/** A shelf high on the right with a stone block; an ice arrow makes it slide off onto the rival. */
function iceShelf(id: string, y: number): Part {
  return {
    terrain: [{ surface: W, points: [{ x: 16.5, y }, { x: 12.1, y: y + 1.5 }, { x: 12.5, y: 0.3 }, { x: 16.5, y: 0.3 }] }],
    objects: [box(13.4, y + 1.06 - 0.6, 1.1, 1.1, 'stone', 'stoneBlock', { id, angle: Math.atan2(1.5, -4.4) })],
    ropes: [],
  };
}

const z1 = level('frozen', 1, { ammo: { ice: 2, heavy: 1 }, ...parts(lakeBehind(), cover(...icePillar('pillarRock', 10.6, 0, 1.8, rock('r', 0.9, 0.8)), woodWall(9.9, 1.6)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const z2 = level('frozen', 2, { ammo: { ice: 2, fire: 1 }, ...parts(iceShelf('block', -5.4), cover(...stoneWall(10.1, 2)), playerCrates(), playerTnt()), rivalTargets: ['pTnt'], rivalAmmo: ['fire'] });

const z3 = level('frozen', 3, { ammo: { ice: 1, heavy: 1 }, ...parts(lakeBehind(), drop('rope', 11.6, 1.6, rock('rock', 0.9, 0.8), 12.5), cover(...shield(10.6), woodWall(9.6, 1.4)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// tricky: the log stops at the pond… unless it is ice
const z4 = level('frozen', 4, { ammo: { ice: 1, heavy: 1 }, ...parts(rampPond(), cover(...stoneWall(11, 2)), playerCrates(), pCrate), rivalX: 11.9, rivalTargets: ['pRope'] });

// a moving target: a block of ice swings over the rival
const z5 = level('frozen', 5, {
  ammo: { ice: 1, heavy: 2 },
  ...parts(lakeBehind(), cover(...gallows(12.5, 0, 7.4, -0.9)), swinger('swing', { x: 11.6, y: -7.2 }, 3, box(0, 0, 0.9, 0.9, 'ice', 'iceBlock', { hp: 999 }), 2.2, 'rope'), cover(...stoneWall(9.6, 2)), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

const z6 = level('frozen', 6, { ammo: { ice: 2, heavy: 2 }, ...parts(iceShelf('block', -5.6), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...shield(10.6)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const z7 = level('frozen', 7, {
  ammo: { ice: 1, fire: 1, heavy: 1 },
  ...parts(lakeBehind(), cover(...icePillar('pillarRock', 10.8, 0, 2, boulder('pb', 0, 0, 0.5)), woodWall(10.1, 1.7)), playerCrates(), playerDrop(rock('x', 0.8, 0.7))),
  rivalTargets: ['pRope'],
});

// tricky: freeze the block on the shelf, behind a shield up high
const z8 = level('frozen', 8, { ammo: { ice: 1, fire: 1, heavy: 2 }, ...parts(iceShelf('block', -5.4), cover(board(12.3, -5.0, 1.2, 'shelfShield'), ...stoneWall(10.1, 2)), playerCrates(), playerTnt()), rivalTargets: ['pTnt'], rivalAmmo: ['fire'] });

// boss: Frostfang shoots three arrows at once
const zBoss = level('frozen', 9, {
  boss: true,
  rivalHp: 220,
  ammo: { ice: 2, fire: 1, heavy: 2 },
  ...parts(iceShelf('block', -5.5), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...stoneWall(10.1, 2)), playerCrates(), pCrate),
  rivalLook: 'frozenBoss',
  rivalWeapon: 'volley',
  rivalTargets: ['pRope'],
});

export const FROZEN: LevelDef[] = [z1, z2, z3, z4, z5, z6, z7, z8, zBoss];
