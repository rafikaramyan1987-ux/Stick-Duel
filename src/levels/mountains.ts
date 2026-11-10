import { boulder, bunker, drop, hut, level, ledge, parts, pendulum, rock, tnt } from './kit';
import type { LevelDef } from './types';

/** Mountains: boulders on ledges, wind (arrows drift; the aim guide shows it). Bombs unlock. */
const G = 'grass' as const;
const WALL = 'stoneBlock' as const;

// a boulder rolls off the cliff onto the roof; burn the roof first
const m1 = level('mountains', 1, { par: 2, wind: 1.2, ammo: { arrow: 3, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', G)), hintTarget: 'roof' });

const m2 = level('mountains', 2, { par: 2, wind: -1.5, ammo: { arrow: 4, fire: 1 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.95, 5), hut(10.6, 13.2, -3.2, 'wood', WALL)), rivalX: 11.9 });

const m3 = level('mountains', 3, { par: 3, wind: 2, ammo: { arrow: 2, heavy: 3, bomb: 1 }, ...parts(bunker(10.3, 12.9, -3.1, 'stone', WALL), ledge('boulder', 15, 12.2, -5.4, 0.5, 'boulder', G)) });

// tricky: strong head wind
const m4 = level('mountains', 4, { par: 2, wind: -3, ammo: { arrow: 4, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.2, 'wood', WALL), drop('rope', 11.6, 2.4, rock('rock', 1, 1), 13.6)) });

const m5 = level('mountains', 5, {
  par: 3,
  wind: 1.5,
  ammo: { arrow: 3, heavy: 3, bomb: 1 },
  ...parts(bunker(10.3, 12.9, -3.1, 'stone', WALL), ledge('boulder', 15.2, 12.3, -5.6, 0.5, 'boulder', G), { objects: [tnt(3.2, 0, 'tntP')], ropes: [] }),
  rivalTargets: ['tntP'],
  rivalAmmo: ['fire'],
});

const m6 = level('mountains', 6, { par: 3, wind: -2, ammo: { arrow: 3, heavy: 3, bomb: 1 }, ...parts(bunker(10.3, 12.9, -3.2, 'stone', WALL), drop('rope', 11.6, 2.4, boulder('b', 0, 0, 0.6), 13.6)) });

const m7 = level('mountains', 7, { par: 2, wind: 2.5, ammo: { arrow: 4, fire: 1 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.9, 5), hut(10.6, 13.2, -3.2, 'wood', WALL)), rivalX: 11.9 });

// tricky: burn the roof, let the boulder roll, then swing the ram through the gap
const m8 = level('mountains', 8, { par: 3, wind: -2.5, ammo: { arrow: 4, fire: 2, bomb: 1 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', G), pendulum('ram', { x: 8.8, y: -7.6 }, 4.6, 0.9, 4.2)) });

// boss: Jarl Stormbeard's summit hut
const mBoss = level('mountains', 9, {
  boss: true,
  par: 3,
  wind: 2,
  ammo: { arrow: 4, fire: 2, heavy: 1 },
  ...parts(bunker(10.3, 12.9, -3.2, 'wood', WALL), ledge('boulder', 15.2, 12.2, -5.6, 0.5, 'boulder', G), pendulum('ram', { x: 8.8, y: -7.6 }, 4.6, 0.9, 4.2)),
  rivalLook: 'mountainsBoss',
});

export const MOUNTAINS: LevelDef[] = [m1, m2, m3, m4, m5, m6, m7, m8, mBoss];
