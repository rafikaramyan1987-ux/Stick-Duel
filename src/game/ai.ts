import { clamp, type Vec } from '../core/math';
import { Rng } from '../core/rng';
import type { AmmoId, LevelDef } from '../levels/types';
import { aimsAt, pathClear, type Aim } from '../physics/aim';
import { MATERIALS } from '../physics/materials';
import type { Sim } from '../physics/sim';

/**
 * The rival. It looks for things in the arena that can hurt the player (the level lists them:
 * ropes holding something over the player, barrels next to them…) and aims at those with a
 * ballistic solve; otherwise it shoots at the player directly (weak). Its accuracy is the level's
 * rivalSkill, so it gets sharper in later worlds. Deterministic for a given seed.
 */
export interface RivalShot extends Aim {
  ammo: AmmoId;
  target: Vec;
  kind: 'env' | 'direct';
}

export function planRivalShot(sim: Sim, level: LevelDef, seed: number, turn: number, ammoLeft: Partial<Record<AmmoId, number>>): RivalShot {
  const rng = new Rng(seed * 7919 + turn * 104729 + 13);
  const skill = clamp(level.rivalSkill, 0, 1);
  const player = sim.fighters[0];
  const envOptions: RivalShot[] = [];
  for (const id of level.rivalTargets ?? []) {
    const rope = sim.rope(id);
    if (rope) {
      if (!rope.joint) continue;
      const [a, b] = sim.ropeEnds(rope);
      const target = { x: a.x + (b.x - a.x) * 0.45, y: a.y + (b.y - a.y) * 0.45 };
      for (const aim of aimsAt(sim, 1, target)) {
        if (pathClear(sim, 1, aim, target)) envOptions.push({ ...aim, ammo: 'arrow', target, kind: 'env' });
      }
      continue;
    }
    const e = sim.entByName(id);
    if (!e) continue;
    const p = e.body.getPosition();
    const target = { x: p.x, y: p.y };
    const explosive = MATERIALS[e.desc.mat].explosive;
    const ammo: AmmoId = explosive && (ammoLeft.fire ?? 0) > 0 ? 'fire' : explosive && (ammoLeft.heavy ?? 0) > 0 ? 'heavy' : 'arrow';
    if (explosive && ammo === 'arrow') continue;
    for (const aim of aimsAt(sim, 1, target)) {
      if (pathClear(sim, 1, aim, target, (b) => b === e.body)) envOptions.push({ ...aim, ammo, target, kind: 'env' });
    }
  }
  const tp = player.rag.torso.getPosition();
  const torso = { x: tp.x, y: tp.y - 0.1 };
  const direct: RivalShot[] = [];
  for (const aim of aimsAt(sim, 1, torso)) {
    const clear = pathClear(sim, 1, aim, torso, (b) => {
      const ud = (b as { getUserData(): unknown }).getUserData() as { kind?: string; side?: number } | null;
      return ud?.kind === 'part' && ud.side === 0;
    });
    if (clear) direct.push({ ...aim, ammo: 'arrow', target: torso, kind: 'direct' });
  }
  let pick: RivalShot | undefined;
  const preferEnv = envOptions.length > 0 && rng.chance(0.45 + skill * 0.5);
  const pool = preferEnv ? envOptions : direct.length ? direct : envOptions;
  if (pool.length) {
    // prefer quick, flatter shots
    pool.sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle) + (b.power - a.power) * 0.2);
    pick = pool[Math.min(pool.length - 1, rng.int(0, Math.min(2, pool.length - 1)))];
  }
  if (!pick) {
    // nothing is clear: lob at the player anyway
    const lob = aimsAt(sim, 1, torso).filter((a) => a.angle < -0.9 || a.angle > -Math.PI + 0.9);
    pick = lob[0] ? { ...lob[0], ammo: 'arrow', target: torso, kind: 'direct' } : { angle: -Math.PI * 0.75, power: 0.7, ammo: 'arrow', target: torso, kind: 'direct' };
  }
  // human-like error, smaller for skilled rivals; the very first shot of an easy level always misses a bit
  const err = 1 - skill;
  let da = rng.gauss() * err * 0.075;
  let dp = rng.gauss() * err * 0.06;
  if (turn === 0 && skill < 0.4) {
    da += (rng.chance(0.5) ? 1 : -1) * 0.09;
    dp += 0.05;
  }
  return { ...pick, angle: pick.angle + da, power: clamp(pick.power + dp, 0, 1) };
}
