import { bunker, drop, hut, level, log, parts, pendulum, post, rock, slopeLog, tnt } from './kit';
import type { LevelDef } from './types';

/**
 * Forest: ropes and logs. Levels 1–3 have one obvious solution (par 1). From level 4 on the rival
 * is protected: a roof that only fire removes, or two hazards that are each too weak alone
 * (HP tuned in src/levels/tuning.ts). The level checker proves both.
 */
const G = 'grass' as const;
const WALL = 'post' as const;

const f1 = level('forest', 1, { par: 1, ammo: { arrow: 5 }, ...parts(slopeLog('log', 'rope', 10.6, 6.2, 4.8, -3.6, G, 0.9, 0.22)), hintTarget: 'rope' });

const f2 = level('forest', 2, {
  par: 1,
  ammo: { arrow: 5 },
  ...parts(drop('rope', 11.6, 2.2, rock('rock', 1, 1), 13.3), { objects: [post(9.8, 0, 2.6)], ropes: [] }),
  hintTarget: 'rope',
});

const f3 = level('forest', 3, { par: 1, ammo: { arrow: 5 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5, 1.05, 5)), hintTarget: 'ram-hold' });

/* ---------- from here on: par 2 or more ---------- */

// tricky: the log above the roof is useless until fire takes the roof away
const f4 = level('forest', 4, { par: 2, ammo: { arrow: 4, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), drop('rope', 11.6, 2.2, log('log', 0, 0, 0.65), 13.6)), hintTarget: 'roof' });

// the ram swings into the hut's wooden door: burn the door, then release the ram
const f5 = level('forest', 5, { par: 2, ammo: { arrow: 4, fire: 1 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.95, 5), hut(10.6, 13.2, -3.2, 'wood', WALL)), rivalX: 11.9 });

const f6 = level('forest', 6, {
  par: 2,
  ammo: { arrow: 4, fire: 2 },
  ...parts(bunker(10.3, 12.9, -3.2, 'wood', WALL), drop('rope', 11.6, 2.6, rock('rock', 1, 1), 13.6), { objects: [tnt(3.3, 0, 'tntPlayer')], ropes: [] }),
  rivalTargets: ['tntPlayer'],
  rivalAmmo: ['fire'],
});

// a stone door this time: heavy bolts crack it, then the log can roll in
const f7 = level('forest', 7, { par: 3, ammo: { arrow: 3, heavy: 3 }, ...parts(slopeLog('log', 'rope', 10.4, 7.2, 5.8, -3.4, G, 0.75, 0.25), hut(10.9, 13.5, -3.2, 'stone', WALL)), rivalX: 12.2 });

// tricky: burn the roof, drop the log, then swing the ram
const f8 = level('forest', 8, {
  par: 3,
  rivalX: 11.9,
  ammo: { arrow: 4, fire: 2 },
  ...parts(pendulum('ram', { x: 9.4, y: -7.8 }, 5, 0.95, 4.4), bunker(10.6, 13.2, -3.1, 'wood', WALL, 0, 1.6), drop('rope', 11.9, 2.4, log('log', 0, 0, 0.6), 13.9)),
});

// boss: Oakheart in his treehouse bunker
const fBoss = level('forest', 9, {
  boss: true,
  par: 3,
  ammo: { arrow: 5, fire: 2 },
  ...parts(bunker(10.3, 12.9, -3.2, 'wood', WALL), drop('trunk', 11.6, 2.4, log('trunk', 0, 0, 0.75), 13.6), pendulum('ram', { x: 8.8, y: -7.6 }, 4.6, 0.9, 4.2)),
  rivalLook: 'forestBoss',
});

export const FOREST: LevelDef[] = [f1, f2, f3, f4, f5, f6, f7, f8, fBoss];
