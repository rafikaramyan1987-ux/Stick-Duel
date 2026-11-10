import { board, crateStack, drop, level, log, parts, pendulum, rock, shield, slopeLog, tnt, woodWall, type Part } from './kit';
import type { LevelDef } from './types';

/**
 * Forest: the first duels. Level 1 teaches shooting (no cover), level 2 cover (it wears down under
 * arrows), level 3 the first easy trap (a rock on a rope over the rival). From level 4 on the traps
 * need precision (a thin rope behind cover) or two steps (burn the wall, then cut the rope).
 */
const G = 'grass' as const;
const cover = (...objects: Part['objects']): Part => ({ objects, ropes: [] });

const f1 = level('forest', 1, { ammo: {}, objects: [], hintTarget: 'rival' });

const f2 = level('forest', 2, { ammo: {}, ...parts(cover(woodWall(10.2, 1.7), ...crateStack(2.7, 2))), hintTarget: 'cover' });

const f3 = level('forest', 3, {
  ammo: {},
  ...parts(cover(woodWall(10.2, 1.6), ...crateStack(2.7, 2)), drop('rope', 11.6, 1.2, rock('rock', 1.1, 0.9), 13.4)),
  hintTarget: 'rope',
});

/* ---------- from here on: traps need precision or two steps ---------- */

// tricky: the log's rope is high up behind a shield; cover on both sides
const f4 = level('forest', 4, {
  ammo: {},
  ...parts(slopeLog('log', 'rope', 10.7, 6.6, 5.2, -3.6, G, 0.8, 0.24), cover(board(5.0, -4.3, 1.3, 'ropeShield'), ...crateStack(11.2, 2, 0, 'rc'), ...crateStack(2.7, 2))),
  rivalX: 12.1,
});

// fire arrows: the barrel next to the rival only goes off with fire
const f5 = level('forest', 5, { ammo: { fire: 2 }, ...parts(cover(woodWall(10.1, 1.7), tnt(12.8, 0, 'tnt'), ...crateStack(2.7, 2))) });

// the ram swings in once its hold rope is cut (a thin target low behind the wall)
const f6 = level('forest', 6, { ammo: { fire: 1 }, ...parts(pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(woodWall(9.8, 1.7), ...crateStack(2.7, 2))), rivalX: 11.9 });

// two steps: burn the wooden lid over the rope, then cut it
const f7 = level('forest', 7, {
  ammo: { fire: 2 },
  ...parts(drop('rope', 11.6, 1.6, log('log', 0, 0, 0.6), 13.6), cover(...shield(10.9, 0, 'lid', 6.4, 1.5), woodWall(10.1, 1.8), ...crateStack(2.7, 2), ...crateStack(3.5, 1))),
});

// tricky: a rock behind a shield and a barrel behind a wall
const f8 = level('forest', 8, {
  ammo: { fire: 1 },
  ...parts(drop('rope', 11.8, 1.4, rock('rock', 1, 0.9), 13.6), cover(...shield(10.4, 0, 'shield', 3.4, 1.1), woodWall(9.9, 1.6), tnt(13.3, 0, 'tnt'), ...crateStack(2.7, 2))),
  rivalX: 11.8,
});

// boss: Oakheart (volley of three arrows), a trunk over his head and the ram
const fBoss = level('forest', 9, {
  boss: true,
  rivalHp: 160,
  ammo: { fire: 2 },
  ...parts(drop('trunk', 11.6, 1.6, log('trunk', 0, 0, 0.7), 13.6), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), cover(woodWall(10, 1.8), ...crateStack(2.7, 2))),
  rivalLook: 'forestBoss',
  rivalWeapon: 'volley',
});

export const FOREST: LevelDef[] = [f1, f2, f3, f4, f5, f6, f7, f8, fBoss];
