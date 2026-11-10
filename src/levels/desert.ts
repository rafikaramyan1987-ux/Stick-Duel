import { box, cover, drop, gallows, level, ledge, parts, pendulum, playerCrates, playerDrop, playerTnt, rock, sand, shield, stoneWall, swinger, tnt, woodWall, crate, type Part } from './kit';
import type { LevelDef } from './types';

/**
 * Desert: sand walls (they crumble after two arrows), barrels that only fire or a heavy bolt set
 * off, wind again. The rival lights the barrels next to the player.
 */
const S = 'sand' as const;
const sandWall = (x: number, rows: number, prefix: string) => cover(...Array.from({ length: rows }, (_, i) => sand(x, -i * 0.8, 0.8, 0.8, `${prefix}${i}`)));

/** A barrel hanging over the rival from a frame: cut the rope (it drops and bursts) or light it. */
function hangingTnt(x: number, dropH: number): Part {
  return drop('tntRope', x, dropH, tnt(0, 0, 'tntHang'), 13.6);
}

const pCrate = playerDrop(crate(0, 0, 0.8));

const d1 = level('desert', 1, { ammo: { fire: 2 }, ...parts(sandWall(10.1, 2, 's'), cover(tnt(12.9, 0, 'tnt')), playerCrates(), playerTnt()), rivalTargets: ['pTnt'], rivalAmmo: ['fire'] });

const d2 = level('desert', 2, { wind: 1.4, ammo: { fire: 1, heavy: 1 }, ...parts(hangingTnt(11.6, 1.8), sandWall(10.1, 2, 's'), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const d3 = level('desert', 3, { wind: -1.6, ammo: { fire: 1, bomb: 1 }, ...parts(pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), sandWall(9.8, 2, 's'), playerCrates(), playerTnt()), rivalX: 11.9, rivalTargets: ['pTnt'], rivalAmmo: ['fire'] });

// tricky: the barrel stands behind a stone wall; only a lob reaches it
const d4 = level('desert', 4, { wind: 2.2, ammo: { fire: 2 }, ...parts(cover(...stoneWall(12.4, 2, 0, 'bw'), tnt(13.2, 0, 'tnt'), ...shield(10.4)), sandWall(9.8, 1, 's'), playerCrates(), pCrate), rivalTargets: ['pRope'] });

const d5 = level('desert', 5, { wind: -1.8, ammo: { fire: 1, heavy: 1 }, ...parts(ledge('boulder', 15, 12.2, -5.2, 0.5, 'boulder', S), sandWall(10.1, 2, 's'), playerCrates(), playerDrop(rock('x', 0.8, 0.7))), rivalTargets: ['pRope'] });

// a moving target: a barrel swinging on a rope
const d6 = level('desert', 6, {
  wind: 1.5,
  ammo: { fire: 2, bomb: 1 },
  ...parts(cover(...gallows(13.6, 0, 7.4, -2)), swinger('swing', { x: 11.6, y: -7.2 }, 3.2, tnt(0, 0, 'swingTnt'), 2, 'rope'), sandWall(10.1, 2, 's'), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

const d7 = level('desert', 7, { wind: -2.4, ammo: { fire: 1, heavy: 2 }, ...parts(drop('rope', 11.6, 1.5, rock('rock', 0.9, 0.8), 13.4), cover(tnt(13, 0, 'tnt'), woodWall(10.2, 1.7)), playerCrates(), pCrate), rivalTargets: ['pRope'] });

// tricky: a stone slab shields the hanging barrel's rope; strong wind
const d8 = level('desert', 8, {
  wind: 3,
  ammo: { fire: 1, heavy: 2, bomb: 1 },
  ...parts(hangingTnt(11.6, 1.6), cover(box(10.9, -5.4, 0.4, 1.3, 'stone', 'stoneBlock', { id: 'slab', fixed: true, hp: 110, depth: 1 })), sandWall(10.1, 2, 's'), playerCrates(), playerTnt()),
  rivalTargets: ['pTnt'],
  rivalAmmo: ['fire'],
});

// boss: the Sand King shoots fire arrows every other turn
const dBoss = level('desert', 9, {
  boss: true,
  rivalHp: 200,
  wind: -1.5,
  ammo: { fire: 2, heavy: 1, bomb: 1 },
  ...parts(hangingTnt(11.6, 1.8), pendulum('ram', { x: 10.6, y: -7.4 }, 5, 1.05, 4.9), sandWall(10.1, 2, 's'), playerCrates(), pCrate),
  rivalLook: 'desertBoss',
  rivalWeapon: 'fire',
  rivalTargets: ['pRope'],
});

export const DESERT: LevelDef[] = [d1, d2, d3, d4, d5, d6, d7, d8, dBoss];
