import { crateStack, board, gallows, boulder, cover, drop, level, ledge, parts, pendulum, playerCrates, playerDrop, playerTnt, rock, shield, slopeLog, stoneWall, swinger, log, woodWall, crate } from './kit';
import type { LevelDef } from './types';

/**
 * Mountains: wind bends every arrow (the dotted guide shows it), boulders held on ledges by a
 * wooden stopper (two arrows, one fire arrow or a bomb free them), bombs unlock.
 */
const G = 'grass' as const;
const pCrate = playerDrop(crate(0, 0, 0.8));

const m1 = level('mountains', 1, { wind: 1.2, ammo: { bomb: 1 }, ...parts(ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', G), cover(...stoneWall(10.1, 2)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const m2 = level('mountains', 2, { wind: -1.5, ammo: { bomb: 1, fire: 1 }, ...parts(slopeLog('log', 'rope', 10.7, 6.6, 5.2, -3.6, G, 0.8, 0.24), cover(...crateStack(11.2, 2, 0, 'rc')), playerCrates(), pCrate), rivalX: 12.1, rivalTargets: ['pRope'] });

const m3 = level('mountains', 3, { wind: 2, ammo: { bomb: 1, heavy: 1 }, ...parts(drop('rope', 11.6, 1.6, boulder('b', 0, 0, 0.6), 13.6), cover(...shield(10.4), ...stoneWall(9.8, 2)), playerCrates(), playerTnt()), rivalTargets: ['pTnt'], rivalAmmo: ['fire'] });

// tricky: a strong head wind, and the stopper hides behind a shield
const m4 = level('mountains', 4, { wind: -3, ammo: { bomb: 1, fire: 1 }, ...parts(ledge('boulder', 15, 12.2, -5.4, 0.5, 'boulder', G), cover(board(12.05, -5.9, 1.2, 'stopShield'), ...stoneWall(10.1, 2)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// a moving target: a log swinging on a rope over the rival
const m5 = level('mountains', 5, {
  wind: 1.5,
  ammo: { bomb: 1, heavy: 1 },
  ...parts(swinger('swing', { x: 11.6, y: -7.4 }, 3, log('swingLog', 0, 0, 0.6), 2.2, 'rope'), cover(...gallows(13.6, 0, 7.6, -2.2)), cover(...stoneWall(10.1, 2)), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

const m6 = level('mountains', 6, { wind: -2, ammo: { bomb: 1, heavy: 2 }, ...parts(pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...stoneWall(9.8, 2), ...shield(10.8)), playerCrates(), pCrate), rivalX: 11.9, rivalTargets: ['pRope'] });

const m7 = level('mountains', 7, { wind: 2.5, ammo: { bomb: 1, fire: 1 }, ...parts(ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', G), drop('rope', 11.6, 1.6, rock('rock', 0.9, 0.8), 13.4), cover(woodWall(10.1, 1.7)), playerCrates(), playerDrop(rock('x', 0.8, 0.7))), rivalTargets: ['pRope'] });

// tricky: a gusty wind and two hazards, each behind cover
const m8 = level('mountains', 8, {
  wind: -2.5,
  ammo: { bomb: 2, fire: 1 },
  ...parts(ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', G), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...shield(10.6), ...stoneWall(10, 2)), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

// boss: Jarl Stormbeard throws bombs every other turn, in a cross wind
const mBoss = level('mountains', 9, {
  boss: true,
  rivalHp: 190,
  wind: 2,
  ammo: { bomb: 2, fire: 1, heavy: 1 },
  ...parts(ledge('boulder', 15.2, 12.2, -5.6, 0.5, 'boulder', G), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...stoneWall(10.1, 2)), playerCrates(), pCrate),
  rivalLook: 'mountainsBoss',
  rivalWeapon: 'bomb',
  rivalTargets: ['pRope'],
});

export const MOUNTAINS: LevelDef[] = [m1, m2, m3, m4, m5, m6, m7, m8, mBoss];
