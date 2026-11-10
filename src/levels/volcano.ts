import { board, boulder, cover, crate, drop, gallows, level, ledge, log, parts, pendulum, playerCrates, playerDrop, playerTnt, pool, rock, shield, stoneWall, swinger, tnt, woodWall, chandelier, type Part } from './kit';
import type { LevelDef, TerrainDef } from './types';

/**
 * Volcano: lava behind the rival (knocked in: 30 HP and back to the spot), everything wooden burns,
 * swinging loads over the rival, and the sharpest rivals.
 */
const D = 'dark' as const;
const pCrate = playerDrop(crate(0, 0, 0.8));

/** Ground with a lava pit from x0 to x1. */
function lavaPit(x0: number, x1: number): Part {
  const t: TerrainDef = {
    surface: D,
    points: [{ x: -10, y: 0 }, { x: x0, y: 0 }, { x: x0, y: 1.8 }, { x: x1, y: 1.8 }, { x: x1, y: 0 }, { x: 26, y: 0 }, { x: 26, y: 8 }, { x: -10, y: 8 }],
  };
  return { terrain: [t], objects: [], ropes: [], lava: [pool(x0, x1, 0.6, 1.2)] };
}

const v1 = level('volcano', 1, { ammo: { fire: 1, heavy: 2 }, ...parts(lavaPit(12.9, 16), drop('rope', 11.6, 1.6, rock('rock', 0.9, 0.8), 12.5), cover(...stoneWall(9.6, 2)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const v2 = level('volcano', 2, { ammo: { fire: 2, bomb: 1 }, ...parts(lavaPit(12.9, 16), cover(tnt(10.9, 0, 'tnt'), woodWall(10.1, 1.7)), playerCrates(), playerTnt()), rivalTargets: ['pTnt'], rivalAmmo: ['fire'] });

const v3 = level('volcano', 3, { ammo: { fire: 1, heavy: 1, bomb: 1 }, ...parts(ledge('boulder', 15, 12.2, -5.4, 0.5, 'boulder', D), cover(...stoneWall(10.1, 2), ...shield(9.4)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// tricky: a swinging chandelier, and lava behind the rival
const v4 = level('volcano', 4, {
  ammo: { fire: 1, heavy: 2 },
  ...parts(lavaPit(12.9, 16), cover(...gallows(12.5, 0, 7.6, -0.9)), swinger('swing', { x: 11.6, y: -7.4 }, 3, chandelier('chandelier'), 2.4), cover(...stoneWall(9.6, 2)), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire', 'fire'],
});

const v5 = level('volcano', 5, { ammo: { fire: 2, heavy: 1 }, ...parts(pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), lavaPit(13.6, 16.5), cover(woodWall(9.8, 1.7)), playerCrates(), playerDrop(rock('x', 0.8, 0.7))), rivalX: 11.9, rivalTargets: ['pRope'] });

const v6 = level('volcano', 6, { ammo: { fire: 1, heavy: 2, bomb: 1 }, ...parts(lavaPit(12.9, 16), drop('rope', 11.6, 1.6, boulder('b', 0, 0, 0.55), 12.5), cover(...shield(10.6), ...stoneWall(9.6, 2)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// a swinging log, a barrel, and the lava
const v7 = level('volcano', 7, {
  ammo: { fire: 2, heavy: 1 },
  ...parts(lavaPit(12.9, 16), cover(...gallows(12.5, 0, 7.6, -0.9)), swinger('swing', { x: 11.6, y: -7.4 }, 3, log('swingLog', 0, 0, 0.6), 2.2, 'rope'), cover(tnt(10.9, 0, 'tnt'), ...stoneWall(9.6, 2)), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

// tricky: the boulder's stopper hides behind a shield, the rival behind stone
const v8 = level('volcano', 8, { ammo: { fire: 1, heavy: 2, bomb: 1 }, ...parts(ledge('boulder', 15, 12.2, -5.4, 0.5, 'boulder', D), cover(board(12.05, -6.1, 1.2, 'stopShield'), ...stoneWall(10.1, 2), ...shield(9.4)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// boss: Magmor throws bombs every other turn
const vBoss = level('volcano', 9, {
  boss: true,
  rivalHp: 220,
  ammo: { fire: 2, heavy: 2, bomb: 1 },
  ...parts(lavaPit(12.9, 16), drop('rope', 11.6, 1.6, rock('rock', 0.9, 0.8), 12.5), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...stoneWall(9.6, 2)), playerCrates(), playerTnt()),
  rivalLook: 'volcanoBoss',
  rivalWeapon: 'bomb',
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

export const VOLCANO: LevelDef[] = [v1, v2, v3, v4, v5, v6, v7, v8, vBoss];
