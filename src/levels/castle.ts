import { block, box, bunker, chandelier, crate, drop, flat, hut, level, parts, pendulum, rock, tnt, tower, type Part } from './kit';
import type { LevelDef, ObjDef } from './types';

/** Castle: chandeliers and stone. Heavy bolts crack stone roofs (two hits) and push hard. */
const S = 'stone' as const;
const WALL = 'castleWall' as const;
const rampart: Part = { terrain: [flat(S), block(S, -10, 3.4, -1.6, 0.3)], objects: [], ropes: [] };
const P = { playerY: -1.6 };

/** A chandelier hanging on a chain from a castle beam carried by a tower. */
function chand(id: string, x: number, beamY: number, len: number, towerX = 14.2): Part {
  const c = chandelier(id) as ObjDef & { h: number };
  return {
    objects: [
      box((x + towerX) / 2, beamY - 0.3, Math.abs(towerX - x) + 1.4, 0.6, 'stone', 'castleBeam', { fixed: true, depth: 1.6 }),
      box(towerX, (beamY - 0.6) / 2, 1.2, -beamY + 0.6, 'stone', 'castleTower', { fixed: true, depth: 1.8 }),
      { ...c, x, y: beamY + len + 0.25 } as ObjDef,
    ],
    ropes: [{ id: `${id}-chain`, anchor: { x, y: beamY }, body: id, local: { x: 0, y: -0.2 }, kind: 'chain' }],
  };
}

const c1 = level('castle', 1, { par: 2, ...P, ammo: { arrow: 3, fire: 2 }, ...parts(rampart, bunker(10.3, 12.9, -3.1, 'wood', WALL), chand('chandelier', 11.6, -7.2, 2)), hintTarget: 'roof' });

const c2 = level('castle', 2, {
  par: 3,
  ...P,
  ammo: { arrow: 3, heavy: 3 },
  ...parts(rampart, bunker(10.3, 12.9, -3.1, 'stone', WALL), chand('chandelier', 11.6, -7.4, 2.2)),
  hintTarget: 'roof',
});

const c3 = level('castle', 3, {
  par: 2,
  ...P,
  ammo: { arrow: 3, fire: 2, heavy: 1 },
  ...parts(rampart, bunker(10.3, 12.9, -3.1, 'wood', WALL), drop('rope', 11.6, 2.6, rock('rock', 1.1, 0.9), 13.6), drop('crateP', 1.6, 1, crate(0, 0, 0.8), -0.6, -1.6)),
  rivalTargets: ['crateP'],
});

// tricky: two heavy bolts crack the stone roof, then the chain
const c4 = level('castle', 4, { par: 3, ...P, ammo: { arrow: 2, heavy: 3 }, ...parts(rampart, bunker(10.4, 13, -3.3, 'stone', WALL, 0, 0.9), chand('chandelier', 11.7, -7.6, 2.1)) });

const c5 = level('castle', 5, {
  par: 2,
  ...P,
  ammo: { arrow: 3, fire: 2, heavy: 1 },
  ...parts(rampart, bunker(10.2, 12.8, -3.1, 'wood', WALL), chand('chandelier', 11.5, -7.2, 1.9), { objects: [tnt(3, -1.6, 'tntP')], ropes: [] }),
  rivalTargets: ['tntP'],
  rivalAmmo: ['fire'],
});

// a stone door: two heavy bolts crack it, then the ram
const c6 = level('castle', 6, { par: 3, ...P, ammo: { arrow: 3, heavy: 3 }, ...parts(rampart, pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.95, 5), hut(10.6, 13.2, -3.2, 'stone', WALL)), rivalX: 11.9 });

const c7 = level('castle', 7, { par: 3, ...P, ammo: { arrow: 3, fire: 1, heavy: 3 }, ...parts(rampart, bunker(10.3, 12.9, -3.2, 'stone', WALL), drop('gate', 11.6, 2.2, box(0, 0, 1.6, 1, 'metal', 'stoneBlock', { id: 'gate' }), 13.6, 0, 'chain')) });

// tricky: fire for the roof, then a chandelier and a falling stone tower
const c8 = level('castle', 8, {
  par: 3,
  ...P,
  ammo: { arrow: 3, fire: 1, heavy: 2 },
  ...parts(rampart, bunker(10.3, 12.9, -3.1, 'wood', WALL), chand('chandelier', 11.6, -7.4, 2.4, 14.6), tower(9.1, 0, 4, 'stone', 0.7, 0.8, 'st')),
});

// boss: Sir Ironclad in the throne room
const cBoss = level('castle', 9, {
  boss: true,
  par: 3,
  ...P,
  ammo: { arrow: 3, fire: 2, heavy: 2 },
  ...parts(rampart, bunker(10.3, 12.9, -3.2, 'wood', WALL), chand('chandelier', 11.6, -7.6, 2.3), pendulum('ram', { x: 8.6, y: -7.4 }, 4.4, 0.9, 4.6, 0, 0.7)),
  rivalLook: 'castleBoss',
});

export const CASTLE: LevelDef[] = [c1, c2, c3, c4, c5, c6, c7, c8, cBoss];
