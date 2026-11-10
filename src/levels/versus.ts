import { crate, crateStack, drop, level, parts, rock, stoneWall, tnt, tower, woodWall, type Part } from './kit';
import type { LevelDef, ObjDef, WorldId } from './types';

/**
 * Two-player arenas: symmetric, cover in front of each player, a trap over each player and
 * something in the middle. Player 1 stands on the left, Player 2 on the right.
 */
const AMMO = { fire: 2, heavy: 2, bomb: 1 };

function arena(world: WorldId, middle: Part, n: number, cover: (x: number, side: 'l' | 'r') => ObjDef[]): LevelDef {
  const p = parts(
    drop('overP1', 1.2, 1.4, crate(0, 0, 0.9), -0.6),
    drop('overP2', 11.6, 1.4, crate(0, 0, 0.9), 13.4),
    { objects: [...cover(2.8, 'l'), ...cover(10, 'r')], ropes: [] },
    middle,
  );
  const l = level(world, n, { ammo: AMMO, ...p, rivalTargets: ['overP1'], rivalSkill: 0.5 });
  return { ...l, id: `versus-${world}`, player: { ...l.player, hp: 100 }, rival: { ...l.rival, hp: 100 } };
}

const crates = (x: number, s: string) => crateStack(x, 2, 0, `vc${s}`);
const stones = (x: number, s: string) => stoneWall(x, 2, 0, `vs${s}`);
const wood = (x: number, s: string) => [woodWall(x, 1.6, 0, `vw${s}`)];

export const VERSUS: LevelDef[] = [
  arena('forest', tower(6.4, 0, 4, 'crate', 0.9, 0.9, 'mid'), 1, crates),
  arena('castle', tower(6.4, 0, 4, 'stone', 0.8, 0.85, 'mid'), 1, stones),
  arena('mountains', parts(drop('mid', 6.4, 1.2, rock('midRock', 1, 1), 7.6)), 1, wood),
  arena('desert', { objects: [tnt(5.4, 0, 'tntA'), tnt(7.4, 0, 'tntB')], ropes: [] }, 1, crates),
  arena('frozen', tower(6.4, 0, 3, 'ice', 0.9, 0.9, 'ice'), 1, stones),
  arena('volcano', tower(6.4, 0, 4, 'wood', 0.6, 0.9, 'wood'), 1, wood),
];
