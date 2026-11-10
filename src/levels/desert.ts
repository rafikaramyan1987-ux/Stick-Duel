import { bunker, drop, hut, level, ledge, parts, pendulum, rock, sand, tnt, type Part } from './kit';
import type { LevelDef } from './types';

/** Desert: sand that crumbles under heavy bolts, explosive barrels. */
const S = 'sand' as const;
const WALL = 'sandstone' as const;

/**
 * A bunker with a TNT barrel hanging over its roof and sand piles in front. Dropped on the roof, the
 * barrel only singes the rival through it; open the roof first and it lands right on him.
 */
function sandFort(roof: 'stone' | 'wood' = 'wood'): Part {
  return parts(
    bunker(10.3, 12.9, -3.1, roof, WALL),
    drop('tntRope', 11.6, 2.6, tnt(0, 0, 'tntHang'), 13.6),
    { objects: [sand(9.2, 0, 0.8, 0.8, 's0'), sand(9.2, -0.8, 0.8, 0.8, 's1'), sand(8.4, 0, 0.8, 0.8, 's2')], ropes: [] },
  );
}

const d1 = level('desert', 1, { par: 2, ammo: { arrow: 3, fire: 2 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), drop('rope', 11.6, 2.4, rock('rock', 1, 1), 13.6), { objects: [tnt(3.3, 0, 'tntP')], ropes: [] }), rivalTargets: ['tntP'], rivalAmmo: ['fire'], hintTarget: 'roof' });

const d2 = level('desert', 2, { par: 2, ammo: { arrow: 3, fire: 2 }, ...parts(sandFort()) });

const d3 = level('desert', 3, { par: 2, ammo: { arrow: 4, fire: 1 }, ...parts(pendulum('ram', { x: 10.3, y: -7.6 }, 5.6, 0.95, 5), hut(10.6, 13.2, -3.2, 'wood', WALL)), rivalX: 11.9 });

// tricky: only one fire arrow, and the sand piles block the flat shots
const d4 = level('desert', 4, { par: 2, ammo: { arrow: 3, fire: 1 }, ...parts(sandFort()) });

const d5 = level('desert', 5, { par: 2, ammo: { arrow: 3, fire: 2, heavy: 1 }, ...parts(bunker(10.3, 12.9, -3.1, 'wood', WALL), ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', S)) });

const d6 = level('desert', 6, { par: 3, ammo: { arrow: 2, heavy: 3, bomb: 1 }, ...parts(bunker(10.3, 12.9, -3.2, 'stone', WALL), drop('rope', 11.6, 2.4, rock('rock', 1, 1), 13.6)) });

const d7 = level('desert', 7, { par: 2, ammo: { arrow: 3, fire: 2 }, ...parts(sandFort(), { objects: [tnt(3.2, 0, 'tntP')], ropes: [] }), rivalTargets: ['tntP'], rivalAmmo: ['fire'] });

// tricky: a stone roof this time: two heavy bolts, then the barrel
const d8 = level('desert', 8, { par: 3, ammo: { arrow: 3, heavy: 3 }, ...parts(sandFort('stone')) });

// boss: the Sand King's fortress
const dBoss = level('desert', 9, { boss: true, par: 3, ammo: { arrow: 3, fire: 2 }, ...parts(sandFort(), pendulum('ram', { x: 8.8, y: -7.6 }, 4.6, 0.9, 4.2)), rivalLook: 'desertBoss' });

export const DESERT: LevelDef[] = [d1, d2, d3, d4, d5, d6, d7, d8, dBoss];
