import { clamp, type Vec } from '../core/math';
import { Rng } from '../core/rng';
import type { AmmoId, LevelDef } from '../levels/types';
import { aimsAt, pathClear, type Aim } from '../physics/aim';
import { MATERIALS } from '../physics/materials';
import type { Sim } from '../physics/sim';

/**
 * The rival plays by the player's rules: it shoots at the player (torso, sometimes the head), and
 * when cover is in the way it shoots the cover, which wears down. From world 2 on it also tries
 * the traps on the player's side (the level lists them in rivalTargets). Its accuracy is the
 * level's rivalSkill (grows by world and by level). Bosses have a special weapon.
 * Deterministic for a given seed and turn.
 */
export interface RivalShot extends Aim {
  ammo: AmmoId;
  target: Vec;
  kind: 'env' | 'direct';
  /** Boss volley: two more arrows fanned around this one. */
  volley?: boolean;
  /** The ammo comes from the boss weapon (not from the rival's limited ammo). */
  weapon?: boolean;
}

const isPlayerPart = (b: unknown): boolean => {
  const ud = (b as { getUserData(): unknown }).getUserData() as { kind?: string; side?: number } | null;
  return ud?.kind === 'part' && ud.side === 0;
};

function trapShots(sim: Sim, level: LevelDef, ammoLeft: Partial<Record<AmmoId, number>>): RivalShot[] {
  const out: RivalShot[] = [];
  for (const id of level.rivalTargets ?? []) {
    const rope = sim.rope(id);
    if (rope) {
      if (!rope.joint) continue;
      const [a, b] = sim.ropeEnds(rope);
      const target = { x: a.x + (b.x - a.x) * 0.45, y: a.y + (b.y - a.y) * 0.45 };
      for (const aim of aimsAt(sim, 1, target)) if (pathClear(sim, 1, aim, target)) out.push({ ...aim, ammo: 'arrow', target, kind: 'env' });
      continue;
    }
    const e = sim.entByName(id);
    if (!e || e.dead) continue;
    const p = e.body.getPosition();
    const target = { x: p.x, y: p.y };
    const explosive = MATERIALS[e.desc.mat].explosive;
    const ammo: AmmoId = explosive && (ammoLeft.fire ?? 0) > 0 ? 'fire' : explosive && (ammoLeft.heavy ?? 0) > 0 ? 'heavy' : 'arrow';
    if (explosive && ammo === 'arrow') continue;
    for (const aim of aimsAt(sim, 1, target)) if (pathClear(sim, 1, aim, target, (b) => b === e.body)) out.push({ ...aim, ammo, target, kind: 'env' });
  }
  return out;
}

export function planRivalShot(sim: Sim, level: LevelDef, seed: number, turn: number, ammoLeft: Partial<Record<AmmoId, number>>): RivalShot {
  const rng = new Rng(seed * 7919 + turn * 104729 + 13);
  const skill = clamp(level.rivalSkill, 0, 1);
  const player = sim.fighters[0];
  const tp = player.rag.torso.getPosition();
  const hp = player.rag.head.getPosition();
  // skilled rivals go for the head now and then
  const head = rng.chance(skill * 0.35);
  const target = head ? { x: hp.x, y: hp.y } : { x: tp.x, y: tp.y - 0.05 };

  let pick: RivalShot | undefined;
  // traps on the player's side (from world 2 on, or when the level asks for it)
  const traps = level.world !== 'forest' || level.rivalTargets?.length ? trapShots(sim, level, ammoLeft) : [];
  if (traps.length && rng.chance(0.3 + skill * 0.35)) {
    traps.sort((a, b) => Math.abs(a.angle) - Math.abs(b.angle));
    pick = traps[rng.int(0, Math.min(1, traps.length - 1))];
  }
  if (!pick) {
    const aims = aimsAt(sim, 1, target);
    const clear = aims.filter((a) => pathClear(sim, 1, a, target, isPlayerPart));
    // clear shot if there is one; otherwise the flat one, which hits (and wears down) the cover
    const flat = aims.slice().sort((a, b) => Math.abs(Math.sin(a.angle)) - Math.abs(Math.sin(b.angle)));
    const a = clear.length ? clear.sort((x, y) => Math.abs(Math.sin(x.angle)) - Math.abs(Math.sin(y.angle)))[0] : flat[0];
    pick = a ? { ...a, ammo: 'arrow', target, kind: 'direct' } : { angle: -Math.PI * 0.8, power: 0.85, ammo: 'arrow', target, kind: 'direct' };
  }
  // boss weapons
  const w = level.rivalWeapon;
  if (w && pick.kind === 'direct') {
    if (w === 'volley') pick = { ...pick, volley: turn % 3 === 1 };
    else if (turn % 2 === 1) pick = { ...pick, ammo: w, weapon: true };
  }
  // human-like error, smaller for skilled rivals; the very first shot of an easy level misses a bit
  const err = 1 - skill;
  let da = rng.gauss() * err * 0.12;
  let dp = rng.gauss() * err * 0.07;
  if (turn === 0 && skill < 0.4) {
    da += (rng.chance(0.5) ? 1 : -1) * 0.06;
    dp += 0.03;
  }
  return { ...pick, angle: pick.angle + da, power: clamp(pick.power + dp, 0, 1) };
}
