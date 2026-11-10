import { crate, drop, level, parts, rock, tnt, tower, type Part } from './kit';
import type { LevelDef, WorldId } from './types';

/**
 * Two-player arenas: symmetric, a hazard over each player and something in the middle.
 * Player 1 stands on the left, Player 2 on the right.
 */
const AMMO = { arrow: 30, fire: 2, heavy: 2, bomb: 1 };

function arena(world: WorldId, middle: Part, n: number): LevelDef {
  const p = parts(drop('overP1', 1.2, 1.4, crate(0, 0, 0.9), -0.6), drop('overP2', 11.6, 1.4, crate(0, 0, 0.9), 13.4), middle);
  const l = level(world, n, { par: 1, ammo: AMMO, ...p, rivalTargets: ['overP1-chain', 'overP1'], rivalSkill: 0.5 });
  return { ...l, id: `versus-${world}`, player: { ...l.player, hp: 100 }, rival: { ...l.rival, hp: 100 } };
}

export const VERSUS: LevelDef[] = [
  arena('forest', tower(6.4, 0, 4, 'crate', 0.9, 0.9, 'mid'), 1),
  arena('castle', tower(6.4, 0, 4, 'stone', 0.8, 0.85, 'mid'), 1),
  arena('mountains', parts(drop('mid', 6.4, 1.2, rock('midRock', 1, 1), 7.6)), 1),
  arena('desert', { objects: [tnt(5.4, 0, 'tntA'), tnt(7.4, 0, 'tntB')], ropes: [] }, 1),
  arena('frozen', tower(6.4, 0, 3, 'ice', 0.9, 0.9, 'ice'), 1),
  arena('volcano', tower(6.4, 0, 4, 'wood', 0.6, 0.9, 'wood'), 1),
];
