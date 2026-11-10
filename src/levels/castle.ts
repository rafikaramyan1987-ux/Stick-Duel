import { box, chandelier, cover, crate, crateStack, drop, level, parts, pendulum, playerCrates, playerDrop, playerTnt, rock, shield, stoneWall, swinger, tower, woodWall, type Part } from './kit';
import type { LevelDef, ObjDef } from './types';

/**
 * Castle: stone cover (arrows chip it, heavy bolts crack and push it), chandeliers on chains, and
 * from here on the rival also shoots at the traps over the player's head.
 */

/** A chandelier hanging on a chain from a castle beam carried by a tower behind the rival. */
function chand(id: string, x: number, beamY: number, len: number, towerX = 14.2, swing = 0): Part {
  const c = chandelier(id) as ObjDef;
  const beam: ObjDef[] = [
    box((x + towerX) / 2, beamY - 0.3, Math.abs(towerX - x) + 1.4, 0.6, 'stone', 'castleBeam', { fixed: true, depth: 1.6 }),
    box(towerX, (beamY - 0.6) / 2, 1.2, -beamY + 0.6, 'stone', 'castleTower', { fixed: true, depth: 1.8 }),
  ];
  if (swing) {
    const s = swinger(`${id}-chain`, { x, y: beamY }, len, c, swing);
    return { objects: [...beam, ...s.objects], ropes: s.ropes };
  }
  return {
    objects: [...beam, { ...c, x, y: beamY + len + 0.25 } as ObjDef],
    ropes: [{ id: `${id}-chain`, anchor: { x, y: beamY }, body: id, local: { x: 0, y: -0.2 }, kind: 'chain' }],
  };
}

const pCrate = playerDrop(crate(0, 0, 0.8));

const c1 = level('castle', 1, { ammo: { heavy: 2 }, ...parts(cover(...stoneWall(10.1, 2)), chand('chandelier', 11.6, -7, 2.4), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const c2 = level('castle', 2, { ammo: { heavy: 2 }, ...parts(cover(...shield(10.3), woodWall(9.7, 1.5)), chand('chandelier', 11.6, -7.2, 2.5), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// a tall wall: break it with heavy bolts, or lob over it
const c3 = level('castle', 3, { ammo: { heavy: 3 }, ...parts(cover(...stoneWall(10.1, 3)), chand('chandelier', 11.6, -7.6, 2.6), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// tricky: the chain hides behind a shield up on the beam; a barrel by the player
const c4 = level('castle', 4, {
  ammo: { heavy: 2, fire: 1 },
  ...parts(chand('chandelier', 11.6, -7.4, 2.3), cover(...shield(10.6, 0, 'chainShield', 7.2, 1.4), ...stoneWall(10, 2)), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

// a moving target: the chandelier swings over the rival
const c5 = level('castle', 5, { ammo: { heavy: 2 }, ...parts(chand('chandelier', 11.6, -7.6, 2.6, 14.2, 2.4), cover(...stoneWall(10.1, 2), woodWall(9.4, 1.2)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// the ram swings in once its hold rope is cut
const c6 = level('castle', 6, { ammo: { heavy: 3 }, ...parts(pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...stoneWall(9.8, 2)), playerCrates(), pCrate), rivalX: 11.9, rivalTargets: ['pRope'] });

const c7 = level('castle', 7, {
  ammo: { heavy: 2, fire: 1 },
  ...parts(drop('rope', 11.6, 1.5, rock('rock', 1, 0.9), 13.6, 0, 'chain'), cover(...shield(10.4), ...stoneWall(9.8, 2)), playerCrates(), playerDrop(rock('x', 0.8, 0.7), 1.3)),
  rivalTargets: ['pRope'],
});

// tricky: a stone tower next to the rival topples under heavy bolts; a swinging chandelier above
const c8 = level('castle', 8, {
  ammo: { heavy: 3 },
  ...parts(tower(10.4, 0, 3, 'stone', 0.8, 0.85, 'st'), chand('chandelier', 11.8, -7.8, 2.8, 14.4, 2), cover(...shield(9.6)), playerCrates(), playerTnt()),
  rivalX: 11.8,
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire', 'fire'],
});

// boss: Sir Ironclad fires heavy bolts every other turn
const cBoss = level('castle', 9, {
  boss: true,
  rivalHp: 180,
  ammo: { heavy: 3, fire: 1 },
  ...parts(chand('chandelier', 11.6, -7.6, 2.4, 14.2, 1.8), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(...stoneWall(10.1, 2)), { objects: [...crateStack(2.7, 2, 0, 'pc'), ...crateStack(3.5, 1, 0, 'pc2')], ropes: [] }, pCrate),
  rivalLook: 'castleBoss',
  rivalWeapon: 'heavy',
  rivalTargets: ['pRope'],
});

export const CASTLE: LevelDef[] = [c1, c2, c3, c4, c5, c6, c7, c8, cBoss];
